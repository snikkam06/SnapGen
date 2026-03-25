import net from 'node:net';
import path from 'node:path';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Worker, Queue, Job } from 'bullmq';
import { PrismaClient, GenerationJob } from '@prisma/client';
import { Redis } from 'ioredis';
import { createImageAdapter, createVideoAdapter, createFaceSwapAdapter } from '@snapgen/media-adapters';
import { assertValidSupabaseDatabaseConfig, getLocalStorageDir, getRedisConnectionConfig } from '@snapgen/config';

function clearEmptyEnvVar(name: string): void {
  if (process.env[name]?.trim() === '') {
    delete process.env[name];
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const LOCAL_DB_PORT = process.env.SNAPGEN_LOCAL_DB_PORT || '55432';
const DEFAULT_DB_CONNECTION_LIMIT = process.env.SNAPGEN_DB_CONNECTION_LIMIT || '2';
const DEFAULT_DB_POOL_TIMEOUT_SEC = process.env.SNAPGEN_DB_POOL_TIMEOUT_SEC || '30';

function hasLocalDbCluster(): boolean {
  const candidatePaths = [
    path.resolve(process.cwd(), '.local/postgres/PG_VERSION'),
    path.resolve(process.cwd(), '../../.local/postgres/PG_VERSION'),
    path.resolve(__dirname, '../../../../.local/postgres/PG_VERSION'),
  ];

  return candidatePaths.some((candidatePath) => fsSync.existsSync(candidatePath));
}

function normalizeDatabaseUrl(
  rawValue?: string,
  options?: { applyRuntimePoolTuning?: boolean },
): string | undefined {
  if (!rawValue?.trim()) {
    return undefined;
  }

  try {
    const parsed = new URL(rawValue);
    if (hasLocalDbCluster() && LOCAL_HOSTS.has(parsed.hostname)) {
      parsed.port = LOCAL_DB_PORT;
    }

    if (parsed.protocol.startsWith('postgres') && isSupabaseTransactionPoolerUrl(parsed)) {
      parsed.searchParams.set('pgbouncer', 'true');
    }

    if (options?.applyRuntimePoolTuning && parsed.protocol.startsWith('postgres')) {
      if (!parsed.searchParams.has('connection_limit')) {
        parsed.searchParams.set('connection_limit', DEFAULT_DB_CONNECTION_LIMIT);
      }
      if (!parsed.searchParams.has('pool_timeout')) {
        parsed.searchParams.set('pool_timeout', DEFAULT_DB_POOL_TIMEOUT_SEC);
      }
    }

    return parsed.toString();
  } catch {
    return rawValue;
  }
}

function loadWorkerEnv(): void {
  clearEmptyEnvVar('DATABASE_URL');
  clearEmptyEnvVar('DIRECT_URL');
  clearEmptyEnvVar('DATABASE_READ_URL');

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

  // Pool tuning is deferred to the auto-sizing block after concurrency constants are parsed.
  // Only apply local port override and pool_timeout here.
  const databaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL, {
    applyRuntimePoolTuning: false,
  });
  const directUrl = normalizeDatabaseUrl(process.env.DIRECT_URL);
  const readUrl = normalizeDatabaseUrl(process.env.DATABASE_READ_URL);

  if (databaseUrl) {
    process.env.DATABASE_URL = databaseUrl;
  }

  if (directUrl) {
    process.env.DIRECT_URL = directUrl;
  }

  if (readUrl) {
    process.env.DATABASE_READ_URL = readUrl;
  }

  assertValidSupabaseDatabaseConfig({
    databaseUrl: process.env.DATABASE_URL,
    directUrl: process.env.DIRECT_URL,
    readUrl: process.env.DATABASE_READ_URL,
    context: 'Worker DB config',
  });
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

// ─── Env-configurable concurrency & limiter ──────────
function parsePositiveInt(value: string | undefined, defaultVal: number, name: string): number {
  if (!value) return defaultVal;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    console.warn(`[Worker] Invalid ${name}="${value}", using default ${defaultVal}`);
    return defaultVal;
  }
  return Math.floor(parsed);
}

function isSupabaseTransactionPoolerUrl(parsed: URL): boolean {
  return parsed.hostname.endsWith('.pooler.supabase.com') && parsed.port === '6543';
}

const IMAGE_CONCURRENCY = parsePositiveInt(process.env.IMAGE_WORKER_CONCURRENCY, 3, 'IMAGE_WORKER_CONCURRENCY');
const VIDEO_CONCURRENCY = parsePositiveInt(process.env.VIDEO_WORKER_CONCURRENCY, 2, 'VIDEO_WORKER_CONCURRENCY');
const FACESWAP_CONCURRENCY = parsePositiveInt(process.env.FACESWAP_WORKER_CONCURRENCY, 2, 'FACESWAP_WORKER_CONCURRENCY');
const IMAGE_LIMITER_MAX = parsePositiveInt(process.env.IMAGE_WORKER_LIMITER_MAX, 10, 'IMAGE_WORKER_LIMITER_MAX');
const VIDEO_LIMITER_MAX = parsePositiveInt(process.env.VIDEO_WORKER_LIMITER_MAX, 5, 'VIDEO_WORKER_LIMITER_MAX');
const FACESWAP_LIMITER_MAX = parsePositiveInt(process.env.FACESWAP_WORKER_LIMITER_MAX, 5, 'FACESWAP_LIMITER_MAX');
const TOTAL_POLL_CONCURRENCY = parsePositiveInt(
  process.env.POLL_WORKER_CONCURRENCY,
  20,
  'POLL_WORKER_CONCURRENCY',
);
const POLL_QUEUE_COUNT = 3;
const POLL_CONCURRENCY_PER_QUEUE = Math.max(1, Math.ceil(TOTAL_POLL_CONCURRENCY / POLL_QUEUE_COUNT));

// Keep runtime pool sizes small by default unless the user explicitly overrides them.
const WORKER_TOTAL_CONCURRENCY = IMAGE_CONCURRENCY + VIDEO_CONCURRENCY + FACESWAP_CONCURRENCY;
const AUTO_DB_POOL_SIZE = WORKER_TOTAL_CONCURRENCY + TOTAL_POLL_CONCURRENCY + 3;
if (process.env.DATABASE_URL) {
  try {
    const dbUrl = new URL(process.env.DATABASE_URL);
    if (isSupabaseTransactionPoolerUrl(dbUrl)) {
      dbUrl.searchParams.set('pgbouncer', 'true');
    }
    if (!dbUrl.searchParams.has('connection_limit')) {
      const poolSize = process.env.SNAPGEN_DB_CONNECTION_LIMIT
        || (isSupabaseTransactionPoolerUrl(dbUrl) ? String(Math.min(AUTO_DB_POOL_SIZE, 10)) : '2');
      dbUrl.searchParams.set('connection_limit', poolSize);
    }
    if (!dbUrl.searchParams.has('pool_timeout')) {
      dbUrl.searchParams.set('pool_timeout', DEFAULT_DB_POOL_TIMEOUT_SEC);
    }
    process.env.DATABASE_URL = dbUrl.toString();
    const poolMode = isSupabaseTransactionPoolerUrl(dbUrl) ? 'transaction-pooled' : 'session/direct';
    console.log(
      `[Worker] DB pool: connection_limit=${dbUrl.searchParams.get('connection_limit')} (${poolMode}, concurrency ${WORKER_TOTAL_CONCURRENCY}+${TOTAL_POLL_CONCURRENCY} poll)`,
    );
  } catch {
    // Leave DATABASE_URL unchanged if parsing fails
  }
}

// ─── Provider-aware concurrency semaphore ────────────
class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }
}

const providerSemaphores: Record<string, Semaphore> = {
  fal: new Semaphore(parsePositiveInt(process.env.FAL_CONCURRENCY_LIMIT, 10, 'FAL_CONCURRENCY_LIMIT')),
  replicate: new Semaphore(parsePositiveInt(process.env.REPLICATE_CONCURRENCY_LIMIT, 5, 'REPLICATE_CONCURRENCY_LIMIT')),
  google: new Semaphore(parsePositiveInt(process.env.GOOGLE_CONCURRENCY_LIMIT, 5, 'GOOGLE_CONCURRENCY_LIMIT')),
  gemini: new Semaphore(parsePositiveInt(process.env.GOOGLE_CONCURRENCY_LIMIT, 5, 'GOOGLE_CONCURRENCY_LIMIT')),
  mock: new Semaphore(100),
};

function getProviderSemaphore(provider: string): Semaphore {
  return providerSemaphores[provider] ?? new Semaphore(5);
}

// ─── Redis pub/sub publisher ─────────────────────────
let eventPublisher: Redis | null = null;
let eventPublisherInitializing = false;

function getEventPublisher(): Redis | null {
  if (eventPublisher) return eventPublisher;
  if (eventPublisherInitializing) return null;
  eventPublisherInitializing = true;
  try {
    eventPublisher = new Redis({
      host: connection.host,
      port: connection.port,
      db: connection.db,
      username: connection.username,
      password: connection.password,
      tls: connection.tls,
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    eventPublisher.on('error', (err: Error) => {
      console.warn('[Worker] Event publisher error:', err.message);
    });
    void eventPublisher.connect().catch(() => {
      eventPublisher = null;
      eventPublisherInitializing = false;
    });
    return eventPublisher;
  } catch {
    eventPublisherInitializing = false;
    return null;
  }
}

async function publishJobEvent(userId: string, job: GenerationJob): Promise<void> {
  const pub = getEventPublisher();
  if (!pub) return;

  const channel = `job-events:user:${userId}`;
  const event = {
    jobId: job.id,
    jobType: job.jobType,
    status: job.status,
    reservedCredits: job.reservedCredits,
    finalCredits: job.finalCredits,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    failedAt: job.failedAt?.toISOString() ?? null,
  };

  try {
    await pub.publish(channel, JSON.stringify(event));
  } catch (err) {
    console.warn('[Worker] Failed to publish job event:', err);
  }
}

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

function getFaceSwapProviderApiKey(provider: string): string {
  switch (provider) {
    case 'fal':
      return process.env.FAL_API_KEY || '';
    default:
      return '';
  }
}

async function claimQueuedJob(jobId: string, expectedJobType: string) {
  const genJob = await prisma.generationJob.findUnique({ where: { id: jobId } });
  if (!genJob) {
    console.warn(`[Worker] Skipping ${expectedJobType} job ${jobId}: database record not found`);
    return null;
  }

  if (genJob.jobType !== expectedJobType) {
    console.warn(`[Worker] Skipping job ${jobId}: expected ${expectedJobType}, got ${genJob.jobType}`);
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
    console.log(`[Worker] Skipping ${expectedJobType} job ${jobId}: status is no longer queued`);
    return null;
  }

  // Publish running event
  const runningJob = { ...genJob, status: 'running', startedAt: new Date() };
  await publishJobEvent(genJob.userId, runningJob as GenerationJob);

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

async function completeJob(
  jobId: string,
  userId: string,
  externalJobId: string,
  reservedCredits: number,
): Promise<void> {
  const updatedJob = await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: 'completed',
      externalJobId,
      finalCredits: reservedCredits,
      completedAt: new Date(),
    },
  });
  await publishJobEvent(userId, updatedJob);
}

async function failJob(
  jobId: string,
  errorMessage: string,
): Promise<void> {
  const updatedJob = await prisma.$transaction(async (tx) => {
    const job = await tx.generationJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        errorMessage,
        failedAt: new Date(),
      },
    });

    if (job.reservedCredits > 0) {
      await tx.creditLedger.create({
        data: {
          userId: job.userId,
          amount: job.reservedCredits,
          entryType: 'job_refund',
          reason: `Refund for failed job ${jobId}`,
          referenceType: 'job',
          referenceId: jobId,
        },
      });
    }

    return job;
  });

  await publishJobEvent(updatedJob.userId, updatedJob);
}

async function saveOutputAssets(
  jobId: string,
  userId: string,
  outputs: Array<{ url: string; mimeType: string }>,
  kind: string,
  fallbackExt: string,
): Promise<void> {
  for (const [index, output] of outputs.entries()) {
    const bucket = process.env.R2_BUCKET_OUTPUTS || 'outputs-private';
    const storageKey = `users/${userId}/jobs/${jobId}/outputs/${Date.now()}-${index}-${randomUUID()}.${getExtensionForMimeType(output.mimeType, fallbackExt)}`;
    const savedOutput = await persistRemoteOutput(bucket, storageKey, output.url, output.mimeType);
    const asset = await prisma.asset.create({
      data: {
        userId,
        kind,
        storageBucket: bucket,
        storageKey,
        mimeType: savedOutput.contentType,
        fileSizeBytes: BigInt(savedOutput.sizeBytes),
        moderationStatus: 'approved',
        metadataJson: savedOutput.metadataJson,
      },
    });

    await prisma.jobAsset.create({
      data: { jobId, assetId: asset.id, relation: 'output' },
    });
  }
}

// ─── Shared finalization helpers ─────────────────────
async function finalizeImageJob(
  jobId: string,
  genJob: GenerationJob,
  outputs: Array<{ url: string; mimeType: string }>,
  externalJobId: string,
): Promise<void> {
  await saveOutputAssets(jobId, genJob.userId, outputs, 'generated-image', 'png');
  await completeJob(jobId, genJob.userId, externalJobId, genJob.reservedCredits);
  console.log(`[Worker] Image job completed: ${jobId}`);
}

async function finalizeVideoJob(
  jobId: string,
  genJob: GenerationJob,
  outputs: Array<{ url: string; mimeType: string }>,
  externalJobId: string,
): Promise<void> {
  await saveOutputAssets(jobId, genJob.userId, outputs, 'generated-video', 'mp4');
  await completeJob(jobId, genJob.userId, externalJobId, genJob.reservedCredits);
  console.log(`[Worker] Video job completed: ${jobId}`);
}

async function finalizeFaceSwapJob(
  jobId: string,
  genJob: GenerationJob,
  outputs: Array<{ url: string; mimeType: string }>,
  externalJobId: string,
): Promise<void> {
  await saveOutputAssets(jobId, genJob.userId, outputs, 'generated-image', 'png');
  await completeJob(jobId, genJob.userId, externalJobId, genJob.reservedCredits);
  console.log(`[Worker] Faceswap job completed: ${jobId}`);
}

// ─── Poll handler: check status, finalize or reschedule ─
async function handlePollJob(
  job: Job,
  pollQueue: Queue,
  pollJobName: string,
  getAdapter: (provider: string, apiKey: string) => { getJob: (id: string) => Promise<any> },
  getApiKey: (provider: string) => string,
  finalize: (jobId: string, genJob: GenerationJob, outputs: any[], externalJobId: string) => Promise<void>,
  maxAttempts: number,
): Promise<void> {
  const { jobId, externalJobId, attempts, provider } = job.data;

  const genJob = await prisma.generationJob.findUnique({ where: { id: jobId } });
  if (!genJob || genJob.status !== 'running') return; // already handled

  const sem = getProviderSemaphore(provider);
  await sem.acquire();
  let result;
  try {
    const adapter = getAdapter(provider, getApiKey(provider));
    result = await adapter.getJob(externalJobId);
  } finally {
    sem.release();
  }

  if (result.status === 'completed') {
    if (!result.outputs?.length) {
      await failJob(jobId, 'Generation completed without any outputs');
      return;
    }
    await finalize(jobId, genJob, result.outputs, externalJobId);
    return;
  }

  if (result.status === 'failed' || attempts >= maxAttempts) {
    await failJob(jobId, result.errorMessage ?? 'Job timed out');
    return;
  }

  // Reschedule — slot freed between polls
  await pollQueue.add(
    pollJobName,
    { jobId, externalJobId, attempts: attempts + 1, provider },
    { delay: 5000, removeOnComplete: 10, removeOnFail: 50 },
  );
}

async function bootstrap() {
  if (!(await isRedisReachable())) {
    console.warn('Redis is unavailable. Media worker is disabled.');
    await prisma.$disconnect();
    process.exit(0);
  }

  // ─── Poll queues (used by dispatch handlers to schedule poll jobs) ──
  const imagePollQueue = new Queue('image-poll', { connection });
  const videoPollQueue = new Queue('video-poll', { connection });
  const faceswapPollQueue = new Queue('faceswap-poll', { connection });

  // ─── Image Dispatch Worker ─────────────────────────
  const imageDispatchWorker = new Worker(
    'image-generation',
    async (job: Job) => {
      const { jobId } = job.data;
      console.log(`[Worker] Dispatching image job: ${jobId}`);

      try {
        const genJob = await claimQueuedJob(jobId, 'image');
        if (!genJob) return;

        const sem = getProviderSemaphore(genJob.provider);
        await sem.acquire();
        let result;
        try {
          const adapter = createImageAdapter(
            genJob.provider,
            getImageProviderApiKey(genJob.provider),
          );

          const settings = genJob.settingsJson as Record<string, unknown>;
          result = await adapter.createJob({
            prompt: genJob.prompt || '',
            negativePrompt: genJob.negativePrompt || undefined,
            referenceImages: Array.isArray(settings.referenceImages)
              ? (settings.referenceImages as string[])
              : undefined,
            aspectRatio: settings.aspectRatio as string,
            numImages: (settings.numImages as number) || 4,
            seed: settings.seed as number,
            guidance: settings.guidance as number,
            settings: { characterName: settings.characterName },
          });
        } finally {
          sem.release();
        }

        // Store the external ID so the poll worker knows what to check
        await prisma.generationJob.update({
          where: { id: jobId },
          data: { externalJobId: result.externalJobId },
        });

        if (result.status === 'completed') {
          // Provider returned immediately — check for outputs inline
          const adapter = createImageAdapter(
            genJob.provider,
            getImageProviderApiKey(genJob.provider),
          );
          const completed = await adapter.getJob(result.externalJobId);
          if (completed.outputs?.length) {
            await finalizeImageJob(jobId, genJob, completed.outputs, result.externalJobId);
            return;
          }
        }

        // Schedule the poll job — dispatch slot is now FREE
        await imagePollQueue.add(
          'poll-image',
          { jobId, externalJobId: result.externalJobId, attempts: 0, provider: genJob.provider },
          { delay: 5000, removeOnComplete: 10, removeOnFail: 50 },
        );
      } catch (error) {
        console.error(`[Worker] Image dispatch failed: ${jobId}`, error);
        await failJob(jobId, error instanceof Error ? error.message : 'Unknown error');
        throw error;
      }
    },
    {
      connection,
      concurrency: IMAGE_CONCURRENCY,
      limiter: { max: IMAGE_LIMITER_MAX, duration: 60000 },
    },
  );

  // ─── Image Poll Worker ─────────────────────────────
  const imagePollWorker = new Worker(
    'image-poll',
    async (job: Job) => {
      try {
        await handlePollJob(
          job,
          imagePollQueue,
          'poll-image',
          (provider, apiKey) => createImageAdapter(provider, apiKey),
          getImageProviderApiKey,
          finalizeImageJob,
          60, // 60 × 5s = 5 min max
        );
      } catch (error) {
        const { jobId } = job.data;
        console.error(`[Worker] Image poll failed: ${jobId}`, error);
        await failJob(jobId, error instanceof Error ? error.message : 'Unknown error');
        throw error;
      }
    },
    { connection, concurrency: POLL_CONCURRENCY_PER_QUEUE },
  );

  // ─── Video Dispatch Worker ─────────────────────────
  const videoDispatchWorker = new Worker(
    'video-generation',
    async (job: Job) => {
      const { jobId } = job.data;
      console.log(`[Worker] Dispatching video job: ${jobId}`);

      try {
        const genJob = await claimQueuedJob(jobId, 'video');
        if (!genJob) return;

        const sem = getProviderSemaphore(genJob.provider);
        await sem.acquire();
        let result;
        try {
          const adapter = createVideoAdapter(
            genJob.provider,
            getVideoProviderApiKey(genJob.provider),
          );

          const settings = genJob.settingsJson as Record<string, unknown>;
          result = await adapter.createJob({
            prompt: genJob.prompt || '',
            sourceImageUrl: settings.sourceImageUrl as string | undefined,
            aspectRatio: settings.aspectRatio as string | undefined,
            durationSec: settings.durationSec as number | undefined,
            settings: {
              motionAmount: settings.motionAmount,
              cameraControl: settings.cameraControl,
            },
          });
        } finally {
          sem.release();
        }

        await prisma.generationJob.update({
          where: { id: jobId },
          data: { externalJobId: result.externalJobId },
        });

        if (result.status === 'completed') {
          const adapter = createVideoAdapter(
            genJob.provider,
            getVideoProviderApiKey(genJob.provider),
          );
          const completed = await adapter.getJob(result.externalJobId);
          if (completed.outputs?.length) {
            await finalizeVideoJob(jobId, genJob, completed.outputs, result.externalJobId);
            return;
          }
        }

        await videoPollQueue.add(
          'poll-video',
          { jobId, externalJobId: result.externalJobId, attempts: 0, provider: genJob.provider },
          { delay: 5000, removeOnComplete: 10, removeOnFail: 50 },
        );
      } catch (error) {
        console.error(`[Worker] Video dispatch failed: ${jobId}`, error);
        await failJob(jobId, error instanceof Error ? error.message : 'Unknown error');
        throw error;
      }
    },
    {
      connection,
      concurrency: VIDEO_CONCURRENCY,
      limiter: { max: VIDEO_LIMITER_MAX, duration: 60000 },
    },
  );

  // ─── Video Poll Worker ─────────────────────────────
  const videoPollWorker = new Worker(
    'video-poll',
    async (job: Job) => {
      try {
        await handlePollJob(
          job,
          videoPollQueue,
          'poll-video',
          (provider, apiKey) => createVideoAdapter(provider, apiKey),
          getVideoProviderApiKey,
          finalizeVideoJob,
          120, // 120 × 5s = 10 min max for video
        );
      } catch (error) {
        const { jobId } = job.data;
        console.error(`[Worker] Video poll failed: ${jobId}`, error);
        await failJob(jobId, error instanceof Error ? error.message : 'Unknown error');
        throw error;
      }
    },
    { connection, concurrency: POLL_CONCURRENCY_PER_QUEUE },
  );

  // ─── Face Swap Dispatch Worker ─────────────────────
  const faceswapDispatchWorker = new Worker(
    'faceswap-generation',
    async (job: Job) => {
      const { jobId } = job.data;
      console.log(`[Worker] Dispatching faceswap job: ${jobId}`);

      try {
        const genJob = await claimQueuedJob(jobId, 'faceswap-image');
        if (!genJob) return;

        const sem = getProviderSemaphore(genJob.provider);
        await sem.acquire();
        let result;
        try {
          const adapter = createFaceSwapAdapter(
            genJob.provider,
            getFaceSwapProviderApiKey(genJob.provider),
          );

          const settings = genJob.settingsJson as Record<string, unknown>;
          result = await adapter.createJob({
            sourceFaceUrl: settings.sourceFaceUrl as string,
            targetImageUrl: settings.targetImageUrl as string,
          });
        } finally {
          sem.release();
        }

        await prisma.generationJob.update({
          where: { id: jobId },
          data: { externalJobId: result.externalJobId },
        });

        if (result.status === 'completed') {
          const adapter = createFaceSwapAdapter(
            genJob.provider,
            getFaceSwapProviderApiKey(genJob.provider),
          );
          const completed = await adapter.getJob(result.externalJobId);
          if (completed.outputs?.length) {
            await finalizeFaceSwapJob(jobId, genJob, completed.outputs, result.externalJobId);
            return;
          }
        }

        await faceswapPollQueue.add(
          'poll-faceswap',
          { jobId, externalJobId: result.externalJobId, attempts: 0, provider: genJob.provider },
          { delay: 5000, removeOnComplete: 10, removeOnFail: 50 },
        );
      } catch (error) {
        console.error(`[Worker] Faceswap dispatch failed: ${jobId}`, error);
        await failJob(jobId, error instanceof Error ? error.message : 'Unknown error');
        throw error;
      }
    },
    {
      connection,
      concurrency: FACESWAP_CONCURRENCY,
      limiter: { max: FACESWAP_LIMITER_MAX, duration: 60000 },
    },
  );

  // ─── Face Swap Poll Worker ─────────────────────────
  const faceswapPollWorker = new Worker(
    'faceswap-poll',
    async (job: Job) => {
      try {
        await handlePollJob(
          job,
          faceswapPollQueue,
          'poll-faceswap',
          (provider, apiKey) => createFaceSwapAdapter(provider, apiKey),
          getFaceSwapProviderApiKey,
          finalizeFaceSwapJob,
          60, // 60 × 5s = 5 min max
        );
      } catch (error) {
        const { jobId } = job.data;
        console.error(`[Worker] Faceswap poll failed: ${jobId}`, error);
        await failJob(jobId, error instanceof Error ? error.message : 'Unknown error');
        throw error;
      }
    },
    { connection, concurrency: POLL_CONCURRENCY_PER_QUEUE },
  );

  // ─── Worker event listeners ────────────────────────
  imageDispatchWorker.on('completed', (job) => {
    console.log(`[Worker] Image dispatch ${job.id} completed`);
  });
  imageDispatchWorker.on('failed', (job, err) => {
    console.error(`[Worker] Image dispatch ${job?.id} failed:`, err.message);
  });

  videoDispatchWorker.on('completed', (job) => {
    console.log(`[Worker] Video dispatch ${job.id} completed`);
  });
  videoDispatchWorker.on('failed', (job, err) => {
    console.error(`[Worker] Video dispatch ${job?.id} failed:`, err.message);
  });

  faceswapDispatchWorker.on('completed', (job) => {
    console.log(`[Worker] Faceswap dispatch ${job.id} completed`);
  });
  faceswapDispatchWorker.on('failed', (job, err) => {
    console.error(`[Worker] Faceswap dispatch ${job?.id} failed:`, err.message);
  });

  imagePollWorker.on('failed', (job, err) => {
    console.error(`[Worker] Image poll ${job?.id} failed:`, err.message);
  });
  videoPollWorker.on('failed', (job, err) => {
    console.error(`[Worker] Video poll ${job?.id} failed:`, err.message);
  });
  faceswapPollWorker.on('failed', (job, err) => {
    console.error(`[Worker] Faceswap poll ${job?.id} failed:`, err.message);
  });

  console.log('SnapGen Media Worker started (dispatch/poll split)');
  console.log(`   Dispatch: image (c=${IMAGE_CONCURRENCY}), video (c=${VIDEO_CONCURRENCY}), faceswap (c=${FACESWAP_CONCURRENCY})`);
  console.log(
    `   Poll: total=${TOTAL_POLL_CONCURRENCY} (${POLL_CONCURRENCY_PER_QUEUE} per queue across image-poll, video-poll, faceswap-poll)`,
  );
  console.log(`   Provider limits: fal=${process.env.FAL_CONCURRENCY_LIMIT || 10}, replicate=${process.env.REPLICATE_CONCURRENCY_LIMIT || 5}, google=${process.env.GOOGLE_CONCURRENCY_LIMIT || 5}`);

  const SHUTDOWN_TIMEOUT_MS = 15_000;

  async function gracefulShutdown() {
    console.log('[Worker] Shutting down...');
    const shutdownWork = async () => {
      await Promise.allSettled([
        imageDispatchWorker.close(),
        videoDispatchWorker.close(),
        faceswapDispatchWorker.close(),
        imagePollWorker.close(),
        videoPollWorker.close(),
        faceswapPollWorker.close(),
      ]);
      await Promise.allSettled([
        imagePollQueue.close(),
        videoPollQueue.close(),
        faceswapPollQueue.close(),
      ]);
      if (eventPublisher) {
        await eventPublisher.quit().catch(() => {});
      }
      await prisma.$disconnect();
    };

    try {
      await Promise.race([
        shutdownWork(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Shutdown timed out')), SHUTDOWN_TIMEOUT_MS),
        ),
      ]);
    } catch (err) {
      console.error('[Worker] Error during shutdown:', err);
    }
    process.exit(0);
  }

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}

void bootstrap();
