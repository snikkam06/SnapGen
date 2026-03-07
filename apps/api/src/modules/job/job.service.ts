import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class JobService {
    constructor(
        private prisma: PrismaService,
        private storageService: StorageService,
    ) { }

    async findAll(clerkUserId: string, filters?: { status?: string; jobType?: string }) {
        const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
        if (!user) throw new NotFoundException('User not found');

        const where: Record<string, unknown> = { userId: user.id };
        if (filters?.status) where.status = filters.status;
        if (filters?.jobType) where.jobType = filters.jobType;

        const jobs = await this.prisma.generationJob.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: 50,
        });

        return jobs.map((job) => ({
            ...job,
            createdAt: job.createdAt.toISOString(),
            completedAt: job.completedAt?.toISOString() || null,
        }));
    }

    async findOne(clerkUserId: string, id: string) {
        const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
        if (!user) throw new NotFoundException('User not found');

        const job = await this.prisma.generationJob.findUnique({
            where: { id },
            include: {
                jobAssets: {
                    include: { asset: true },
                },
            },
        });

        if (!job) throw new NotFoundException('Job not found');
        if (job.userId !== user.id) throw new ForbiddenException();

        return {
            id: job.id,
            jobType: job.jobType,
            status: job.status,
            prompt: job.prompt,
            provider: job.provider,
            reservedCredits: job.reservedCredits,
            finalCredits: job.finalCredits,
            createdAt: job.createdAt.toISOString(),
            completedAt: job.completedAt?.toISOString() || null,
            characterId: job.characterId,
            stylePackId: job.stylePackId,
            negativePrompt: job.negativePrompt,
            settingsJson: job.settingsJson,
            externalJobId: job.externalJobId,
            errorMessage: job.errorMessage,
            startedAt: job.startedAt?.toISOString() || null,
            failedAt: job.failedAt?.toISOString() || null,
            outputs: await Promise.all(
                job.jobAssets
                    .filter((jobAsset) => jobAsset.relation === 'output')
                    .map(async ({ asset }) => {
                        const metadata = asset.metadataJson as Record<string, unknown> | null;
                        const sourceUrl =
                            typeof metadata?.sourceUrl === 'string' ? metadata.sourceUrl : null;

                        return {
                            id: asset.id,
                            kind: asset.kind,
                            mimeType: asset.mimeType,
                            width: asset.width,
                            height: asset.height,
                            url:
                                sourceUrl ||
                                (await this.storageService.getSignedDownloadUrl(
                                    asset.storageBucket,
                                    asset.storageKey,
                                )),
                            createdAt: asset.createdAt.toISOString(),
                        };
                    }),
            ),
        };
    }
}
