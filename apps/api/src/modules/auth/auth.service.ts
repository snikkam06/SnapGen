import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuthService {
    constructor(private prisma: PrismaService) { }

    async syncUser(clerkUserId: string, email: string, fullName?: string, avatarUrl?: string) {
        const user = await this.prisma.user.upsert({
            where: { clerkUserId },
            update: {
                email,
                fullName: fullName || undefined,
                avatarUrl: avatarUrl || undefined,
                updatedAt: new Date(),
            },
            create: {
                clerkUserId,
                email,
                fullName,
                avatarUrl,
                role: 'user',
                status: 'active',
            },
        });

        // Ensure subscription exists
        const existingSubscription = await this.prisma.subscription.findUnique({
            where: { userId: user.id },
        });

        if (!existingSubscription) {
            await this.prisma.subscription.create({
                data: {
                    userId: user.id,
                    stripeCustomerId: `pending_${user.id}`,
                    planCode: 'free',
                    status: 'active',
                },
            });

            // Grant starter credits
            await this.prisma.creditLedger.create({
                data: {
                    userId: user.id,
                    amount: 50,
                    entryType: 'promo_grant',
                    reason: 'Welcome bonus — starter credits',
                },
            });
        }

        return {
            user: {
                id: user.id,
                email: user.email,
                fullName: user.fullName,
                role: user.role,
                status: user.status,
            },
        };
    }

    async getUserByClerkId(clerkUserId: string) {
        return this.prisma.user.findUnique({
            where: { clerkUserId },
            include: {
                subscription: true,
            },
        });
    }
}
