import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UserService {
    constructor(private prisma: PrismaService) { }

    async getProfile(clerkUserId: string) {
        const user = await this.prisma.user.findUnique({
            where: { clerkUserId },
            include: { subscription: true },
        });

        if (!user) throw new NotFoundException('User not found');

        // Calculate balance
        const balance = await this.getBalance(user.id);

        return {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            avatarUrl: user.avatarUrl,
            role: user.role,
            status: user.status,
            balance,
            plan: {
                code: user.subscription?.planCode || 'free',
                name: this.getPlanName(user.subscription?.planCode || 'free'),
            },
            subscription: user.subscription ? {
                status: user.subscription.status,
                currentPeriodEnd: user.subscription.currentPeriodEnd?.toISOString() || null,
                cancelAtPeriodEnd: user.subscription.cancelAtPeriodEnd,
            } : null,
        };
    }

    async updateProfile(clerkUserId: string, data: { fullName?: string; avatarUrl?: string }) {
        const user = await this.prisma.user.update({
            where: { clerkUserId },
            data: {
                ...(data.fullName !== undefined && { fullName: data.fullName }),
                ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl }),
            },
        });
        return user;
    }

    async getBalance(userId: string): Promise<number> {
        const result = await this.prisma.creditLedger.aggregate({
            where: { userId },
            _sum: { amount: true },
        });
        return result._sum.amount || 0;
    }

    private getPlanName(code: string): string {
        const names: Record<string, string> = {
            free: 'Free',
            'creator-monthly': 'Creator',
            'creator-yearly': 'Creator',
            'pro-monthly': 'Pro',
            'pro-yearly': 'Pro',
            'business-monthly': 'Business',
            'business-yearly': 'Business',
        };
        return names[code] || 'Unknown';
    }
}
