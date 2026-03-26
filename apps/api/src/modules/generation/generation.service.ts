import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma, GenerationJob } from '@prisma/client';
import { createImageAdapter, createVideoAdapter, createFaceSwapAdapter } from '@snapgen/media-adapters';
import { PrismaService } from '../../prisma/prisma.service';
import { CREDIT_COSTS } from '@snapgen/config';
import { StorageService } from '../storage/storage.service';
import { QueueHealthService } from './queue-health.service';
import { JobEventsService, JobEvent } from '../events/job-events.service';
import { assertNonEmptyString, assertOptionalUuid } from '../../utils/validation';

const INLINE_PROCESSING_ENABLED = process.env.SNAPGEN_INLINE_PROCESSING === 'true';
const MAX_PENDING_JOBS_PER_USER = Number(process.env.MAX_PENDING_JOBS_PER_USER) || 5;
const QUEUED_IMAGE_JOB_RESCUE_THRESHOLD_MS = 15_000;
const QUEUED_VIDEO_JOB_RESCUE_THRESHOLD_MS = 15_000;
const RUNNING_IMAGE_JOB_RECONCILE_THRESHOLD_MS = 20_000;
const RUNNING_VIDEO_JOB_RECONCILE_THRESHOLD_MS = 45_000;
const RUNNING_FACESWAP_JOB_RECONCILE_THRESHOLD_MS = 20_000;

const MINOR_BLOCKLIST_PATTERNS = [
  /\b(?:child|children|kid|kids|infant|toddler|baby)\b/i,
  /\b(?:underage|under.?age|under.?18|pre.?teen|preteen)\b/i,
  /\b(?:minor|minors)\b/i,
  /\b(?:loli|lolita|shota)\b/i,
  /\b(?:school.?girl|school.?boy)\b/i,
  /\b(?:young\s+(?:girl|boy|teen|child))\b/i,
  /\b(?:little\s+(?:girl|boy))\b/i,
  /\b(?:teen\s*(?:age|aged)?(?:\s+(?:girl|boy))?)\b/i,
  /\b(?:adolescent)\b/i,
  /\b(?:prepubescent|pubescent)\b/i,
];

function containsMinorTerms(prompt: string): boolean {
  return MINOR_BLOCKLIST_PATTERNS.some((pattern) => pattern.test(prompt));
}
type ImageGenerationMode = 'base' | 'enhanced';
type PrismaClientLike = Prisma.TransactionClient | PrismaService;
type SavedJobOutput = {
  bucket: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  providerUrl: string;
};
type ProviderJobWebhookUpdate = {
  provider: string;
  externalJobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  errorMessage?: string;
  outputs?: Array<{ url: string; mimeType: string }>;
};

@Injectable()
export class GenerationService {
  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
    private queueHealth: QueueHealthService,
    private jobEvents: JobEventsService,
    @Optional() @InjectQueue('image-generation') private imageQueue?: Queue,
    @Optional() @InjectQueue('video-generation') private videoQueue?: Queue,
    @Optional() @InjectQueue('faceswap-generation') private faceswapQueue?: Queue,
    @Optional() @InjectQueue('image-poll') private imagePollQueue?: Queue,
    @Optional() @InjectQueue('video-poll') private videoPollQueue?: Queue,
    @Optional() @InjectQueue('faceswap-poll') private faceswapPollQueue?: Queue,
  ) {}

  async createImageJob(
    clerkUserId: string,
    data: {
      characterId?: string;
      stylePackId?: string;
      mode?: ImageGenerationMode;
      prompt: string;
      negativePrompt?: string;
      sourceAssetId?: string;
      settings?: Record<string, unknown>;
    },
  ) {
    const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!user) throw new NotFoundException('User not found');
    await this.assertPendingJobLimit(user.id);

    const characterId = assertOptionalUuid(data.characterId, 'characterId');
    const stylePackId = assertOptionalUuid(data.stylePackId, 'stylePackId');
    const sourceAssetId = assertOptionalUuid(data.sourceAssetId, 'sourceAssetId');
    const prompt = assertNonEmptyString(data.prompt, 'prompt');
    const negativePrompt = data.negativePrompt?.trim() || null;

    if (containsMinorTerms(prompt)) {
      throw new BadRequestException('Prompt rejected: content referencing minors is not allowed.');
    }

    const characterContext = await this.getCharacterGenerationContext(user.id, characterId);
    const stylePack = await this.getActiveStylePack(stylePackId);
    const sourceImageAsset = sourceAssetId
      ? await this.resolveUserImageAsset(user.id, sourceAssetId)
      : null;
    const imageMode = this.normalizeImageMode(data.mode);
    const referenceImages = [
      ...(sourceImageAsset ? [sourceImageAsset.url] : []),
      ...characterContext.referenceImages,
    ].slice(0, 4);
    const provider =
      referenceImages.length > 0
        ? imageMode
          ? this.resolveImageProvider(imageMode)
          : this.getReferenceImageProvider()
        : this.resolveImageProvider(imageMode);
    const numImages = this.normalizeImageCount(data.settings?.numImages as number, provider);
    const totalCost = CREDIT_COSTS.image * numImages;
    this.ensureProviderConfigured(provider, 'image', imageMode);
    await this.requireQueueOrInline('image');
    const jobSettings = {
      ...(data.settings || {}),
      numImages,
      ...(characterContext.characterName ? { characterName: characterContext.characterName } : {}),
      ...(referenceImages.length > 0 ? { referenceImages } : {}),
      ...(imageMode ? { generationMode: imageMode } : {}),
      ...(sourceImageAsset
        ? {
            sourceAssetId: sourceImageAsset.id,
            sourceImageUrl: sourceImageAsset.url,
          }
        : {}),
    };

    const job = await this.prisma.withSerializableTransaction(async (tx) => {
      await this.lockUserCredits(tx, user.id);
      const balance = await this.getBalance(user.id, tx);
      if (balance < totalCost) {
        throw new BadRequestException(`Insufficient credits. Need ${totalCost}, have ${balance}.`);
      }

      const createdJob = await tx.generationJob.create({
        data: {
          userId: user.id,
          characterId: characterId || null,
          stylePackId: stylePack?.id || null,
          jobType: 'image',
          status: 'queued',
          prompt,
          negativePrompt,
          settingsJson: jobSettings as Prisma.InputJsonValue,
          provider,
          reservedCredits: totalCost,
        },
      });

      await tx.creditLedger.create({
        data: {
          userId: user.id,
          amount: -totalCost,
          entryType: 'job_reservation',
          reason: `Image generation (${numImages} images)`,
          referenceType: 'job',
          referenceId: createdJob.id,
        },
      });

      if (sourceImageAsset) {
        await tx.jobAsset.create({
          data: {
            jobId: createdJob.id,
            assetId: sourceImageAsset.id,
            relation: 'input',
          },
        });
      }

      return createdJob;
    });

    await this.dispatchImageJob(job.id, job.userId);
    await this.publishJobEvent(job.userId, job);

    return {
      id: job.id,
      status: job.status,
      reservedCredits: job.reservedCredits,
      message: 'Image generation job queued',
    };
  }

  async createVideoJob(
    clerkUserId: string,
    data: {
      characterId?: string;
      prompt: string;
      sourceAssetId?: string;
      settings?: Record<string, unknown>;
    },
  ) {
    const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!user) throw new NotFoundException('User not found');
    await this.assertPendingJobLimit(user.id);

    const characterId = assertOptionalUuid(data.characterId, 'characterId');
    const sourceAssetId = assertOptionalUuid(data.sourceAssetId, 'sourceAssetId');
    const prompt = assertNonEmptyString(data.prompt, 'prompt');

    if (containsMinorTerms(prompt)) {
      throw new BadRequestException('Prompt rejected: content referencing minors is not allowed.');
    }

    await this.assertCharacterExists(user.id, characterId);

    const provider = this.getVideoProvider();
    this.ensureProviderConfigured(provider, 'video');
    await this.requireQueueOrInline('video');
    const totalCost = CREDIT_COSTS.video;
    const sourceImageAsset = sourceAssetId
      ? await this.resolveUserImageAsset(user.id, sourceAssetId)
      : null;

    const job = await this.prisma.withSerializableTransaction(async (tx) => {
      await this.lockUserCredits(tx, user.id);
      const balance = await this.getBalance(user.id, tx);
      if (balance < totalCost) {
        throw new BadRequestException(`Insufficient credits. Need ${totalCost}, have ${balance}.`);
      }

      const createdJob = await tx.generationJob.create({
        data: {
          userId: user.id,
          characterId: characterId || null,
          jobType: 'video',
          status: 'queued',
          prompt,
          settingsJson: {
            ...(data.settings || {}),
            sourceAssetId: sourceImageAsset?.id,
            sourceImageUrl: sourceImageAsset?.url,
          } as Prisma.InputJsonValue,
          provider,
          reservedCredits: totalCost,
        },
      });

      await tx.creditLedger.create({
        data: {
          userId: user.id,
          amount: -totalCost,
          entryType: 'job_reservation',
          reason: 'Video generation',
          referenceType: 'job',
          referenceId: createdJob.id,
        },
      });

      if (sourceImageAsset) {
        await tx.jobAsset.create({
          data: {
            jobId: createdJob.id,
            assetId: sourceImageAsset.id,
            relation: 'input',
          },
        });
      }

      return createdJob;
    });

    await this.dispatchVideoJob(job.id, job.userId);
    await this.publishJobEvent(job.userId, job);

    return { id: job.id, status: job.status, reservedCredits: job.reservedCredits };
  }

  async createFaceSwapImageJob(
    clerkUserId: string,
    data: {
      sourceAssetId: string;
      targetAssetId: string;
    },
  ) {
    const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!user) throw new NotFoundException('User not found');
    await this.assertPendingJobLimit(user.id);

    const sourceAssetId = assertNonEmptyString(data.sourceAssetId, 'sourceAssetId');
    const targetAssetId = assertNonEmptyString(data.targetAssetId, 'targetAssetId');

    const [sourceAsset, targetAsset] = await Promise.all([
      this.resolveUserImageAsset(user.id, sourceAssetId),
      this.resolveUserImageAsset(user.id, targetAssetId),
    ]);

    const provider = this.getFaceSwapProvider();
    this.ensureProviderConfigured(provider, 'image');
    await this.requireQueueOrInline('faceswap');
    const totalCost = CREDIT_COSTS['faceswap-image'];

    const job = await this.prisma.withSerializableTransaction(async (tx) => {
      await this.lockUserCredits(tx, user.id);
      const balance = await this.getBalance(user.id, tx);
      if (balance < totalCost) {
        throw new BadRequestException(`Insufficient credits. Need ${totalCost}, have ${balance}.`);
      }

      const createdJob = await tx.generationJob.create({
        data: {
          userId: user.id,
          jobType: 'faceswap-image',
          status: 'queued',
          prompt: 'Face swap',
          settingsJson: {
            sourceFaceUrl: sourceAsset.url,
            targetImageUrl: targetAsset.url,
            sourceAssetId: sourceAsset.id,
            targetAssetId: targetAsset.id,
          } as Prisma.InputJsonValue,
          provider,
          reservedCredits: totalCost,
        },
      });

      await tx.creditLedger.create({
        data: {
          userId: user.id,
          amount: -totalCost,
          entryType: 'job_reservation',
          reason: 'Face swap image',
          referenceType: 'job',
          referenceId: createdJob.id,
        },
      });

      await tx.jobAsset.createMany({
        data: [
          { jobId: createdJob.id, assetId: sourceAsset.id, relation: 'input' },
          { jobId: createdJob.id, assetId: targetAsset.id, relation: 'input' },
        ],
      });

      return createdJob;
    });

    await this.dispatchFaceSwapJob(job.id, job.userId);
    await this.publishJobEvent(job.userId, job);

    return {
      id: job.id,
      status: job.status,
      reservedCredits: job.reservedCredits,
      message: 'Face swap job queued',
    };
  }

  private getFaceSwapProvider(): string {
    if (process.env.FAL_API_KEY) {
      return 'fal';
    }
    return 'mock';
  }

  private async dispatchFaceSwapJob(jobId: string, userId: string): Promise<boolean> {
    if (INLINE_PROCESSING_ENABLED && !this.faceswapQueue) {
      void this.processFaceSwapJob(jobId).catch(async (error) => {
        console.error(`[GenerationService] Inline face swap job ${jobId} failed:`, error);
        await this.failJob(jobId, userId, error instanceof Error ? error.message : 'Unknown error', `Refund for failed inline face swap job ${jobId}`).catch((e) =>
          console.error(`[GenerationService] Failed to mark inline job ${jobId} as failed:`, e),
        );
      });
      return true;
    }

    const queue = this.faceswapQueue;
    if (!queue) {
      return this.failJobAndThrow503(jobId, userId, 'faceswap');
    }

    try {
      return await this.enqueueQueueJob(queue, 'faceswap', 'faceswap-image', jobId);
    } catch (error) {
      console.error(`[GenerationService] Failed to enqueue face swap job ${jobId}:`, error);
      return this.failJobAndThrow503(jobId, userId, 'faceswap');
    }
  }

  private async claimQueuedFaceSwapJob(jobId: string): Promise<GenerationJob | null> {
    const genJob = await this.prisma.generationJob.findUnique({ where: { id: jobId } });
    if (!genJob || genJob.jobType !== 'faceswap-image' || genJob.status !== 'queued') {
      return null;
    }

    const claimed = await this.prisma.generationJob.updateMany({
      where: { id: jobId, status: 'queued' },
      data: { status: 'running', startedAt: new Date(), errorMessage: null, failedAt: null },
    });

    if (claimed.count === 0) {
      return null;
    }

    return genJob;
  }

  async processFaceSwapJob(jobId: string): Promise<void> {
    const genJob = await this.claimQueuedFaceSwapJob(jobId);
    if (!genJob) return;

    let savedOutputs: SavedJobOutput[] = [];

    try {
      const settings = (genJob.settingsJson || {}) as Record<string, unknown>;
      const adapter = createFaceSwapAdapter(
        genJob.provider,
        this.getImageProviderApiKey(genJob.provider),
      );

      const createdJob = await adapter.createJob({
        sourceFaceUrl: settings.sourceFaceUrl as string,
        targetImageUrl: settings.targetImageUrl as string,
      });

      const resolvedJob = await this.resolveFaceSwapJob(
        adapter,
        createdJob.externalJobId,
        createdJob.status,
      );

      if (resolvedJob.status === 'failed') {
        throw new Error(resolvedJob.errorMessage || 'Face swap failed');
      }

      if (!resolvedJob.outputs?.length) {
        throw new Error('Face swap completed without any outputs');
      }

      await this.completeJobWithOutputs(
        genJob,
        resolvedJob.outputs,
        'generated-image',
        'png',
        createdJob.externalJobId,
      );
    } catch (error) {
      await this.cleanupSavedOutputs(savedOutputs);
      await this.failJob(
        jobId,
        genJob.userId,
        error instanceof Error ? error.message : 'Unknown error',
        `Refund for failed face swap job ${jobId}`,
      );
    }
  }

  private async resolveFaceSwapJob(
    adapter: ReturnType<typeof createFaceSwapAdapter>,
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
      errorMessage: 'Timed out waiting for face swap to complete',
    };
  }

  async handleProviderJobWebhook(update: ProviderJobWebhookUpdate): Promise<{
    handled: boolean;
    retryable: boolean;
    reason: string;
  }> {
    const encodedRequestIdFragment = `::${update.externalJobId}`;
    const genJob = await this.prisma.generationJob.findFirst({
      where: {
        provider: update.provider,
        OR: [
          { externalJobId: update.externalJobId },
          { externalJobId: { endsWith: encodedRequestIdFragment } },
          { externalJobId: { contains: encodedRequestIdFragment } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!genJob) {
      return {
        handled: false,
        retryable: update.status === 'completed' || update.status === 'failed',
        reason: `No generation job found for ${update.provider}:${update.externalJobId}`,
      };
    }

    if (['completed', 'failed', 'canceled'].includes(genJob.status)) {
      return {
        handled: false,
        retryable: false,
        reason: `Job ${genJob.id} already reached terminal status ${genJob.status}`,
      };
    }

    if (update.status === 'queued' || update.status === 'running') {
      return {
        handled: false,
        retryable: false,
        reason: `Ignoring non-terminal ${update.provider} webhook for job ${genJob.id}`,
      };
    }

    if (update.status === 'failed') {
      await this.failJob(
        genJob.id,
        genJob.userId,
        update.errorMessage || `${update.provider} reported job failure`,
        this.getRefundReasonForJob(genJob, 'provider webhook failure'),
      );

      return {
        handled: true,
        retryable: false,
        reason: `Marked job ${genJob.id} as failed from provider webhook`,
      };
    }

    const canUseWebhookOutputsDirectly =
      update.status === 'completed'
      && !!update.outputs?.length
      && !(genJob.externalJobId || '').startsWith('multi:');

    const providerResult = canUseWebhookOutputsDirectly
      ? {
          status: 'completed' as const,
          outputs: update.outputs,
        }
      : await this.resolveProviderWebhookResult(genJob);
    if (providerResult.status === 'queued' || providerResult.status === 'running') {
      return {
        handled: false,
        retryable: true,
        reason: `Provider result for job ${genJob.id} is still ${providerResult.status}`,
      };
    }

    if (providerResult.status === 'failed') {
      await this.failJob(
        genJob.id,
        genJob.userId,
        providerResult.errorMessage || 'Generation completed without any outputs',
        this.getRefundReasonForJob(genJob, 'provider webhook completion failure'),
      );

      return {
        handled: true,
        retryable: false,
        reason: `Marked job ${genJob.id} as failed after provider webhook lookup`,
      };
    }

    if (providerResult.status !== 'completed') {
      return {
        handled: false,
        retryable: true,
        reason: `Provider result for job ${genJob.id} did not reach a terminal completion state`,
      };
    }

    const outputs = providerResult.outputs ?? [];
    if (outputs.length === 0) {
      await this.failJob(
        genJob.id,
        genJob.userId,
        'Generation completed without any outputs',
        this.getRefundReasonForJob(genJob, 'provider webhook completion failure'),
      );

      return {
        handled: true,
        retryable: false,
        reason: `Marked job ${genJob.id} as failed after empty provider webhook result`,
      };
    }

    const completedJob = await this.completeJobWithOutputs(
      genJob,
      outputs,
      genJob.jobType === 'video' ? 'generated-video' : 'generated-image',
      genJob.jobType === 'video' ? 'mp4' : 'png',
      genJob.externalJobId || update.externalJobId,
    );

    if (!completedJob) {
      return {
        handled: false,
        retryable: false,
        reason: `Job ${genJob.id} was finalized by another worker before webhook completion`,
      };
    }

    return {
      handled: true,
      retryable: false,
      reason: `Completed job ${genJob.id} from provider webhook`,
    };
  }

  private async resolveProviderWebhookResult(
    genJob: GenerationJob,
  ): Promise<
    | { status: 'queued' | 'running' }
    | {
        status: 'completed' | 'failed';
        outputs?: Array<{ url: string; mimeType: string }>;
        errorMessage?: string;
      }
  > {
    if (!genJob.externalJobId) {
      return {
        status: 'failed',
        errorMessage: `Generation job ${genJob.id} does not have an external provider job ID yet`,
      };
    }

    switch (genJob.jobType) {
      case 'image': {
        const adapter = createImageAdapter(
          genJob.provider,
          this.getImageProviderApiKey(genJob.provider),
        );
        return adapter.getJob(genJob.externalJobId);
      }
      case 'video': {
        const adapter = createVideoAdapter(
          genJob.provider,
          this.getVideoProviderApiKey(genJob.provider),
        );
        const result = await adapter.getJob(genJob.externalJobId);
        return {
          status: result.status,
          outputs: result.outputs?.map((output) => ({
            url: output.url,
            mimeType: output.mimeType,
          })),
          errorMessage: result.errorMessage,
        };
      }
      case 'faceswap-image': {
        const adapter = createFaceSwapAdapter(
          genJob.provider,
          this.getImageProviderApiKey(genJob.provider),
        );
        return adapter.getJob(genJob.externalJobId);
      }
      default:
        return {
          status: 'failed',
          errorMessage: `${genJob.jobType} jobs do not support provider webhooks`,
        };
    }
  }

  private async completeJobWithOutputs(
    genJob: GenerationJob,
    outputs: Array<{ url: string; mimeType: string }>,
    assetKind: 'generated-image' | 'generated-video',
    fallbackExtension: string,
    externalJobId: string,
  ): Promise<GenerationJob | null> {
    const savedOutputs = await this.saveOutputsToStorage(
      genJob.id,
      genJob.userId,
      outputs,
      fallbackExtension,
    );

    try {
      const completedJob = await this.prisma.$transaction(async (tx) => {
        const completion = await tx.generationJob.updateMany({
          where: {
            id: genJob.id,
            status: { in: ['queued', 'running'] },
          },
          data: {
            status: 'completed',
            externalJobId,
            finalCredits: genJob.reservedCredits,
            completedAt: new Date(),
            errorMessage: null,
            failedAt: null,
          },
        });

        if (completion.count === 0) {
          return null;
        }

        await this.persistSavedOutputs(tx, genJob.id, genJob.userId, assetKind, savedOutputs);
        return tx.generationJob.findUnique({ where: { id: genJob.id } });
      });

      if (!completedJob) {
        await this.cleanupSavedOutputs(savedOutputs);
        return null;
      }

      await this.publishJobEvent(genJob.userId, completedJob);
      return completedJob;
    } catch (error) {
      await this.cleanupSavedOutputs(savedOutputs);
      throw error;
    }
  }

  private getRefundReasonForJob(genJob: GenerationJob, reason: string): string {
    switch (genJob.jobType) {
      case 'video':
        return `Refund for failed video job ${genJob.id} (${reason})`;
      case 'faceswap-image':
        return `Refund for failed face swap job ${genJob.id} (${reason})`;
      default:
        return `Refund for failed job ${genJob.id} (${reason})`;
    }
  }

  private async getBalance(
    userId: string,
    client: PrismaClientLike = this.prisma,
  ): Promise<number> {
    const result = await client.creditLedger.aggregate({
      where: { userId },
      _sum: { amount: true },
    });
    return result._sum.amount || 0;
  }

  private async assertPendingJobLimit(userId: string): Promise<void> {
    const count = await this.prisma.generationJob.count({
      where: { userId, status: { in: ['queued', 'running'] } },
    });
    if (count >= MAX_PENDING_JOBS_PER_USER) {
      throw new BadRequestException(
        `You have ${count} pending jobs. Wait for some to finish before submitting more.`,
      );
    }
  }

  private async lockUserCredits(
    client: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    // Match the webhook locking pattern and avoid integer-width mismatches in Prisma bindings.
    await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
  }

  private getDefaultImageProvider(): string {
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

  private normalizeImageMode(mode?: string): ImageGenerationMode | undefined {
    if (mode === 'base' || mode === 'enhanced') {
      return mode;
    }

    return undefined;
  }

  private resolveImageProvider(mode?: ImageGenerationMode): string {
    if (mode === 'base') {
      if (process.env.FAL_API_KEY) {
        return 'fal';
      }
      if (process.env.IMAGE_PROVIDER) {
        return process.env.IMAGE_PROVIDER;
      }
      return this.getDefaultImageProvider();
    }

    if (mode === 'enhanced') {
      if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
        return 'google';
      }
      if (process.env.IMAGE_PROVIDER) {
        return process.env.IMAGE_PROVIDER;
      }
      return this.getDefaultImageProvider();
    }

    if (process.env.IMAGE_PROVIDER) {
      return process.env.IMAGE_PROVIDER;
    }

    return this.getDefaultImageProvider();
  }

  private normalizeImageCount(requestedCount: number | undefined, provider: string): number {
    const maxImages = provider === 'google' || provider === 'gemini' ? 4 : 8;

    if (requestedCount === undefined || requestedCount === null) {
      return 4;
    }

    if (!Number.isFinite(requestedCount)) {
      throw new BadRequestException(`numImages must be a finite number`);
    }

    const count = Math.trunc(requestedCount);
    if (count < 1) {
      throw new BadRequestException(
        `numImages must be at least 1, got ${requestedCount}`,
      );
    }
    if (count > maxImages) {
      throw new BadRequestException(
        `numImages must be at most ${maxImages} for provider "${provider}", got ${requestedCount}`,
      );
    }

    return count;
  }

  async ensureJobProcessing(jobId: string): Promise<void> {
    const job = await this.prisma.generationJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        jobType: true,
        status: true,
        createdAt: true,
        userId: true,
        reservedCredits: true,
      },
    });

    if (!job || job.status !== 'queued') {
      return;
    }

    const thresholdMs =
      job.jobType === 'video'
        ? QUEUED_VIDEO_JOB_RESCUE_THRESHOLD_MS
        : QUEUED_IMAGE_JOB_RESCUE_THRESHOLD_MS;
    if (Date.now() - job.createdAt.getTime() < thresholdMs) {
      return;
    }

    if (!(await this.canRescueQueuedJob(job.jobType))) {
      return;
    }

    try {
      const rescued = await this.dispatchQueuedJob(jobId);
      if (!rescued) {
        return;
      }

      switch (job.jobType) {
        case 'image':
          console.warn(`[GenerationService] Rescuing stalled image job ${jobId}.`);
          return;
        case 'video':
          console.warn(`[GenerationService] Rescuing stalled video job ${jobId}.`);
          return;
        case 'faceswap-image':
          console.warn(`[GenerationService] Rescuing stalled face swap job ${jobId}.`);
          return;
        default:
          await this.failUnsupportedQueuedJob(job.id, job.userId, job.jobType);
      }
    } catch (error) {
      console.warn(`[GenerationService] Failed to rescue queued job ${jobId}.`, error);
    }
  }

  async reconcileRunningJob(jobId: string): Promise<void> {
    const genJob = await this.prisma.generationJob.findUnique({
      where: { id: jobId },
    });

    if (!genJob || genJob.status !== 'running' || !genJob.externalJobId) {
      return;
    }

    if (!this.shouldReconcileRunningJob(genJob)) {
      return;
    }

    try {
      const providerResult = await this.resolveProviderWebhookResult(genJob);

      if (providerResult.status === 'queued' || providerResult.status === 'running') {
        return;
      }

      if (providerResult.status === 'failed') {
        await this.failJob(
          genJob.id,
          genJob.userId,
          providerResult.errorMessage || `${genJob.provider} reported job failure`,
          this.getRefundReasonForJob(genJob, 'running job reconciliation failure'),
        );
        return;
      }

      if (providerResult.status !== 'completed') {
        return;
      }

      const outputs = 'outputs' in providerResult ? providerResult.outputs ?? [] : [];
      if (outputs.length === 0) {
        await this.failJob(
          genJob.id,
          genJob.userId,
          'Generation completed without any outputs',
          this.getRefundReasonForJob(genJob, 'running job reconciliation failure'),
        );
        return;
      }

      await this.completeJobWithOutputs(
        genJob,
        outputs,
        genJob.jobType === 'video' ? 'generated-video' : 'generated-image',
        genJob.jobType === 'video' ? 'mp4' : 'png',
        genJob.externalJobId,
      );
    } catch (error) {
      console.warn(`[GenerationService] Failed to reconcile running job ${jobId}.`, error);
    }
  }

  async dispatchQueuedJob(jobId: string): Promise<boolean> {
    const job = await this.prisma.generationJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        jobType: true,
        status: true,
        userId: true,
        reservedCredits: true,
      },
    });

    if (!job || job.status !== 'queued') {
      return false;
    }

    switch (job.jobType) {
      case 'image':
        return this.dispatchImageJob(jobId, job.userId);
      case 'video':
        return this.dispatchVideoJob(jobId, job.userId);
      case 'faceswap-image':
        return this.dispatchFaceSwapJob(jobId, job.userId);
      default:
        await this.failUnsupportedQueuedJob(job.id, job.userId, job.jobType);
        return false;
    }
  }

  private async dispatchImageJob(jobId: string, userId: string): Promise<boolean> {
    if (INLINE_PROCESSING_ENABLED && !this.imageQueue) {
      void this.processImageJob(jobId).catch(async (error) => {
        console.error(`[GenerationService] Inline image job ${jobId} failed:`, error);
        await this.failJob(jobId, userId, error instanceof Error ? error.message : 'Unknown error', `Refund for failed inline image job ${jobId}`).catch((e) =>
          console.error(`[GenerationService] Failed to mark inline job ${jobId} as failed:`, e),
        );
      });
      return true;
    }

    const queue = this.imageQueue;
    if (!queue) {
      return this.failJobAndThrow503(jobId, userId, 'image');
    }

    try {
      return await this.enqueueQueueJob(queue, 'image', 'generate-image', jobId);
    } catch (error) {
      console.error(`[GenerationService] Failed to enqueue image job ${jobId}:`, error);
      return this.failJobAndThrow503(jobId, userId, 'image');
    }
  }

  private async dispatchVideoJob(jobId: string, userId: string): Promise<boolean> {
    if (INLINE_PROCESSING_ENABLED && !this.videoQueue) {
      void this.processVideoJob(jobId).catch(async (error) => {
        console.error(`[GenerationService] Inline video job ${jobId} failed:`, error);
        await this.failJob(jobId, userId, error instanceof Error ? error.message : 'Unknown error', `Refund for failed inline video job ${jobId}`).catch((e) =>
          console.error(`[GenerationService] Failed to mark inline job ${jobId} as failed:`, e),
        );
      });
      return true;
    }

    const queue = this.videoQueue;
    if (!queue) {
      return this.failJobAndThrow503(jobId, userId, 'video');
    }

    try {
      return await this.enqueueQueueJob(queue, 'video', 'generate-video', jobId);
    } catch (error) {
      console.error(`[GenerationService] Failed to enqueue video job ${jobId}:`, error);
      return this.failJobAndThrow503(jobId, userId, 'video');
    }
  }

  private async canRescueQueuedJob(jobType: string): Promise<boolean> {
    if (INLINE_PROCESSING_ENABLED) {
      return true;
    }

    switch (jobType) {
      case 'image':
        return this.queueHealth.isQueueHealthy('image');
      case 'video':
        return this.queueHealth.isQueueHealthy('video');
      case 'faceswap-image':
        return this.queueHealth.isQueueHealthy('faceswap');
      default:
        return true;
    }
  }

  private async requireQueueOrInline(queueName: 'image' | 'video' | 'faceswap'): Promise<void> {
    if (INLINE_PROCESSING_ENABLED) return;
    const healthy = await this.queueHealth.isQueueHealthy(queueName);
    if (!healthy) {
      throw new ServiceUnavailableException(
        `Generation service temporarily unavailable. Please try again later.`,
      );
    }
  }

  private buildQueueJobId(queueName: 'image' | 'video' | 'faceswap', jobId: string): string {
    return `${queueName}-${jobId}`;
  }

  private async enqueueQueueJob(
    queue: Queue,
    queueName: 'image' | 'video' | 'faceswap',
    queueJobName: string,
    jobId: string,
  ): Promise<boolean> {
    const queueJobId = this.buildQueueJobId(queueName, jobId);
    const isTerminalState = (state: string) => state === 'completed' || state === 'failed';

    const removeTerminalJobIfPresent = async (): Promise<boolean> => {
      const existingJob = await queue.getJob(queueJobId);
      if (!existingJob) {
        return false;
      }

      const state = await existingJob.getState();
      if (!isTerminalState(state)) {
        return true;
      }

      await existingJob.remove();
      return false;
    };

    if (await removeTerminalJobIfPresent()) {
      return false;
    }

    let queueJob = await queue.add(queueJobName, { jobId }, {
      jobId: queueJobId,
      removeOnComplete: 100,
      removeOnFail: 500,
    });
    let state = await queueJob.getState();

    // BullMQ deduplicates duplicate job IDs by returning the existing job, so
    // retry once if we raced with a terminal queue entry.
    if (isTerminalState(state)) {
      await queueJob.remove();

      if (await removeTerminalJobIfPresent()) {
        return false;
      }

      queueJob = await queue.add(queueJobName, { jobId }, {
        jobId: queueJobId,
        removeOnComplete: 100,
        removeOnFail: 500,
      });
      state = await queueJob.getState();
    }

    return !isTerminalState(state);
  }

  private async failJobAndThrow503(jobId: string, userId: string, queueName: string): Promise<never> {
    await this.failJob(
      jobId,
      userId,
      `Queue unavailable: ${queueName}`,
      `Refund for failed ${queueName} job ${jobId} (queue unavailable)`,
    );
    throw new ServiceUnavailableException(
      'Generation service temporarily unavailable. Credits have been refunded. Please try again later.',
    );
  }

  private async claimQueuedImageJob(jobId: string): Promise<GenerationJob | null> {
    const genJob = await this.prisma.generationJob.findUnique({ where: { id: jobId } });
    if (!genJob || genJob.jobType !== 'image' || genJob.status !== 'queued') {
      return null;
    }

    const claimed = await this.prisma.generationJob.updateMany({
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
      return null;
    }

    return genJob;
  }

  private async claimQueuedVideoJob(jobId: string): Promise<GenerationJob | null> {
    const genJob = await this.prisma.generationJob.findUnique({ where: { id: jobId } });
    if (!genJob || genJob.jobType !== 'video' || genJob.status !== 'queued') {
      return null;
    }

    const claimed = await this.prisma.generationJob.updateMany({
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
      return null;
    }

    return genJob;
  }

  private async processImageJob(jobId: string): Promise<void> {
    const genJob = await this.claimQueuedImageJob(jobId);
    if (!genJob) {
      return;
    }

    let savedOutputs: SavedJobOutput[] = [];

    try {
      const settings = (genJob.settingsJson || {}) as Record<string, unknown>;
      const adapter = createImageAdapter(
        genJob.provider,
        this.getImageProviderApiKey(genJob.provider),
      );

      const createdJob = await adapter.createJob({
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

      const resolvedJob = await this.resolveImageJob(
        adapter,
        createdJob.externalJobId,
        createdJob.status,
      );
      if (resolvedJob.status === 'failed') {
        throw new Error(resolvedJob.errorMessage || 'Generation failed');
      }

      if (!resolvedJob.outputs?.length) {
        throw new Error('Generation completed without any outputs');
      }

      await this.completeJobWithOutputs(
        genJob,
        resolvedJob.outputs,
        'generated-image',
        'png',
        createdJob.externalJobId,
      );
    } catch (error) {
      await this.cleanupSavedOutputs(savedOutputs);
      await this.failJob(
        jobId,
        genJob.userId,
        error instanceof Error ? error.message : 'Unknown error',
        `Refund for failed job ${jobId}`,
      );
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

  private async saveOutputsToStorage(
    jobId: string,
    userId: string,
    outputs: Array<{ url: string; mimeType: string }>,
    fallbackExtension: string,
  ): Promise<SavedJobOutput[]> {
    const savedOutputs: SavedJobOutput[] = [];

    try {
      for (const [index, output] of outputs.entries()) {
        const bucket = process.env.R2_BUCKET_OUTPUTS || 'outputs-private';
        const storageKey = `users/${userId}/jobs/${jobId}/outputs/${Date.now()}-${index}-${randomUUID()}.${this.getExtensionForMimeType(output.mimeType, fallbackExtension)}`;
        const savedOutput = await this.storageService.saveFromUrl(
          bucket,
          storageKey,
          output.url,
          output.mimeType,
        );

        savedOutputs.push({
          bucket,
          storageKey,
          contentType: savedOutput.contentType,
          sizeBytes: savedOutput.sizeBytes,
          providerUrl: output.url,
        });
      }
    } catch (error) {
      await this.cleanupSavedOutputs(savedOutputs);
      throw error;
    }

    return savedOutputs;
  }

  private async persistSavedOutputs(
    tx: Prisma.TransactionClient,
    jobId: string,
    userId: string,
    assetKind: 'generated-image' | 'generated-video',
    savedOutputs: SavedJobOutput[],
  ): Promise<void> {
    for (const output of savedOutputs) {
      const asset = await tx.asset.create({
        data: {
          userId,
          kind: assetKind,
          storageBucket: output.bucket,
          storageKey: output.storageKey,
          mimeType: output.contentType,
          fileSizeBytes: BigInt(output.sizeBytes),
          moderationStatus: 'approved',
          metadataJson: { providerUrl: output.providerUrl },
        },
      });

      await tx.jobAsset.create({
        data: {
          jobId,
          assetId: asset.id,
          relation: 'output',
        },
      });
    }
  }

  private async cleanupSavedOutputs(savedOutputs: SavedJobOutput[]): Promise<void> {
    if (savedOutputs.length === 0) {
      return;
    }

    await Promise.allSettled(
      savedOutputs.map((output) =>
        this.storageService.deleteObject(output.bucket, output.storageKey),
      ),
    );
  }

  private getExtensionForMimeType(mimeType: string, fallback: string): string {
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

  private shouldReconcileRunningJob(
    genJob: Pick<GenerationJob, 'jobType' | 'createdAt' | 'startedAt'>,
  ): boolean {
    const startedAtMs = genJob.startedAt?.getTime() ?? genJob.createdAt.getTime();
    const elapsedMs = Date.now() - startedAtMs;

    switch (genJob.jobType) {
      case 'video':
        return elapsedMs >= RUNNING_VIDEO_JOB_RECONCILE_THRESHOLD_MS;
      case 'faceswap-image':
        return elapsedMs >= RUNNING_FACESWAP_JOB_RECONCILE_THRESHOLD_MS;
      default:
        return elapsedMs >= RUNNING_IMAGE_JOB_RECONCILE_THRESHOLD_MS;
    }
  }

  private getVideoProvider(): string {
    if (process.env.VIDEO_PROVIDER) {
      return process.env.VIDEO_PROVIDER;
    }
    if (process.env.FAL_API_KEY) {
      return 'fal';
    }
    if (process.env.KLING_API_KEY) {
      return 'kling';
    }
    return 'mock';
  }

  private getVideoProviderApiKey(provider: string): string {
    switch (provider) {
      case 'fal':
        return process.env.FAL_API_KEY || '';
      case 'kling':
        return process.env.KLING_API_KEY || '';
      default:
        return '';
    }
  }

  private async resolveVideoJob(
    adapter: ReturnType<typeof createVideoAdapter>,
    externalJobId: string,
    initialStatus: 'queued' | 'running' | 'completed',
  ): Promise<{
    status: 'queued' | 'running' | 'completed' | 'failed';
    outputs?: Array<{ url: string; mimeType: string; durationSec?: number }>;
    errorMessage?: string;
  }> {
    let jobResult =
      initialStatus === 'completed'
        ? await adapter.getJob(externalJobId)
        : { status: initialStatus, outputs: undefined };

    if (jobResult.status === 'completed' || jobResult.status === 'failed') {
      return jobResult;
    }

    for (let attempts = 0; attempts < 120; attempts++) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      jobResult = await adapter.getJob(externalJobId);
      if (jobResult.status === 'completed' || jobResult.status === 'failed') {
        return jobResult;
      }
    }

    return {
      status: 'failed',
      errorMessage: 'Timed out waiting for video generation to complete',
    };
  }

  private async processVideoJob(jobId: string): Promise<void> {
    const genJob = await this.claimQueuedVideoJob(jobId);
    if (!genJob) return;

    let savedOutputs: SavedJobOutput[] = [];

    try {
      const settings = (genJob.settingsJson || {}) as Record<string, unknown>;
      const adapter = createVideoAdapter(
        genJob.provider,
        this.getVideoProviderApiKey(genJob.provider),
      );

      const createdJob = await adapter.createJob({
        prompt: genJob.prompt || '',
        sourceImageUrl: settings.sourceImageUrl as string | undefined,
        aspectRatio: settings.aspectRatio as string | undefined,
        durationSec: settings.durationSec as number | undefined,
        settings: {
          motionAmount: settings.motionAmount,
          cameraControl: settings.cameraControl,
        },
      });

      const resolvedJob = await this.resolveVideoJob(
        adapter,
        createdJob.externalJobId,
        createdJob.status,
      );

      if (resolvedJob.status === 'failed') {
        throw new Error(resolvedJob.errorMessage || 'Video generation failed');
      }

      if (!resolvedJob.outputs?.length) {
        throw new Error('Video generation completed without any outputs');
      }

      await this.completeJobWithOutputs(
        genJob,
        resolvedJob.outputs,
        'generated-video',
        'mp4',
        createdJob.externalJobId,
      );
    } catch (error) {
      await this.cleanupSavedOutputs(savedOutputs);
      await this.failJob(
        jobId,
        genJob.userId,
        error instanceof Error ? error.message : 'Unknown error',
        `Refund for failed video job ${jobId}`,
      );
    }
  }

  private async failJob(
    jobId: string,
    userId: string,
    errorMessage: string,
    refundReason: string,
  ): Promise<void> {
    const failedAt = new Date();

    const updatedJob = await this.prisma.$transaction(async (tx) => {
      const result = await tx.generationJob.updateMany({
        where: { id: jobId, status: { in: ['queued', 'running'] } },
        data: { status: 'failed', errorMessage, failedAt },
      });

      if (result.count === 0) return null;

      const job = await tx.generationJob.findUnique({
        where: { id: jobId },
      });

      if (job && job.reservedCredits > 0) {
        await tx.creditLedger.create({
          data: {
            userId,
            amount: job.reservedCredits,
            entryType: 'job_refund',
            reason: refundReason,
            referenceType: 'job',
            referenceId: jobId,
          },
        });
      }

      return job;
    });

    if (updatedJob) {
      await this.publishJobEvent(userId, updatedJob);
    }
  }

  private async publishJobEvent(userId: string, job: GenerationJob): Promise<void> {
    let outputs: Array<{ id: string; url: string; mimeType: string }> | undefined;

    if (job.status === 'completed') {
      try {
        const jobAssets = await this.prisma.jobAsset.findMany({
          where: { jobId: job.id, relation: 'output' },
          include: { asset: true },
        });
        if (jobAssets.length > 0) {
          outputs = await Promise.all(
            jobAssets.map(async (ja) => ({
              id: ja.asset.id,
              url: await this.storageService.getAssetUrl(ja.asset),
              mimeType: ja.asset.mimeType,
            })),
          );
        }
      } catch {
        // Non-critical: event will be sent without outputs
      }
    }

    const event: JobEvent = {
      jobId: job.id,
      jobType: job.jobType,
      status: job.status,
      reservedCredits: job.reservedCredits,
      finalCredits: job.finalCredits,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() || null,
      completedAt: job.completedAt?.toISOString() || null,
      failedAt: job.failedAt?.toISOString() || null,
      outputs,
    };
    await this.jobEvents.publishJobEvent(userId, event);
  }

  private async failUnsupportedQueuedJob(
    jobId: string,
    userId: string,
    jobType: string,
  ): Promise<void> {
    const claimed = await this.prisma.generationJob.updateMany({
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
      return;
    }

    await this.failJob(
      jobId,
      userId,
      `${jobType} jobs are not implemented on the server`,
      `Refund for unsupported ${jobType} job ${jobId}`,
    );
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

  private ensureProviderConfigured(
    provider: string,
    capability: 'image' | 'video',
    imageMode?: ImageGenerationMode,
  ): void {
    if (provider === 'mock') {
      return;
    }

    const apiKey =
      capability === 'video'
        ? this.getVideoProviderApiKey(provider)
        : this.getImageProviderApiKey(provider);

    if (apiKey) {
      return;
    }

    const providerLabel =
      capability === 'image' && provider === 'fal'
        ? 'fal.ai image generation'
        : capability === 'image' && provider === 'google'
          ? 'Gemini image generation'
          : imageMode === 'base'
            ? 'Base image generation (fal.ai)'
            : imageMode === 'enhanced'
              ? 'Enhanced image generation (Gemini)'
              : `${provider} ${capability} generation`;

    throw new InternalServerErrorException(`${providerLabel} is not configured on the server.`);
  }

  private async assertCharacterExists(userId: string, characterId?: string): Promise<void> {
    if (!characterId) {
      return;
    }

    const character = await this.prisma.character.findFirst({
      where: {
        id: characterId,
        userId,
      },
      select: { id: true },
    });

    if (!character) {
      throw new NotFoundException('Character not found');
    }
  }

  private async getActiveStylePack(stylePackId?: string): Promise<{ id: string } | null> {
    if (!stylePackId) {
      return null;
    }

    const stylePack = await this.prisma.stylePack.findFirst({
      where: {
        id: stylePackId,
        isActive: true,
      },
      select: { id: true },
    });

    if (!stylePack) {
      throw new NotFoundException('Style pack not found');
    }

    return stylePack;
  }

  private async getCharacterGenerationContext(
    userId: string,
    characterId?: string,
  ): Promise<{
    characterName?: string;
    preferredImageProvider?: string;
    referenceImages: string[];
  }> {
    if (!characterId) {
      return { referenceImages: [] };
    }

    const character = await this.prisma.character.findFirst({
      where: {
        id: characterId,
        userId,
      },
    });

    if (!character) {
      throw new NotFoundException('Character not found');
    }

    const referenceAssets = await this.prisma.asset.findMany({
      where: {
        userId,
        kind: 'dataset-image',
        moderationStatus: { not: 'deleted' },
        storageKey: {
          startsWith: `users/${userId}/characters/${characterId}/datasets/`,
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 4,
    });

    const referenceImages = await Promise.all(
      referenceAssets.map((asset) =>
        this.storageService.getSignedDownloadUrl(asset.storageBucket, asset.storageKey),
      ),
    );

    return {
      characterName: character.name,
      preferredImageProvider: this.getCharacterImageProvider(),
      referenceImages,
    };
  }

  private getCharacterImageProvider(): string {
    if (process.env.IMAGE_PROVIDER === 'fal' || process.env.FAL_API_KEY) {
      return 'fal';
    }

    return this.getDefaultImageProvider();
  }

  private getReferenceImageProvider(): string {
    if (process.env.IMAGE_PROVIDER === 'fal' || process.env.FAL_API_KEY) {
      return 'fal';
    }

    if (
      process.env.IMAGE_PROVIDER === 'google' ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY
    ) {
      return 'google';
    }

    return this.getDefaultImageProvider();
  }

  private async resolveUserImageAsset(
    userId: string,
    assetId: string,
  ): Promise<{ id: string; url: string }> {
    const asset = await this.prisma.asset.findFirst({
      where: {
        id: assetId,
        userId,
        moderationStatus: { not: 'deleted' },
      },
    });

    if (!asset) {
      throw new NotFoundException('Source image not found');
    }

    if (!asset.mimeType.startsWith('image/')) {
      throw new BadRequestException('Source asset must be an image');
    }

    return {
      id: asset.id,
      url: await this.storageService.getAssetUrl(asset),
    };
  }
}
