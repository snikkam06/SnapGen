import { Injectable, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { createImageAdapter } from '@snapgen/media-adapters';
import { PrismaService } from '../../prisma/prisma.service';
import { CREDIT_COSTS, VALID_JOB_TRANSITIONS } from '@snapgen/config';

@Injectable()
export class GenerationService {
    constructor(
        private prisma: PrismaService,
        @Optional() @InjectQueue('image-generation') private mediaQueue?: Queue,
    ) { }

    async createImageJob(clerkUserId: string, data: {
        characterId?: string;
        stylePackId?: string;
        prompt: string;
        negativePrompt?: string;
        settings?: Record<string, unknown>;
    }) {
        const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
        if (!user) throw new NotFoundException('User not found');

        const numImages = (data.settings?.numImages as number) || 4;
        const totalCost = CREDIT_COSTS.image * numImages;

        // Check balance
        const balance = await this.getBalance(user.id);
        if (balance < totalCost) {
            throw new BadRequestException(`Insufficient credits. Need ${totalCost}, have ${balance}.`);
        }

        // Reserve credits
        await this.prisma.creditLedger.create({
            data: {
                userId: user.id,
                amount: -totalCost,
                entryType: 'job_reservation',
                reason: `Image generation (${numImages} images)`,
            },
        });

        // Create job
        const job = await this.prisma.generationJob.create({
            data: {
                userId: user.id,
                characterId: data.characterId || null,
                stylePackId: data.stylePackId || null,
                jobType: 'image',
                status: 'queued',
                prompt: data.prompt,
                negativePrompt: data.negativePrompt || null,
                settingsJson: (data.settings || {}) as Prisma.InputJsonValue,
                provider: this.getImageProvider(),
                reservedCredits: totalCost,
            },
        });

        if (this.mediaQueue) {
            try {
                await this.mediaQueue.add('generate-image', { jobId: job.id });
            } catch (error) {
                void this.processImageJob(job.id);
            }
        } else {
            void this.processImageJob(job.id);
        }

        return {
            id: job.id,
            status: job.status,
            reservedCredits: job.reservedCredits,
            message: 'Image generation job queued',
        };
    }

    async createVideoJob(clerkUserId: string, data: {
        characterId?: string;
        prompt: string;
        sourceAssetId: string;
        settings?: Record<string, unknown>;
    }) {
        const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
        if (!user) throw new NotFoundException('User not found');

        const totalCost = CREDIT_COSTS.video;
        const balance = await this.getBalance(user.id);
        if (balance < totalCost) {
            throw new BadRequestException(`Insufficient credits. Need ${totalCost}, have ${balance}.`);
        }

        await this.prisma.creditLedger.create({
            data: {
                userId: user.id,
                amount: -totalCost,
                entryType: 'job_reservation',
                reason: 'Video generation',
            },
        });

        const job = await this.prisma.generationJob.create({
            data: {
                userId: user.id,
                characterId: data.characterId || null,
                jobType: 'video',
                status: 'queued',
                prompt: data.prompt,
                settingsJson: {
                    ...data.settings,
                    sourceAssetId: data.sourceAssetId,
                } as Prisma.InputJsonValue,
                provider: 'mock',
                reservedCredits: totalCost,
            },
        });

        return { id: job.id, status: job.status, reservedCredits: job.reservedCredits };
    }

    async createFaceSwapImageJob(clerkUserId: string, data: {
        sourceAssetId: string;
        targetAssetId: string;
    }) {
        const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
        if (!user) throw new NotFoundException('User not found');

        const totalCost = CREDIT_COSTS['faceswap-image'];
        const balance = await this.getBalance(user.id);
        if (balance < totalCost) {
            throw new BadRequestException(`Insufficient credits.`);
        }

        await this.prisma.creditLedger.create({
            data: {
                userId: user.id,
                amount: -totalCost,
                entryType: 'job_reservation',
                reason: 'Face swap image',
            },
        });

        const job = await this.prisma.generationJob.create({
            data: {
                userId: user.id,
                jobType: 'faceswap-image',
                status: 'queued',
                settingsJson: data as Prisma.InputJsonValue,
                provider: 'mock',
                reservedCredits: totalCost,
            },
        });

        return { id: job.id, status: job.status, reservedCredits: job.reservedCredits };
    }

    async createUpscaleJob(clerkUserId: string, data: {
        assetId: string;
        mode?: string;
    }) {
        const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
        if (!user) throw new NotFoundException('User not found');

        const totalCost = CREDIT_COSTS.upscale;
        const balance = await this.getBalance(user.id);
        if (balance < totalCost) {
            throw new BadRequestException(`Insufficient credits.`);
        }

        await this.prisma.creditLedger.create({
            data: {
                userId: user.id,
                amount: -totalCost,
                entryType: 'job_reservation',
                reason: 'Image upscale',
            },
        });

        const job = await this.prisma.generationJob.create({
            data: {
                userId: user.id,
                jobType: 'upscale',
                status: 'queued',
                settingsJson: data as Prisma.InputJsonValue,
                provider: 'mock',
                reservedCredits: totalCost,
            },
        });

        return { id: job.id, status: job.status, reservedCredits: job.reservedCredits };
    }

    private async getBalance(userId: string): Promise<number> {
        const result = await this.prisma.creditLedger.aggregate({
            where: { userId },
            _sum: { amount: true },
        });
        return result._sum.amount || 0;
    }

    private getImageProvider(): string {
        if (process.env.IMAGE_PROVIDER) {
            return process.env.IMAGE_PROVIDER;
        }

        if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
            return 'google';
        }

        if (process.env.REPLICATE_API_TOKEN) {
            return 'replicate';
        }

        if (process.env.FAL_API_KEY) {
            return 'fal';
        }

        return 'mock';
    }

    private async processImageJob(jobId: string): Promise<void> {
        const genJob = await this.prisma.generationJob.findUnique({ where: { id: jobId } });
        if (!genJob) {
            return;
        }

        try {
            await this.prisma.generationJob.update({
                where: { id: jobId },
                data: {
                    status: 'running',
                    startedAt: new Date(),
                },
            });

            const settings = (genJob.settingsJson || {}) as Record<string, unknown>;
            const adapter = createImageAdapter(
                genJob.provider,
                this.getImageProviderApiKey(genJob.provider),
            );

            const createdJob = await adapter.createJob({
                prompt: genJob.prompt || '',
                negativePrompt: genJob.negativePrompt || undefined,
                aspectRatio: settings.aspectRatio as string,
                numImages: (settings.numImages as number) || 4,
                seed: settings.seed as number,
                guidance: settings.guidance as number,
            });

            const resolvedJob = await this.resolveImageJob(adapter, createdJob.externalJobId, createdJob.status);
            if (resolvedJob.status === 'failed') {
                throw new Error(resolvedJob.errorMessage || 'Generation failed');
            }

            if (!resolvedJob.outputs?.length) {
                throw new Error('Generation completed without any outputs');
            }

            await this.persistJobOutputs(jobId, genJob.userId, resolvedJob.outputs);

            await this.prisma.generationJob.update({
                where: { id: jobId },
                data: {
                    status: 'completed',
                    externalJobId: createdJob.externalJobId,
                    finalCredits: genJob.reservedCredits,
                    completedAt: new Date(),
                },
            });
        } catch (error) {
            await this.prisma.generationJob.update({
                where: { id: jobId },
                data: {
                    status: 'failed',
                    errorMessage: error instanceof Error ? error.message : 'Unknown error',
                    failedAt: new Date(),
                },
            });

            await this.prisma.creditLedger.create({
                data: {
                    userId: genJob.userId,
                    amount: genJob.reservedCredits,
                    entryType: 'job_refund',
                    reason: `Refund for failed job ${jobId}`,
                    referenceType: 'job',
                    referenceId: jobId,
                },
            });
        }
    }

    private async resolveImageJob(
        adapter: ReturnType<typeof createImageAdapter>,
        externalJobId: string,
        initialStatus: 'queued' | 'running' | 'completed',
    ): Promise<{
        status: 'queued' | 'running' | 'completed' | 'failed';
        outputs?: Array<{ url: string; mimeType: string }>;
        errorMessage?: string;
    }> {
        let jobResult =
            initialStatus === 'completed'
                ? await adapter.getJob(externalJobId)
                : { status: initialStatus, outputs: undefined };

        if (jobResult.status === 'completed' || jobResult.status === 'failed') {
            return jobResult;
        }

        for (let attempts = 0; attempts < 60; attempts++) {
            await new Promise((resolve) => setTimeout(resolve, 5000));
            jobResult = await adapter.getJob(externalJobId);
            if (jobResult.status === 'completed' || jobResult.status === 'failed') {
                return jobResult;
            }
        }

        return {
            status: 'failed',
            errorMessage: 'Timed out waiting for image generation to complete',
        };
    }

    private async persistJobOutputs(
        jobId: string,
        userId: string,
        outputs: Array<{ url: string; mimeType: string }>,
    ): Promise<void> {
        for (const output of outputs) {
            const asset = await this.prisma.asset.create({
                data: {
                    userId,
                    kind: 'generated-image',
                    storageBucket: process.env.R2_BUCKET_OUTPUTS || 'outputs-private',
                    storageKey: `users/${userId}/jobs/${jobId}/outputs/${Date.now()}.png`,
                    mimeType: output.mimeType,
                    fileSizeBytes: BigInt(0),
                    moderationStatus: 'approved',
                    metadataJson: { sourceUrl: output.url },
                },
            });

            await this.prisma.jobAsset.create({
                data: {
                    jobId,
                    assetId: asset.id,
                    relation: 'output',
                },
            });
        }
    }

    private getImageProviderApiKey(provider: string): string {
        switch (provider) {
            case 'google':
            case 'gemini':
                return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
            case 'replicate':
                return process.env.REPLICATE_API_TOKEN || '';
            case 'fal':
                return process.env.FAL_API_KEY || '';
            default:
                return '';
        }
    }
}
