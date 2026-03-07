import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CreditService {
    constructor(private prisma: PrismaService) { }

    async getBalance(userId: string): Promise<number> {
        const result = await this.prisma.creditLedger.aggregate({
            where: { userId },
            _sum: { amount: true },
        });
        return result._sum.amount || 0;
    }

    async reserveCredits(userId: string, amount: number, reason: string, referenceId?: string) {
        return this.prisma.creditLedger.create({
            data: {
                userId,
                amount: -amount,
                entryType: 'job_reservation',
                reason,
                referenceType: referenceId ? 'job' : null,
                referenceId: referenceId || null,
            },
        });
    }

    async finalizeCredits(userId: string, reservedAmount: number, finalAmount: number, jobId: string) {
        const refundDelta = reservedAmount - finalAmount;

        if (refundDelta > 0) {
            await this.prisma.creditLedger.create({
                data: {
                    userId,
                    amount: refundDelta,
                    entryType: 'job_refund',
                    reason: `Refund delta for job ${jobId}`,
                    referenceType: 'job',
                    referenceId: jobId,
                },
            });
        }

        return this.prisma.creditLedger.create({
            data: {
                userId,
                amount: 0,
                entryType: 'job_finalization',
                reason: `Finalized job ${jobId} — ${finalAmount} credits`,
                referenceType: 'job',
                referenceId: jobId,
            },
        });
    }

    async refundCredits(userId: string, amount: number, reason: string, jobId?: string) {
        return this.prisma.creditLedger.create({
            data: {
                userId,
                amount,
                entryType: 'job_refund',
                reason,
                referenceType: jobId ? 'job' : null,
                referenceId: jobId || null,
            },
        });
    }

    async grantCredits(userId: string, amount: number, entryType: string, reason: string) {
        return this.prisma.creditLedger.create({
            data: {
                userId,
                amount,
                entryType,
                reason,
            },
        });
    }
}
