import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  createHash,
  createHmac,
  createPublicKey,
  timingSafeEqual,
  verify,
} from 'node:crypto';
import { IncomingHttpHeaders } from 'node:http';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerationService } from '../generation/generation.service';
import Stripe from 'stripe';

type TransactionClient = Prisma.TransactionClient;
type ProviderWebhookRequest = {
  rawBody: Buffer;
  headers: IncomingHttpHeaders;
};
type FalJwk = {
  kty?: string;
  crv?: string;
  x?: string;
};
type NormalizedProviderWebhook = {
  externalJobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  errorMessage?: string;
  outputs?: Array<{ url: string; mimeType: string }>;
};

const WEBHOOK_TIMESTAMP_TOLERANCE_SEC = 300;
const FAL_JWKS_URL = 'https://rest.fal.ai/.well-known/jwks.json';
const FAL_JWKS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REPLICATE_WEBHOOK_SECRET_URL = 'https://api.replicate.com/v1/webhooks/default/secret';

let falJwksCache: FalJwk[] = [];
let falJwksFetchedAt = 0;
let replicateWebhookSecretCache: string | null = null;

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private stripe: Stripe;

  constructor(
    private prisma: PrismaService,
    private generationService: GenerationService,
  ) {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
      apiVersion: '2024-06-20',
    });
  }

  async handleStripeWebhook(payload: Buffer, signature: string) {
    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET || '',
      );
    } catch (err) {
      this.logger.error('Webhook signature verification failed', err);
      throw err;
    }

    const result = await this.prisma.withSerializableTransaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`stripe:${event.id}`}))`;

      const existingProcessedWebhook = await tx.webhook.findFirst({
        where: {
          source: 'stripe',
          externalId: event.id,
          status: 'processed',
        },
        select: { id: true },
      });
      if (existingProcessedWebhook) {
        return { skipped: true as const };
      }

      const existingProcessingWebhook = await tx.webhook.findFirst({
        where: {
          source: 'stripe',
          externalId: event.id,
          status: 'processing',
        },
        select: { id: true },
      });
      if (existingProcessingWebhook) {
        return { skipped: true as const };
      }

      const retryableWebhook = await tx.webhook.findFirst({
        where: {
          source: 'stripe',
          externalId: event.id,
          status: { in: ['failed', 'received'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });

      const webhook = retryableWebhook
        ? await tx.webhook.update({
            where: { id: retryableWebhook.id },
            data: {
              payloadJson: event as unknown as Prisma.InputJsonValue,
              status: 'processing',
              processedAt: null,
            },
          })
        : await tx.webhook.create({
            data: {
              source: 'stripe',
              externalId: event.id,
              payloadJson: event as unknown as Prisma.InputJsonValue,
              status: 'processing',
            },
          });

      try {
        switch (event.type) {
          case 'checkout.session.completed':
            await this.handleCheckoutCompleted(tx, event.data.object as Stripe.Checkout.Session);
            break;
          case 'invoice.paid':
            await this.handleInvoicePaid(tx, event.data.object as Stripe.Invoice);
            break;
          case 'invoice.payment_failed':
            this.logger.warn('Payment failed', event.data.object);
            break;
          case 'customer.subscription.updated':
            await this.handleSubscriptionUpdated(tx, event.data.object as Stripe.Subscription);
            break;
          case 'customer.subscription.deleted':
            await this.handleSubscriptionDeleted(tx, event.data.object as Stripe.Subscription);
            break;
        }

        await tx.webhook.update({
          where: { id: webhook.id },
          data: { status: 'processed', processedAt: new Date() },
        });

        return { skipped: false as const };
      } catch (error) {
        await tx.webhook.update({
          where: { id: webhook.id },
          data: { status: 'failed', processedAt: null },
        });

        return { skipped: false as const, error };
      }
    });

    if ('error' in result) {
      this.logger.error(`Stripe webhook processing failed for ${event.id}`, result.error);
      throw result.error;
    }
  }

  private async handleCheckoutCompleted(tx: TransactionClient, session: Stripe.Checkout.Session) {
    const userId = session.metadata?.userId;
    const planCode = session.metadata?.planCode;
    const stripeCustomerId = typeof session.customer === 'string' ? session.customer : null;
    const stripeSubscriptionId =
      typeof session.subscription === 'string' ? session.subscription : null;
    if (!userId || !planCode || !stripeCustomerId || !stripeSubscriptionId) {
      this.logger.warn('Stripe checkout session is missing subscription metadata');
      return;
    }

    const plan = await tx.plan.findUnique({ where: { code: planCode } });
    if (!plan) {
      this.logger.warn(`Stripe checkout session referenced unknown plan ${planCode}`);
      return;
    }

    await tx.subscription.upsert({
      where: { userId },
      update: {
        stripeCustomerId,
        stripeSubscriptionId,
        planCode,
        status: 'active',
      },
      create: {
        userId,
        stripeCustomerId,
        stripeSubscriptionId,
        planCode,
        status: 'active',
      },
    });

    await tx.creditLedger.create({
      data: {
        userId,
        amount: plan.monthlyCredits,
        entryType: 'monthly_grant',
        reason: `${plan.name} plan subscription`,
      },
    });
  }

  private async handleInvoicePaid(tx: TransactionClient, invoice: Stripe.Invoice) {
    if (!invoice.subscription) return;

    const sub = await tx.subscription.findFirst({
      where: { stripeSubscriptionId: invoice.subscription as string },
    });
    if (!sub) return;

    const plan = await tx.plan.findUnique({ where: { code: sub.planCode } });
    if (!plan) return;

    if (invoice.billing_reason === 'subscription_cycle') {
      await tx.creditLedger.create({
        data: {
          userId: sub.userId,
          amount: plan.monthlyCredits,
          entryType: 'monthly_grant',
          reason: `${plan.name} monthly renewal`,
        },
      });
    }
  }

  private async handleSubscriptionUpdated(
    tx: TransactionClient,
    subscription: Stripe.Subscription,
  ) {
    // current_period_end may be on the subscription or on the first item (newer API versions)
    const sub = subscription as any;
    const periodEnd = sub.current_period_end
      ?? sub.items?.data?.[0]?.current_period_end
      ?? null;

    await tx.subscription.updateMany({
      where: { stripeSubscriptionId: subscription.id },
      data: {
        status: subscription.status === 'active' ? 'active' : 'inactive',
        ...(periodEnd ? { currentPeriodEnd: new Date(periodEnd * 1000) } : {}),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
    });
  }

  private async handleSubscriptionDeleted(
    tx: TransactionClient,
    subscription: Stripe.Subscription,
  ) {
    await tx.subscription.updateMany({
      where: { stripeSubscriptionId: subscription.id },
      data: {
        status: 'canceled',
        planCode: 'free',
      },
    });
  }

  async handleProviderWebhook(
    provider: string,
    payload: Record<string, unknown>,
    request: ProviderWebhookRequest,
  ) {
    await this.verifyProviderWebhook(provider, request);

    const normalized = this.normalizeProviderWebhook(provider, payload);
    if (!normalized) {
      throw new BadRequestException(`Unsupported ${provider} webhook payload`);
    }

    const webhook = await this.prisma.webhook.create({
      data: {
        source: provider,
        externalId: normalized.externalJobId,
        payloadJson: payload as Prisma.InputJsonValue,
        status: 'processing',
      },
    });

    try {
      const result = await this.generationService.handleProviderJobWebhook({
        provider,
        externalJobId: normalized.externalJobId,
        status: normalized.status,
        errorMessage: normalized.errorMessage,
        outputs: normalized.outputs,
      });

      if (result.retryable) {
        await this.prisma.webhook.update({
          where: { id: webhook.id },
          data: { status: 'received', processedAt: null },
        });
        throw new ServiceUnavailableException(result.reason);
      }

      await this.prisma.webhook.update({
        where: { id: webhook.id },
        data: {
          status: 'processed',
          processedAt: new Date(),
        },
      });

      if (!result.handled) {
        this.logger.log(result.reason);
      }
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) {
        await this.prisma.webhook.update({
          where: { id: webhook.id },
          data: { status: 'failed', processedAt: null },
        });
      }

      this.logger.error(
        `Provider webhook processing failed for ${provider}:${normalized.externalJobId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  private async verifyProviderWebhook(
    provider: string,
    request: ProviderWebhookRequest,
  ): Promise<void> {
    switch (provider) {
      case 'fal':
        if (!(await this.verifyFalWebhook(request))) {
          throw new UnauthorizedException('Invalid fal webhook signature');
        }
        return;
      case 'replicate':
        if (!(await this.verifyReplicateWebhook(request))) {
          throw new UnauthorizedException('Invalid Replicate webhook signature');
        }
        return;
      default:
        throw new BadRequestException(`Provider ${provider} is not supported`);
    }
  }

  private normalizeProviderWebhook(
    provider: string,
    payload: Record<string, unknown>,
  ): NormalizedProviderWebhook | null {
    switch (provider) {
      case 'fal':
        return this.normalizeFalWebhook(payload);
      case 'replicate':
        return this.normalizeReplicateWebhook(payload);
      default:
        return null;
    }
  }

  private normalizeFalWebhook(payload: Record<string, unknown>): NormalizedProviderWebhook | null {
    const requestId = this.getStringField(payload, 'request_id')
      || this.getStringField(payload, 'gateway_request_id');
    const status = this.getStringField(payload, 'status');

    if (!requestId || !status) {
      return null;
    }

    if (status === 'OK') {
      const rawPayload = payload.payload;
      const normalizedOutputs =
        rawPayload && typeof rawPayload === 'object' && Array.isArray((rawPayload as { images?: unknown[] }).images)
          ? (rawPayload as {
              images: Array<{ url?: unknown; content_type?: unknown }>;
            }).images
              .map((image) => {
                if (typeof image?.url !== 'string' || !image.url.trim()) {
                  return null;
                }

                return {
                  url: image.url,
                  mimeType:
                    typeof image.content_type === 'string' && image.content_type.trim()
                      ? image.content_type
                      : 'image/jpeg',
                };
              })
              .filter((image): image is { url: string; mimeType: string } => image !== null)
          : undefined;

      return {
        externalJobId: requestId,
        status: 'completed',
        outputs: normalizedOutputs,
      };
    }

    if (status === 'ERROR') {
      return {
        externalJobId: requestId,
        status: 'failed',
        errorMessage:
          this.getStringField(payload, 'error')
          || this.getStringField(payload, 'payload_error')
          || 'fal reported job failure',
      };
    }

    return {
      externalJobId: requestId,
      status: 'running',
    };
  }

  private normalizeReplicateWebhook(
    payload: Record<string, unknown>,
  ): NormalizedProviderWebhook | null {
    const externalJobId = this.getStringField(payload, 'id');
    const status = this.getStringField(payload, 'status');

    if (!externalJobId || !status) {
      return null;
    }

    const statusMap: Record<string, 'queued' | 'running' | 'completed' | 'failed'> = {
      starting: 'queued',
      processing: 'running',
      succeeded: 'completed',
      failed: 'failed',
      canceled: 'failed',
    };

    return {
      externalJobId,
      status: statusMap[status] || 'running',
      errorMessage: this.getStringField(payload, 'error') || undefined,
    };
  }

  private getStringField(payload: Record<string, unknown>, field: string): string | null {
    const value = payload[field];
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private getHeaderValue(headers: IncomingHttpHeaders, name: string): string | undefined {
    const value = headers[name.toLowerCase()];
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }

  private isRecentTimestamp(value: string): boolean {
    const timestamp = Number.parseInt(value, 10);
    if (!Number.isFinite(timestamp)) {
      return false;
    }

    const currentTime = Math.floor(Date.now() / 1000);
    return Math.abs(currentTime - timestamp) <= WEBHOOK_TIMESTAMP_TOLERANCE_SEC;
  }

  private async verifyFalWebhook(request: ProviderWebhookRequest): Promise<boolean> {
    const requestId = this.getHeaderValue(request.headers, 'x-fal-webhook-request-id');
    const userId = this.getHeaderValue(request.headers, 'x-fal-webhook-user-id');
    const timestamp = this.getHeaderValue(request.headers, 'x-fal-webhook-timestamp');
    const signatureHex = this.getHeaderValue(request.headers, 'x-fal-webhook-signature');

    if (!requestId || !userId || !timestamp || !signatureHex || !this.isRecentTimestamp(timestamp)) {
      return false;
    }

    let signature: Buffer;
    try {
      signature = Buffer.from(signatureHex, 'hex');
    } catch {
      return false;
    }

    const message = Buffer.from(
      [
        requestId,
        userId,
        timestamp,
        createHash('sha256').update(request.rawBody).digest('hex'),
      ].join('\n'),
      'utf8',
    );

    for (const jwk of await this.getFalJwks()) {
      if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string') {
        continue;
      }

      try {
        const publicKey = createPublicKey({
          key: {
            kty: jwk.kty,
            crv: jwk.crv,
            x: jwk.x,
          },
          format: 'jwk',
        });

        if (verify(null, message, publicKey, signature)) {
          return true;
        }
      } catch {
        continue;
      }
    }

    return false;
  }

  private async verifyReplicateWebhook(request: ProviderWebhookRequest): Promise<boolean> {
    const webhookId = this.getHeaderValue(request.headers, 'webhook-id');
    const timestamp = this.getHeaderValue(request.headers, 'webhook-timestamp');
    const signatureHeader = this.getHeaderValue(request.headers, 'webhook-signature');

    if (!webhookId || !timestamp || !signatureHeader || !this.isRecentTimestamp(timestamp)) {
      return false;
    }

    const signingSecret = await this.getReplicateWebhookSigningSecret();
    const secret = signingSecret.startsWith('whsec_')
      ? signingSecret.slice('whsec_'.length)
      : signingSecret;
    const signedContent = `${webhookId}.${timestamp}.${request.rawBody.toString('utf8')}`;
    const expectedSignature = createHmac('sha256', secret).update(signedContent).digest('base64');

    return signatureHeader
      .split(/\s+/)
      .filter(Boolean)
      .some((candidate) => {
        const [, signature = ''] = candidate.split(',', 2);
        const provided = Buffer.from(signature);
        const expected = Buffer.from(expectedSignature);

        if (provided.length !== expected.length) {
          return false;
        }

        return timingSafeEqual(provided, expected);
      });
  }

  private async getFalJwks(): Promise<FalJwk[]> {
    const now = Date.now();
    if (falJwksCache.length > 0 && now - falJwksFetchedAt < FAL_JWKS_CACHE_TTL_MS) {
      return falJwksCache;
    }

    const response = await fetch(FAL_JWKS_URL);
    if (!response.ok) {
      throw new ServiceUnavailableException(`Failed to fetch fal JWKS: ${response.status}`);
    }

    const body = (await response.json()) as { keys?: FalJwk[] };
    falJwksCache = Array.isArray(body.keys) ? body.keys : [];
    falJwksFetchedAt = now;
    return falJwksCache;
  }

  private async getReplicateWebhookSigningSecret(): Promise<string> {
    if (replicateWebhookSecretCache) {
      return replicateWebhookSecretCache;
    }

    if (process.env.REPLICATE_WEBHOOK_SIGNING_SECRET?.trim()) {
      replicateWebhookSecretCache = process.env.REPLICATE_WEBHOOK_SIGNING_SECRET;
      return replicateWebhookSecretCache;
    }

    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) {
      throw new ServiceUnavailableException(
        'Replicate webhook signing secret is not configured',
      );
    }

    const response = await fetch(REPLICATE_WEBHOOK_SECRET_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Failed to fetch Replicate webhook signing secret: ${response.status}`,
      );
    }

    const body = (await response.json()) as { key?: string };
    if (!body.key) {
      throw new ServiceUnavailableException('Replicate webhook signing secret response was empty');
    }

    replicateWebhookSecretCache = body.key;
    return replicateWebhookSecretCache;
  }
}
