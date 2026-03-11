import net from 'node:net';
import path from 'node:path';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import dotenv from 'dotenv';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { createImageAdapter, createVideoAdapter } from '@snapgen/media-adapters';
import { getLocalStorageDir, getRedisConnectionConfig } from '@snapgen/config';

function loadWorkerEnv(): void {
  const candidatePaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../api/.env'),
    path.resolve(process.cwd(), '../../apps/api/.env'),
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../../api/.env'),
  ];

  for (const candidatePath of candidatePaths) {
    if (fsSync.existsSync(candidatePath)) {
      dotenv.config({ path: candidatePath, override: false });
    }
  }
}

loadWorkerEnv();

const prisma = new PrismaClient();
const connection = getRedisConnectionConfig(process.env.REDIS_URL);
const s3 =
  process.env.R2_ACCOUNT_ID &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  process.env.STORAGE_MODE !== 'local'
    ? new S3Client({
        region: 'auto',
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
        },
      })
    : null;

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

function getVideoProviderApiKey(provider: string): string {
  switch (provider) {
    case 'fal':
      return process.env.FAL_API_KEY || '';
    case 'kling':
      return process.env.KLING_API_KEY || '';
    default:
      return '';
  }
}

async function claimQueuedImageJob(jobId: string) {
  const genJob = await prisma.generationJob.findUnique({ where: { id: jobId } });
  if (!genJob) {
    console.warn(`[Worker] Skipping image job ${jobId}: database record not found`);
    return null;
  }

  if (genJob.jobType !== 'image') {
    console.warn(`[Worker] Skipping non-image job ${jobId} on image worker`);
    return null;
  }

  const claimed = await prisma.generationJob.updateMany({
    where: {
      id: jobId,
      status: 'queued',
    },
    data: {
      status: 'running',
      startedAt: new Date(),
      errorMessage: null,
      failedAt: null,
    },
  });

  if (claimed.count === 0) {
    console.log(`[Worker] Skipping image job ${jobId}: status is no longer queued`);
    return null;
  }

  return genJob;
}

async function claimQueuedVideoJob(jobId: string) {
  const genJob = await prisma.generationJob.findUnique({ where: { id: jobId } });
  if (!genJob) {
    console.warn(`[Worker] Skipping video job ${jobId}: database record not found`);
    return null;
  }

  if (genJob.jobType !== 'video') {
    console.warn(`[Worker] Skipping non-video job ${jobId} on video worker`);
    return null;
  }

  const claimed = await prisma.generationJob.updateMany({
    where: {
      id: jobId,
      status: 'queued',
    },
    data: {
      status: 'running',
      startedAt: new Date(),
      errorMessage: null,
      failedAt: null,
    },
  });

  if (claimed.count === 0) {
    console.log(`[Worker] Skipping video job ${jobId}: status is no longer queued`);
    return null;
  }

  return genJob;
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

function getExtensionForMimeType(mimeType: string, fallback: string): string {
  const extensionMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
  };

  return extensionMap[mimeType] || fallback;
}

async function persistRemoteOutput(
  bucket: string,
  key: string,
  url: string,
  contentType: string,
): Promise<{ contentType: string; sizeBytes: number; metadataJson: Record<string, string> }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download remote file: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const resolvedContentType =
    contentType || response.headers.get('content-type') || 'application/octet-stream';

  if (s3) {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: resolvedContentType,
      }),
    );
  } else {
    // Fallback: save to local filesystem
    const filePath = path.join(getLocalStorageDir(__dirname), bucket, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    console.warn(`[Worker] S3 not configured. Saved file locally: ${filePath}`);
  }

  return {
    contentType: resolvedContentType,
    sizeBytes: buffer.byteLength,
    metadataJson: { providerUrl: url },
  };
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
        const genJob = await claimQueuedImageJob(jobId);
        if (!genJob) {
          return;
        }

        const adapter = createImageAdapter(
          genJob.provider,
          getImageProviderApiKey(genJob.provider),
        );

        const settings = genJob.settingsJson as Record<string, unknown>;
        const result = await adapter.createJob({
          prompt: genJob.prompt || '',
          negativePrompt: genJob.negativePrompt || undefined,
          referenceImages: Array.isArray(settings.referenceImages)
            ? (settings.referenceImages as string[])
            : undefined,
          aspectRatio: settings.aspectRatio as string,
          numImages: (settings.numImages as number) || 4,
          seed: settings.seed as number,
          guidance: settings.guidance as number,
          settings: {
            characterName: settings.characterName,
          },
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
          const bucket = process.env.R2_BUCKET_OUTPUTS || 'outputs-private';
          const storageKey = `users/${genJob.userId}/jobs/${jobId}/outputs/${Date.now()}.${getExtensionForMimeType(output.mimeType, 'png')}`;
          const savedOutput = await persistRemoteOutput(
            bucket,
            storageKey,
            output.url,
            output.mimeType,
          );
          const asset = await prisma.asset.create({
            data: {
              userId: genJob.userId,
              kind: 'generated-image',
              storageBucket: bucket,
              storageKey,
              mimeType: savedOutput.contentType,
              fileSizeBytes: BigInt(savedOutput.sizeBytes),
              moderationStatus: 'approved',
              metadataJson: savedOutput.metadataJson,
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

  const videoWorker = new Worker(
    'video-generation',
    async (job: Job) => {
      const { jobId } = job.data;
      console.log(`[Worker] Processing video job: ${jobId}`);

      try {
        const genJob = await claimQueuedVideoJob(jobId);
        if (!genJob) {
          return;
        }

        const adapter = createVideoAdapter(
          genJob.provider,
          getVideoProviderApiKey(genJob.provider),
        );

        const settings = genJob.settingsJson as Record<string, unknown>;
        const result = await adapter.createJob({
          prompt: genJob.prompt || '',
          sourceImageUrl: settings.sourceImageUrl as string | undefined,
          aspectRatio: settings.aspectRatio as string | undefined,
          durationSec: settings.durationSec as number | undefined,
          settings: {
            motionAmount: settings.motionAmount,
            cameraControl: settings.cameraControl,
          },
        });

        let jobResult =
          result.status === 'completed'
            ? await adapter.getJob(result.externalJobId)
            : {
                status: result.status as 'queued' | 'running',
                outputs: undefined,
                errorMessage: undefined,
              };

        if (jobResult.status !== 'completed' && jobResult.status !== 'failed') {
          for (let attempts = 0; attempts < 120; attempts++) {
            await new Promise((resolve) => setTimeout(resolve, 5000));
            jobResult = await adapter.getJob(result.externalJobId);
            if (jobResult.status === 'completed' || jobResult.status === 'failed') {
              break;
            }
          }
        }

        if (jobResult.status === 'failed') {
          throw new Error(jobResult.errorMessage || 'Video generation failed');
        }

        if (!jobResult.outputs?.length) {
          throw new Error('Video generation completed without any outputs');
        }

        for (const output of jobResult.outputs) {
          const bucket = process.env.R2_BUCKET_OUTPUTS || 'outputs-private';
          const storageKey = `users/${genJob.userId}/jobs/${jobId}/outputs/${Date.now()}.${getExtensionForMimeType(output.mimeType, 'mp4')}`;
          const savedOutput = await persistRemoteOutput(
            bucket,
            storageKey,
            output.url,
            output.mimeType,
          );
          const asset = await prisma.asset.create({
            data: {
              userId: genJob.userId,
              kind: 'generated-video',
              storageBucket: bucket,
              storageKey,
              mimeType: savedOutput.contentType,
              fileSizeBytes: BigInt(savedOutput.sizeBytes),
              moderationStatus: 'approved',
              metadataJson: savedOutput.metadataJson,
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

        console.log(`[Worker] Video job completed: ${jobId}`);
      } catch (error) {
        console.error(`[Worker] Video job failed: ${jobId}`, error);

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
              reason: `Refund for failed video job ${jobId}`,
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
      concurrency: 2,
      limiter: {
        max: 5,
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

  videoWorker.on('completed', (job) => {
    console.log(`[Worker] Video job ${job.id} completed successfully`);
  });

  videoWorker.on('failed', (job, err) => {
    console.error(`[Worker] Video job ${job?.id} failed:`, err.message);
  });

  console.log('🔧 SnapGen Media Worker started');
  console.log('   Queues: image-generation, video-generation');
  console.log('   Concurrency: image=3, video=2');

  process.on('SIGTERM', async () => {
    console.log('[Worker] Shutting down...');
    await imageWorker.close();
    await videoWorker.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

void bootstrap();
