import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminService {
    constructor(private prisma: PrismaService) { }

    async searchUsers(query: string) {
        return this.prisma.user.findMany({
            where: {
                OR: [
                    { email: { contains: query, mode: 'insensitive' } },
                    { fullName: { contains: query, mode: 'insensitive' } },
                ],
            },
            include: { subscription: true },
            take: 20,
        });
    }

    async getFailedJobs() {
        return this.prisma.generationJob.findMany({
            where: { status: 'failed' },
            orderBy: { failedAt: 'desc' },
            take: 50,
            include: { user: { select: { email: true, fullName: true } } },
        });
    }

    async retryJob(jobId: string) {
        const job = await this.prisma.generationJob.findUnique({ where: { id: jobId } });
        if (!job) throw new NotFoundException('Job not found');
        if (job.status !== 'failed') throw new ForbiddenException('Only failed jobs can be retried');

        return this.prisma.generationJob.update({
            where: { id: jobId },
            data: {
                status: 'queued',
                errorMessage: null,
                failedAt: null,
            },
        });
    }

    async adjustCredits(userId: string, amount: number, reason: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        return this.prisma.creditLedger.create({
            data: {
                userId,
                amount,
                entryType: 'manual_adjustment',
                reason,
            },
        });
    }

    async getModerationQueue() {
        return this.prisma.asset.findMany({
            where: { moderationStatus: 'pending' },
            orderBy: { createdAt: 'desc' },
            take: 50,
            include: { user: { select: { email: true } } },
        });
    }

    async moderateAsset(assetId: string, status: 'approved' | 'rejected') {
        return this.prisma.asset.update({
            where: { id: assetId },
            data: { moderationStatus: status },
        });
    }

    async auditLog(actorUserId: string, action: string, targetType: string, targetId?: string, metadata?: Record<string, unknown>) {
        return this.prisma.auditLog.create({
            data: {
                actorUserId,
                action,
                targetType,
                targetId: targetId || null,
                metadataJson: (metadata || {}) as Prisma.InputJsonValue,
            },
        });
    }
}
