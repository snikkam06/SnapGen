import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma, GenerationJob } from '@prisma/client';
import { createImageAdapter, createVideoAdapter } from '@snapgen/media-adapters';
import { PrismaService } from '../../prisma/prisma.service';
import { CREDIT_COSTS, VALID_JOB_TRANSITIONS } from '@snapgen/config';
import { StorageService } from '../storage/storage.service';

const QUEUED_IMAGE_JOB_RESCUE_THRESHOLD_MS = 15_000;
const QUEUED_VIDEO_JOB_RESCUE_THRESHOLD_MS = 15_000;
type ImageGenerationMode = 'base' | 'enhanced';

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
      settings?: Record<string, unknown>;
    },
  ) {
    const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!user) throw new NotFoundException('User not found');

    const characterContext = await this.getCharacterGenerationContext(user.id, data.characterId);
    const imageMode = this.normalizeImageMode(data.mode);
    const provider = characterContext.preferredImageProvider ?? this.resolveImageProvider(imageMode);
    const numImages = this.normalizeImageCount(data.settings?.numImages as number, provider);
    const totalCost = CREDIT_COSTS.image * numImages;
    this.ensureProviderConfigured(provider, 'image', imageMode);
    const jobSettings = {
      ...(data.settings || {}),
      numImages,
      ...(characterContext.characterName ? { characterName: characterContext.characterName } : {}),
      ...(characterContext.referenceImages.length > 0
        ? { referenceImages: characterContext.referenceImages }
        : {}),
      ...(imageMode ? { generationMode: imageMode } : {}),
    };

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
        settingsJson: jobSettings as Prisma.InputJsonValue,
        provider,
        reservedCredits: totalCost,
      },
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

    const provider = this.getVideoProvider();
    this.ensureProviderConfigured(provider, 'video');
    const totalCost = CREDIT_COSTS.video;
    const balance = await this.getBalance(user.id);
    if (balance < totalCost) {
      throw new BadRequestException(`Insufficient credits. Need ${totalCost}, have ${balance}.`);
    }

    // Resolve source asset URL if provided
    let sourceAssetId: string | undefined;
    let sourceImageUrl: string | undefined;
    if (data.sourceAssetId) {
      const asset = await this.prisma.asset.findFirst({
        where: {
          id: data.sourceAssetId,
          userId: user.id,
          moderationStatus: { not: 'deleted' },
        },
      });

      if (!asset) {
        throw new NotFoundException('Source image not found');
      }

      if (!asset.mimeType.startsWith('image/')) {
        throw new BadRequestException('Source asset must be an image');
      }

      sourceAssetId = asset.id;
      sourceImageUrl = await this.storageService.getAssetUrl(asset);
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
          sourceAssetId,
          sourceImageUrl,
        } as Prisma.InputJsonValue,
        provider,
        reservedCredits: totalCost,
      },
    });

    if (sourceAssetId) {
      await this.prisma.jobAsset.create({
        data: {
          jobId: job.id,
          assetId: sourceAssetId,
          relation: 'input',
        },
      });
    }

    if (this.videoQueue) {
      if (!(await this.hasActiveVideoWorkers())) {
        console.warn(
          `[GenerationService] No active video workers detected. Processing video job ${job.id} inline.`,
        );
        void this.processVideoJob(job.id).catch((err) =>
          console.error(`[GenerationService] Inline video job ${job.id} failed:`, err),
        );
        return { id: job.id, status: job.status, reservedCredits: job.reservedCredits };
      }

      try {
        await this.videoQueue.add('generate-video', { jobId: job.id });
      } catch {
        void this.processVideoJob(job.id).catch((err) =>
          console.error(`[GenerationService] Inline video job ${job.id} failed:`, err),
        );
      }
    } else {
      void this.processVideoJob(job.id).catch((err) =>
        console.error(`[GenerationService] Inline video job ${job.id} failed:`, err),
      );
    }

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

  async createUpscaleJob(
    clerkUserId: string,
    data: {
      assetId: string;
      mode?: string;
    },
  ) {
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

  async ensureImageJobProcessing(jobId: string): Promise<void> {
    const job = await this.prisma.generationJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        jobType: true,
        status: true,
        createdAt: true,
      },
    });

    if (!job || job.jobType !== 'image' || job.status !== 'queued') {
      return;
    }

    if (Date.now() - job.createdAt.getTime() < QUEUED_IMAGE_JOB_RESCUE_THRESHOLD_MS) {
      return;
    }

    console.warn(`[GenerationService] Rescuing stalled image job ${jobId} inline.`);
    this.runImageJobInline(jobId);
  }

  async ensureVideoJobProcessing(jobId: string): Promise<void> {
    const job = await this.prisma.generationJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        jobType: true,
        status: true,
        createdAt: true,
      },
    });

    if (!job || job.jobType !== 'video' || job.status !== 'queued') {
      return;
    }

    if (Date.now() - job.createdAt.getTime() < QUEUED_VIDEO_JOB_RESCUE_THRESHOLD_MS) {
      return;
    }

    console.warn(`[GenerationService] Rescuing stalled video job ${jobId} inline.`);
    this.runVideoJobInline(jobId);
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

  private async processImageJob(jobId: string): Promise<void> {
    const genJob = await this.claimQueuedImageJob(jobId);
    if (!genJob) {
      return;
    }

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
      const bucket = process.env.R2_BUCKET_OUTPUTS || 'outputs-private';
      const storageKey = `users/${userId}/jobs/${jobId}/outputs/${Date.now()}.${this.getExtensionForMimeType(output.mimeType, 'png')}`;
      const savedOutput = await this.storageService.saveFromUrl(
        bucket,
        storageKey,
        output.url,
        output.mimeType,
      );
      const asset = await this.prisma.asset.create({
        data: {
          userId,
          kind: 'generated-image',
          storageBucket: bucket,
          storageKey,
          mimeType: savedOutput.contentType,
          fileSizeBytes: BigInt(savedOutput.sizeBytes),
          moderationStatus: 'approved',
          metadataJson: { providerUrl: output.url },
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

  private async processVideoJob(jobId: string): Promise<void> {
    const genJob = await this.prisma.generationJob.findUnique({ where: { id: jobId } });
    if (!genJob) return;

    try {
      await this.prisma.generationJob.update({
        where: { id: jobId },
        data: { status: 'running', startedAt: new Date() },
      });

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

      let jobResult =
        createdJob.status === 'completed'
          ? await adapter.getJob(createdJob.externalJobId)
          : {
              status: createdJob.status as 'queued' | 'running',
              outputs: undefined,
              errorMessage: undefined,
            };

      if (jobResult.status !== 'completed' && jobResult.status !== 'failed') {
        for (let attempts = 0; attempts < 120; attempts++) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          jobResult = await adapter.getJob(createdJob.externalJobId);
          if (jobResult.status === 'completed' || jobResult.status === 'failed') break;
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
        const storageKey = `users/${genJob.userId}/jobs/${jobId}/outputs/${Date.now()}.${this.getExtensionForMimeType(output.mimeType, 'mp4')}`;
        const savedOutput = await this.storageService.saveFromUrl(
          bucket,
          storageKey,
          output.url,
          output.mimeType,
        );
        const asset = await this.prisma.asset.create({
          data: {
            userId: genJob.userId,
            kind: 'generated-video',
            storageBucket: bucket,
            storageKey,
            mimeType: savedOutput.contentType,
            fileSizeBytes: BigInt(savedOutput.sizeBytes),
            moderationStatus: 'approved',
            metadataJson: { providerUrl: output.url },
          },
        });

        await this.prisma.jobAsset.create({
          data: { jobId, assetId: asset.id, relation: 'output' },
        });
      }

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
          reason: `Refund for failed video job ${jobId}`,
          referenceType: 'job',
          referenceId: jobId,
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
}
