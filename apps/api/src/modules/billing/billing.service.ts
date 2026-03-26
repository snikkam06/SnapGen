import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import Stripe from 'stripe';
import { assertNonEmptyString } from '../../utils/validation';

@Injectable()
export class BillingService {
  private stripe: Stripe;

  constructor(private prisma: PrismaService) {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
      apiVersion: '2024-06-20',
    });
  }

  async createCheckoutSession(clerkUserId: string, planCode: string) {
    this.ensureBillingConfigured();

    const normalizedPlanCode = assertNonEmptyString(planCode, 'planCode');
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
      include: { subscription: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const plan = await this.prisma.plan.findUnique({ where: { code: normalizedPlanCode } });
    if (!plan) throw new NotFoundException('Plan not found');
    if (!plan.isActive) throw new BadRequestException('Plan is not active');
    if (plan.monthlyPriceCents <= 0) {
      throw new BadRequestException('Free plans do not require checkout');
    }

    const stripeCustomerId =
      user.subscription?.stripeCustomerId &&
      !user.subscription.stripeCustomerId.startsWith('pending_')
        ? user.subscription.stripeCustomerId
        : undefined;

    const stripePriceId = this.getStripePriceId(plan.code);
    if (!stripePriceId) {
      throw new InternalServerErrorException(`Stripe price not configured for plan: ${plan.code}`);
    }

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      ...(stripeCustomerId ? { customer: stripeCustomerId } : { customer_email: user.email }),
      client_reference_id: user.id,
      line_items: [
        {
          price: stripePriceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.APP_URL}/dashboard/billing?success=true`,
      cancel_url: `${process.env.APP_URL}/dashboard/billing?canceled=true`,
      metadata: {
        userId: user.id,
        planCode: plan.code,
      },
    });

    if (!session.url) {
      throw new InternalServerErrorException('Stripe checkout session did not return a URL');
    }

    return { url: session.url };
  }

  async createPortalSession(clerkUserId: string) {
    this.ensureBillingConfigured();

    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
      include: { subscription: true },
    });
    const stripeCustomerId = user?.subscription?.stripeCustomerId;
    if (
      !stripeCustomerId ||
      stripeCustomerId.startsWith('pending_') ||
      !user.subscription?.stripeSubscriptionId
    ) {
      throw new NotFoundException('No subscription found');
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${process.env.APP_URL}/dashboard/billing`,
    });

    if (!session.url) {
      throw new InternalServerErrorException('Stripe billing portal did not return a URL');
    }

    return { url: session.url };
  }

  async getCredits(clerkUserId: string) {
    const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!user) throw new NotFoundException('User not found');

    const balanceResult = await this.prisma.creditLedger.aggregate({
      where: { userId: user.id },
      _sum: { amount: true },
    });

    const recentEntries = await this.prisma.creditLedger.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return {
      balance: balanceResult._sum.amount || 0,
      recentEntries: recentEntries.map((e) => ({
        id: e.id,
        amount: e.amount,
        entryType: e.entryType,
        reason: e.reason,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  private getStripePriceId(planCode: string): string | undefined {
    const priceMap: Record<string, string | undefined> = {
      'creator-monthly': process.env.STRIPE_PRICE_CREATOR_MONTHLY,
      'creator-yearly': process.env.STRIPE_PRICE_CREATOR_YEARLY,
      'pro-monthly': process.env.STRIPE_PRICE_PRO_MONTHLY,
      'pro-yearly': process.env.STRIPE_PRICE_PRO_YEARLY,
      'business-monthly': process.env.STRIPE_PRICE_BUSINESS_MONTHLY,
      'business-yearly': process.env.STRIPE_PRICE_BUSINESS_YEARLY,
    };
    return priceMap[planCode];
  }

  private ensureBillingConfigured(): void {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new InternalServerErrorException('STRIPE_SECRET_KEY is not configured');
    }

    if (!process.env.APP_URL) {
      throw new InternalServerErrorException('APP_URL is not configured');
    }
  }
}
