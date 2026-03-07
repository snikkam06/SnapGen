import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import Stripe from 'stripe';

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

        // Store raw webhook
        await this.prisma.webhook.create({
            data: {
                source: 'stripe',
                externalId: event.id,
                payloadJson: event as unknown as Prisma.InputJsonValue,
                status: 'received',
            },
        });

        // Process event
        switch (event.type) {
            case 'checkout.session.completed':
                await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
                break;
            case 'invoice.paid':
                await this.handleInvoicePaid(event.data.object as Stripe.Invoice);
                break;
            case 'invoice.payment_failed':
                this.logger.warn('Payment failed', event.data.object);
                break;
            case 'customer.subscription.updated':
                await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
                break;
            case 'customer.subscription.deleted':
                await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
                break;
        }

        // Mark as processed
        await this.prisma.webhook.updateMany({
            where: { externalId: event.id },
            data: { status: 'processed', processedAt: new Date() },
        });
    }

    private async handleCheckoutCompleted(session: Stripe.Checkout.Session) {
        const userId = session.metadata?.userId;
        const planCode = session.metadata?.planCode;
        if (!userId || !planCode) return;

        const plan = await this.prisma.plan.findUnique({ where: { code: planCode } });
        if (!plan) return;

        await this.prisma.subscription.upsert({
            where: { userId },
            update: {
                stripeCustomerId: session.customer as string,
                stripeSubscriptionId: session.subscription as string,
                planCode,
                status: 'active',
            },
            create: {
                userId,
                stripeCustomerId: session.customer as string,
                stripeSubscriptionId: session.subscription as string,
                planCode,
                status: 'active',
            },
        });

        // Grant monthly credits
        await this.prisma.creditLedger.create({
            data: {
                userId,
                amount: plan.monthlyCredits,
                entryType: 'monthly_grant',
                reason: `${plan.name} plan subscription`,
            },
        });
    }

    private async handleInvoicePaid(invoice: Stripe.Invoice) {
        if (!invoice.subscription) return;

        const sub = await this.prisma.subscription.findFirst({
            where: { stripeSubscriptionId: invoice.subscription as string },
        });
        if (!sub) return;

        const plan = await this.prisma.plan.findUnique({ where: { code: sub.planCode } });
        if (!plan) return;

        // Grant monthly credits on renewal
        if (invoice.billing_reason === 'subscription_cycle') {
            await this.prisma.creditLedger.create({
                data: {
                    userId: sub.userId,
                    amount: plan.monthlyCredits,
                    entryType: 'monthly_grant',
                    reason: `${plan.name} monthly renewal`,
                },
            });
        }
    }

    private async handleSubscriptionUpdated(subscription: Stripe.Subscription) {
        await this.prisma.subscription.updateMany({
            where: { stripeSubscriptionId: subscription.id },
            data: {
                status: subscription.status === 'active' ? 'active' : 'inactive',
                currentPeriodEnd: new Date(subscription.current_period_end * 1000),
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
            },
        });
    }

    private async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
        await this.prisma.subscription.updateMany({
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
                externalId: payload.id as string || null,
                payloadJson: payload as Prisma.InputJsonValue,
                status: 'received',
            },
        });

        // TODO: Process provider-specific callbacks (e.g., fal, replicate job completion)
    }
}
