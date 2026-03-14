import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import Stripe from 'stripe';

type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private stripe: Stripe;

  constructor(private prisma: PrismaService) {
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
    await tx.subscription.updateMany({
      where: { stripeSubscriptionId: subscription.id },
      data: {
        status: subscription.status === 'active' ? 'active' : 'inactive',
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
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

  async handleProviderWebhook(provider: string, payload: Record<string, unknown>) {
    await this.prisma.webhook.create({
      data: {
        source: provider,
        externalId: (payload.id as string) || null,
        payloadJson: payload as Prisma.InputJsonValue,
        status: 'received',
      },
    });

    // TODO: Process provider-specific callbacks (e.g., fal, replicate job completion)
  }
}
