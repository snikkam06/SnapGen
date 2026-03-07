import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import Stripe from 'stripe';

@Injectable()
export class BillingService {
    private stripe: Stripe;

    constructor(private prisma: PrismaService) {
        this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
            apiVersion: '2024-06-20',
        });
    }

    async createCheckoutSession(clerkUserId: string, planCode: string) {
        const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
        if (!user) throw new NotFoundException('User not found');

        const plan = await this.prisma.plan.findUnique({ where: { code: planCode } });
        if (!plan) throw new NotFoundException('Plan not found');

        const session = await this.stripe.checkout.sessions.create({
            mode: 'subscription',
            customer_email: user.email,
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: { name: plan.name },
                        unit_amount: plan.monthlyPriceCents,
                        recurring: { interval: 'month' },
                    },
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

        return { url: session.url };
    }

    async createPortalSession(clerkUserId: string) {
        const user = await this.prisma.user.findUnique({
            where: { clerkUserId },
            include: { subscription: true },
        });
        if (!user?.subscription?.stripeCustomerId) {
            throw new NotFoundException('No subscription found');
        }

        const session = await this.stripe.billingPortal.sessions.create({
            customer: user.subscription.stripeCustomerId,
            return_url: `${process.env.APP_URL}/dashboard/billing`,
        });

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
}
