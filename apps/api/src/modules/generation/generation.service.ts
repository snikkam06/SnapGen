import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  NotImplementedException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma, GenerationJob } from '@prisma/client';
import { createImageAdapter, createVideoAdapter } from '@snapgen/media-adapters';
import { PrismaService } from '../../prisma/prisma.service';
import { CREDIT_COSTS } from '@snapgen/config';
import { StorageService } from '../storage/storage.service';
import { assertNonEmptyString, assertOptionalUuid } from '../../utils/validation';

const QUEUED_IMAGE_JOB_RESCUE_THRESHOLD_MS = 15_000;
const QUEUED_VIDEO_JOB_RESCUE_THRESHOLD_MS = 15_000;
type ImageGenerationMode = 'base' | 'enhanced';
type PrismaClientLike = Prisma.TransactionClient | PrismaService;
type SavedJobOutput = {
  bucket: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  providerUrl: string;
};

@Injectable()
export class GenerationService {
  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
    @Optional() @InjectQueue('image-generation') private imageQueue?: Queue,
    @Optional() @InjectQueue('video-generation') private videoQueue?: Queue,
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

    const characterId = assertOptionalUuid(data.characterId, 'characterId');
    const stylePackId = assertOptionalUuid(data.stylePackId, 'stylePackId');
    const sourceAssetId = assertOptionalUuid(data.sourceAssetId, 'sourceAssetId');
    const prompt = assertNonEmptyString(data.prompt, 'prompt');
    const negativePrompt = data.negativePrompt?.trim() || null;

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

    await this.dispatchImageJob(job.id);

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

    const characterId = assertOptionalUuid(data.characterId, 'characterId');
    const sourceAssetId = assertOptionalUuid(data.sourceAssetId, 'sourceAssetId');
    const prompt = assertNonEmptyString(data.prompt, 'prompt');

    await this.assertCharacterExists(user.id, characterId);

    const provider = this.getVideoProvider();
    this.ensureProviderConfigured(provider, 'video');
    const totalCost = CREDIT_COSTS.video;
    const sourceImageAsset = sourceAssetId
      ? await this.resolveUserImageAsset(user.id, sourceAssetId)
      : null;

    const job = await this.prisma.withSerializableTransaction(async (tx) => {
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

    await this.dispatchVideoJob(job.id);

    return { id: job.id, status: job.status, reservedCredits: job.reservedCredits };
  }

  async createFaceSwapImageJob(
    _clerkUserId: string,
    _data: {
      sourceAssetId: string;
      targetAssetId: string;
    },
  ) {
    throw new NotImplementedException('Face swap image jobs are not implemented on the server');
  }

  async createUpscaleJob(
    _clerkUserId: string,
    _data: {
      assetId: string;
      mode?: string;
    },
  ) {
    throw new NotImplementedException('Upscale jobs are not implemented on the server');
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
      return 'fal';
    }

    if (mode === 'enhanced') {
      return 'google';
    }

    return this.getDefaultImageProvider();
  }

  private normalizeImageCount(requestedCount: number | undefined, provider: string): number {
    const normalizedCount = Number.isFinite(requestedCount)
      ? Math.trunc(requestedCount as number)
      : 4;
    const maxImages = provider === 'google' || provider === 'gemini' ? 4 : 8;

    return Math.max(1, Math.min(normalizedCount, maxImages));
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

    switch (job.jobType) {
      case 'image':
        if (Date.now() - job.createdAt.getTime() < QUEUED_IMAGE_JOB_RESCUE_THRESHOLD_MS) {
          return;
        }
        console.warn(`[GenerationService] Rescuing stalled image job ${jobId}.`);
        await this.dispatchImageJob(jobId);
        return;
      case 'video':
        if (Date.now() - job.createdAt.getTime() < QUEUED_VIDEO_JOB_RESCUE_THRESHOLD_MS) {
          return;
        }
        console.warn(`[GenerationService] Rescuing stalled video job ${jobId}.`);
        await this.dispatchVideoJob(jobId);
        return;
      default:
        await this.failUnsupportedQueuedJob(job.id, job.userId, job.reservedCredits, job.jobType);
    }
  }

  async ensureImageJobProcessing(jobId: string): Promise<void> {
    await this.ensureJobProcessing(jobId);
  }

  async ensureVideoJobProcessing(jobId: string): Promise<void> {
    await this.ensureJobProcessing(jobId);
  }

  async dispatchQueuedJob(jobId: string): Promise<void> {
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
      return;
    }

    switch (job.jobType) {
      case 'image':
        await this.dispatchImageJob(jobId);
        return;
      case 'video':
        await this.dispatchVideoJob(jobId);
        return;
      default:
        await this.failUnsupportedQueuedJob(job.id, job.userId, job.reservedCredits, job.jobType);
    }
  }

  private async dispatchImageJob(jobId: string): Promise<void> {
    if (!this.imageQueue) {
      this.runImageJobInline(jobId);
      return;
    }

    if (!(await this.hasActiveImageWorkers())) {
      console.warn(
        `[GenerationService] No active media workers detected. Processing image job ${jobId} inline.`,
      );
      this.runImageJobInline(jobId);
      return;
    }

    try {
      await this.imageQueue.add('generate-image', { jobId });
    } catch (error) {
      console.warn(
        `[GenerationService] Failed to enqueue image job ${jobId}. Falling back to inline processing.`,
        error,
      );
      this.runImageJobInline(jobId);
    }
  }

  private async dispatchVideoJob(jobId: string): Promise<void> {
    if (!this.videoQueue) {
      this.runVideoJobInline(jobId);
      return;
    }

    if (!(await this.hasActiveVideoWorkers())) {
      console.warn(
        `[GenerationService] No active video workers detected. Processing video job ${jobId} inline.`,
      );
      this.runVideoJobInline(jobId);
      return;
    }

    try {
      await this.videoQueue.add('generate-video', { jobId });
    } catch (error) {
      console.warn(
        `[GenerationService] Failed to enqueue video job ${jobId}. Falling back to inline processing.`,
        error,
      );
      this.runVideoJobInline(jobId);
    }
  }

  private runImageJobInline(jobId: string): void {
    void this.processImageJob(jobId).catch((error) => {
      console.error(`[GenerationService] Inline image job ${jobId} failed:`, error);
    });
  }

  private runVideoJobInline(jobId: string): void {
    void this.processVideoJob(jobId).catch((error) => {
      console.error(`[GenerationService] Inline video job ${jobId} failed:`, error);
    });
  }

  private async hasActiveImageWorkers(): Promise<boolean> {
    if (!this.imageQueue) {
      return false;
    }

    try {
      return (await this.imageQueue.getWorkersCount()) > 0;
    } catch (error) {
      console.warn('[GenerationService] Failed to inspect media worker availability.', error);
      return false;
    }
  }

  private async hasActiveVideoWorkers(): Promise<boolean> {
    if (!this.videoQueue) {
      return false;
    }

    try {
      return (await this.videoQueue.getWorkersCount()) > 0;
    } catch (error) {
      console.warn('[GenerationService] Failed to inspect video worker availability.', error);
      return false;
    }
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

      savedOutputs = await this.saveOutputsToStorage(
        jobId,
        genJob.userId,
        resolvedJob.outputs,
        'png',
      );

      await this.prisma.$transaction(async (tx) => {
        await this.persistSavedOutputs(tx, jobId, genJob.userId, 'generated-image', savedOutputs);
        await tx.generationJob.update({
          where: { id: jobId },
          data: {
            status: 'completed',
            externalJobId: createdJob.externalJobId,
            finalCredits: genJob.reservedCredits,
            completedAt: new Date(),
          },
        });
      });
    } catch (error) {
      await this.cleanupSavedOutputs(savedOutputs);
      await this.failJob(
        jobId,
        genJob.userId,
        genJob.reservedCredits,
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

      savedOutputs = await this.saveOutputsToStorage(
        jobId,
        genJob.userId,
        resolvedJob.outputs,
        'mp4',
      );

      await this.prisma.$transaction(async (tx) => {
        await this.persistSavedOutputs(tx, jobId, genJob.userId, 'generated-video', savedOutputs);
        await tx.generationJob.update({
          where: { id: jobId },
          data: {
            status: 'completed',
            externalJobId: createdJob.externalJobId,
            finalCredits: genJob.reservedCredits,
            completedAt: new Date(),
          },
        });
      });
    } catch (error) {
      await this.cleanupSavedOutputs(savedOutputs);
      await this.failJob(
        jobId,
        genJob.userId,
        genJob.reservedCredits,
        error instanceof Error ? error.message : 'Unknown error',
        `Refund for failed video job ${jobId}`,
      );
    }
  }

  private async failJob(
    jobId: string,
    userId: string,
    reservedCredits: number,
    errorMessage: string,
    refundReason: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.generationJob.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          errorMessage,
          failedAt: new Date(),
        },
      });

      if (reservedCredits > 0) {
        await tx.creditLedger.create({
          data: {
            userId,
            amount: reservedCredits,
            entryType: 'job_refund',
            reason: refundReason,
            referenceType: 'job',
            referenceId: jobId,
          },
        });
      }
    });
  }

  private async failUnsupportedQueuedJob(
    jobId: string,
    userId: string,
    reservedCredits: number,
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
      reservedCredits,
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
