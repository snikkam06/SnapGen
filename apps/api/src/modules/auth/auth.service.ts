import { BadGatewayException, BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

type ClerkEmailAddress = {
    id: string;
    email_address: string;
};

type ClerkUserResponse = {
    first_name: string | null;
    last_name: string | null;
    image_url: string;
    primary_email_address_id: string | null;
    email_addresses: ClerkEmailAddress[];
};

@Injectable()
export class AuthService {
    constructor(private prisma: PrismaService) { }

    private async getClerkUserProfile(clerkUserId: string) {
        const secretKey = process.env.CLERK_SECRET_KEY;

        if (!secretKey) {
            throw new InternalServerErrorException('CLERK_SECRET_KEY is not configured');
        }

        const response = await fetch(`https://api.clerk.com/v1/users/${clerkUserId}`, {
            headers: {
                Authorization: `Bearer ${secretKey}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            const details = await response.text().catch(() => '');
            throw new BadGatewayException(
                details || `Failed to load Clerk user ${clerkUserId} (${response.status})`,
            );
        }

        const clerkUser = (await response.json()) as ClerkUserResponse;
        const primaryEmail =
            clerkUser.email_addresses.find(
                (email) => email.id === clerkUser.primary_email_address_id,
            )?.email_address ??
            clerkUser.email_addresses[0]?.email_address;

        if (!primaryEmail) {
            throw new BadRequestException('Clerk user does not have an email address');
        }

        const fullName = [clerkUser.first_name, clerkUser.last_name]
            .filter((value): value is string => !!value)
            .join(' ')
            .trim();

        return {
            email: primaryEmail,
            fullName: fullName || undefined,
            avatarUrl: clerkUser.image_url || undefined,
        };
    }

    async syncUser(clerkUserId: string) {
        const { email, fullName, avatarUrl } = await this.getClerkUserProfile(clerkUserId);

        const user = await this.prisma.$transaction(async (tx) => {
            const syncedUser = await tx.user.upsert({
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

            const existingSubscription = await tx.subscription.findUnique({
                where: { userId: syncedUser.id },
            });

            if (!existingSubscription) {
                await tx.subscription.create({
                    data: {
                        userId: syncedUser.id,
                        stripeCustomerId: `pending_${syncedUser.id}`,
                        planCode: 'free',
                        status: 'active',
                    },
                });

                await tx.creditLedger.create({
                    data: {
                        userId: syncedUser.id,
                        amount: 50,
                        entryType: 'promo_grant',
                        reason: 'Welcome bonus — starter credits',
                    },
                });
            }

            return syncedUser;
        });

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
