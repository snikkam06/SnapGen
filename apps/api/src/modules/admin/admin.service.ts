import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerationService } from '../generation/generation.service';
import { assertUuid } from '../../utils/validation';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private generationService: GenerationService,
  ) {}

  async searchUsers(query: string) {
    return this.prisma.reader.user.findMany({
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
    return this.prisma.reader.generationJob.findMany({
      where: { status: 'failed' },
      orderBy: { failedAt: 'desc' },
      take: 50,
      include: { user: { select: { email: true, fullName: true } } },
    });
  }

  async retryJob(jobId: string) {
    assertUuid(jobId, 'jobId');

    const job = await this.prisma.generationJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.status !== 'failed') throw new ForbiddenException('Only failed jobs can be retried');

    const updatedJob = await this.prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status: 'queued',
        errorMessage: null,
        failedAt: null,
      },
    });

    await this.generationService.dispatchQueuedJob(updatedJob.id);
    return updatedJob;
  }

  async adjustCredits(userId: string, amount: number, reason: string) {
    assertUuid(userId, 'userId');

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
    return this.prisma.reader.asset.findMany({
      where: { moderationStatus: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { email: true } } },
    });
  }

  async moderateAsset(assetId: string, status: 'approved' | 'rejected') {
    assertUuid(assetId, 'assetId');

    return this.prisma.asset.update({
      where: { id: assetId },
      data: { moderationStatus: status },
    });
  }

  async auditLog(
    actorUserId: string,
    action: string,
    targetType: string,
    targetId?: string,
    metadata?: Record<string, unknown>,
  ) {
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
