import {
    BadGatewayException,
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
    private readonly logger = new Logger(AuthService.name);

    constructor(private prisma: PrismaService) { }

    private normalizeEmail(email: string): string {
        return email.trim().toLowerCase();
    }

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
        const profile = await this.getClerkUserProfile(clerkUserId);
        const email = this.normalizeEmail(profile.email);
        const fullName = profile.fullName || null;
        const avatarUrl = profile.avatarUrl || null;

        let user;

        for (let attempt = 1; attempt <= 2; attempt += 1) {
            try {
                user = await this.prisma.withSerializableTransaction(async (tx) => {
                    const existingByClerk = await tx.user.findUnique({
                        where: { clerkUserId },
                    });

                    let syncedUser;

                    if (existingByClerk) {
                        const emailOwnedByAnotherUser =
                            existingByClerk.email !== email
                                ? await tx.user.findFirst({
                                    where: { email: { equals: email, mode: 'insensitive' } },
                                })
                                : null;

                        if (emailOwnedByAnotherUser && emailOwnedByAnotherUser.id !== existingByClerk.id) {
                            this.logger.warn(
                                `Skipping email update for Clerk user ${clerkUserId} because ${email} is already linked to user ${emailOwnedByAnotherUser.id}.`,
                            );

                            syncedUser = await tx.user.update({
                                where: { id: existingByClerk.id },
                                data: {
                                    fullName,
                                    avatarUrl,
                                },
                            });
                        } else {
                            syncedUser = await tx.user.update({
                                where: { id: existingByClerk.id },
                                data: {
                                    email,
                                    fullName,
                                    avatarUrl,
                                },
                            });
                        }
                    } else {
                        const existingByEmail = await tx.user.findFirst({
                            where: { email: { equals: email, mode: 'insensitive' } },
                        });

                        if (existingByEmail) {
                            this.logger.log(
                                `Linking existing user ${existingByEmail.id} to Clerk user ${clerkUserId} via email ${email}.`,
                            );

                            syncedUser = await tx.user.update({
                                where: { id: existingByEmail.id },
                                data: {
                                    clerkUserId,
                                    fullName,
                                    avatarUrl,
                                },
                            });
                        } else {
                            syncedUser = await tx.user.create({
                                data: {
                                    clerkUserId,
                                    email,
                                    fullName,
                                    avatarUrl,
                                    role: 'user',
                                    status: 'active',
                                },
                            });
                        }
                    }

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

                break;
            } catch (error) {
                const isUniqueConstraintRetry =
                    error instanceof Prisma.PrismaClientKnownRequestError &&
                    error.code === 'P2002' &&
                    attempt < 2;

                if (!isUniqueConstraintRetry) {
                    throw error;
                }
            }
        }

        if (!user) {
            throw new InternalServerErrorException('Failed to sync user');
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
