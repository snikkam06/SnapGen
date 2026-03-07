import 'dotenv/config';
import net from 'node:net';
import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { createImageAdapter } from '@snapgen/media-adapters';
import { getRedisConnectionConfig } from '@snapgen/config';

const prisma = new PrismaClient();
const connection = getRedisConnectionConfig(process.env.REDIS_URL);

function getImageProviderApiKey(provider: string): string {
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

async function isRedisReachable(): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = net.createConnection({
            host: connection.host,
            port: connection.port,
        });

        const finish = (reachable: boolean) => {
            socket.destroy();
            resolve(reachable);
        };

        socket.setTimeout(750);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false));
        socket.once('error', () => finish(false));
    });
}

async function bootstrap() {
    if (!(await isRedisReachable())) {
        console.warn('Redis is unavailable. Media worker is disabled.');
        await prisma.$disconnect();
        process.exit(0);
    }

    const imageWorker = new Worker(
        'image-generation',
        async (job: Job) => {
            const { jobId } = job.data;
            console.log(`[Worker] Processing image job: ${jobId}`);

            try {
                const genJob = await prisma.generationJob.findUnique({ where: { id: jobId } });
                if (!genJob) throw new Error(`Job ${jobId} not found`);

                await prisma.generationJob.update({
                    where: { id: jobId },
                    data: { status: 'running', startedAt: new Date() },
                });

                const adapter = createImageAdapter(
                    genJob.provider,
                    getImageProviderApiKey(genJob.provider),
                );

                const settings = genJob.settingsJson as Record<string, unknown>;
                const result = await adapter.createJob({
                    prompt: genJob.prompt || '',
                    negativePrompt: genJob.negativePrompt || undefined,
                    aspectRatio: settings.aspectRatio as string,
                    numImages: (settings.numImages as number) || 4,
                    seed: settings.seed as number,
                    guidance: settings.guidance as number,
                });

                let jobResult =
                    result.status === 'completed'
                        ? await adapter.getJob(result.externalJobId)
                        : { status: result.status as 'queued' | 'running', outputs: undefined };

                if (jobResult.status !== 'completed') {
                    for (let attempts = 0; attempts < 60; attempts++) {
                        await new Promise((resolve) => setTimeout(resolve, 5000));
                        jobResult = await adapter.getJob(result.externalJobId);
                        if (jobResult.status === 'completed' || jobResult.status === 'failed') {
                            break;
                        }
                    }
                }

                if (jobResult.status === 'failed') {
                    throw new Error(jobResult.errorMessage || 'Generation failed');
                }

                if (!jobResult.outputs?.length) {
                    throw new Error('Generation completed without any outputs');
                }

                for (const output of jobResult.outputs) {
                    const asset = await prisma.asset.create({
                        data: {
                            userId: genJob.userId,
                            kind: 'generated-image',
                            storageBucket: process.env.R2_BUCKET_OUTPUTS || 'outputs-private',
                            storageKey: `users/${genJob.userId}/jobs/${jobId}/outputs/${Date.now()}.png`,
                            mimeType: output.mimeType,
                            fileSizeBytes: BigInt(0),
                            moderationStatus: 'approved',
                            metadataJson: { sourceUrl: output.url },
                        },
                    });

                    await prisma.jobAsset.create({
                        data: {
                            jobId,
                            assetId: asset.id,
                            relation: 'output',
                        },
                    });
                }

                await prisma.generationJob.update({
                    where: { id: jobId },
                    data: {
                        status: 'completed',
                        externalJobId: result.externalJobId,
                        finalCredits: genJob.reservedCredits,
                        completedAt: new Date(),
                    },
                });

                console.log(`[Worker] Image job completed: ${jobId}`);
            } catch (error) {
                console.error(`[Worker] Image job failed: ${jobId}`, error);

                await prisma.generationJob.update({
                    where: { id: jobId },
                    data: {
                        status: 'failed',
                        errorMessage: error instanceof Error ? error.message : 'Unknown error',
                        failedAt: new Date(),
                    },
                });

                const genJob = await prisma.generationJob.findUnique({ where: { id: jobId } });
                if (genJob) {
                    await prisma.creditLedger.create({
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

                throw error;
            }
        },
        {
            connection,
            concurrency: 3,
            limiter: {
                max: 10,
                duration: 60000,
            },
        },
    );

    imageWorker.on('completed', (job) => {
        console.log(`[Worker] Job ${job.id} completed successfully`);
    });

    imageWorker.on('failed', (job, err) => {
        console.error(`[Worker] Job ${job?.id} failed:`, err.message);
    });

    console.log('🔧 SnapGen Media Worker started');
    console.log('   Queues: image-generation');
    console.log('   Concurrency: 3');

    process.on('SIGTERM', async () => {
        console.log('[Worker] Shutting down...');
        await imageWorker.close();
        await prisma.$disconnect();
        process.exit(0);
    });
}

void bootstrap();
