import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { STORAGE_BUCKETS, UPLOAD_LIMITS } from '@snapgen/config';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { assertNonEmptyString, assertUuid, sanitizeFileName } from '../../utils/validation';

@Injectable()
export class CharacterService {
  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
  ) {}

  async create(clerkUserId: string, data: { name: string; characterType: string }) {
    const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!user) throw new NotFoundException('User not found');

    const name = assertNonEmptyString(data.name, 'name');
    const characterType = assertNonEmptyString(data.characterType, 'characterType');
    const slug = name
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return this.prisma.character.create({
      data: {
        userId: user.id,
        name,
        slug: `${slug}-${Date.now().toString(36)}`,
        characterType,
        status: 'draft',
      },
    });
  }

  async findAll(clerkUserId: string) {
    const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!user) throw new NotFoundException('User not found');

    const characters = await this.prisma.character.findMany({
      where: { userId: user.id, status: { not: 'deleted' } },
      orderBy: { createdAt: 'desc' },
      include: {
        datasets: {
          select: { imageCount: true },
        },
      },
    });

    // Resolve cover URLs
    const coverAssetIds = characters
      .map((c) => c.coverAssetId)
      .filter((id): id is string => id !== null);

    const coverAssets =
      coverAssetIds.length > 0
        ? await this.prisma.asset.findMany({
            where: { id: { in: coverAssetIds } },
            select: { id: true, storageBucket: true, storageKey: true },
          })
        : [];

    const coverMap = new Map(coverAssets.map((a) => [a.id, a]));

    return Promise.all(
      characters.map(async (character) => {
        const coverAsset = character.coverAssetId ? coverMap.get(character.coverAssetId) : null;

        return {
          id: character.id,
          name: character.name,
          slug: character.slug,
          characterType: character.characterType,
          status: character.status,
          coverUrl: coverAsset
            ? await this.storageService.getSignedDownloadUrl(
                coverAsset.storageBucket,
                coverAsset.storageKey,
              )
            : null,
          imageCount: character.datasets.reduce((sum, d) => sum + d.imageCount, 0),
          createdAt: character.createdAt.toISOString(),
        };
      }),
    );
  }

  async findOne(clerkUserId: string, id: string) {
    assertUuid(id, 'characterId');

    const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!user) throw new NotFoundException('User not found');

    const character = await this.prisma.character.findUnique({
      where: { id },
      include: {
        datasets: { orderBy: { createdAt: 'desc' } },
        models: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!character) throw new NotFoundException('Character not found');
    if (character.userId !== user.id) throw new ForbiddenException();

    return {
      id: character.id,
      name: character.name,
      slug: character.slug,
      characterType: character.characterType,
      status: character.status,
      coverUrl: null,
      createdAt: character.createdAt.toISOString(),
      updatedAt: character.updatedAt.toISOString(),
      datasets: character.datasets.map((dataset) => ({
        id: dataset.id,
        status: dataset.status,
        imageCount: dataset.imageCount,
        qualityScore: dataset.qualityScore ? Number(dataset.qualityScore) : null,
        createdAt: dataset.createdAt.toISOString(),
      })),
      models: character.models.map((model) => ({
        id: model.id,
        provider: model.provider,
        modelType: model.modelType,
        versionTag: model.versionTag,
        status: model.status,
        createdAt: model.createdAt.toISOString(),
      })),
    };
  }

  async update(clerkUserId: string, id: string, data: { name?: string }) {
    const character = await this.findOne(clerkUserId, id);
    return this.prisma.character.update({
      where: { id: character.id },
      data,
    });
  }

  async remove(clerkUserId: string, id: string) {
    const character = await this.findOne(clerkUserId, id);
    return this.prisma.character.update({
      where: { id: character.id },
      data: { status: 'deleted' },
    });
  }

  async getUploadUrl(
    clerkUserId: string,
    characterId: string,
    data: { fileName: string; contentType: string; fileSizeBytes: number },
  ) {
    const character = await this.findOne(clerkUserId, characterId);
    const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!user) throw new NotFoundException('User not found');

    const fileName = assertNonEmptyString(data.fileName, 'fileName');
    const contentType = assertNonEmptyString(data.contentType, 'contentType');
    const allowedImageTypes = UPLOAD_LIMITS.allowedImageTypes as readonly string[];
    if (!allowedImageTypes.includes(contentType)) {
      throw new BadRequestException('Please upload a JPEG, PNG, or WebP image');
    }

    if (data.fileSizeBytes > UPLOAD_LIMITS.maxFileSizeBytes) {
      throw new BadRequestException('File size must be under 50MB');
    }

    const bucket = process.env.R2_BUCKET_UPLOADS || STORAGE_BUCKETS.uploads;
    const sanitizedFileName = sanitizeFileName(fileName);
    const storageKey = `users/${user.id}/characters/${character.id}/datasets/${Date.now()}-${sanitizedFileName}`;

    return {
      assetId: null,
      uploadUrl: await this.storageService.getSignedUploadUrl(bucket, storageKey, contentType),
      publicUrl: null,
      headers: {
        'Content-Type': contentType,
      },
    };
  }

  async uploadDataset(
    clerkUserId: string,
    characterId: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ) {
    if (!file) throw new BadRequestException('No file provided');

    const allowedImageTypes = UPLOAD_LIMITS.allowedImageTypes as readonly string[];
    if (!allowedImageTypes.includes(file.mimetype)) {
      throw new BadRequestException('Please upload a JPEG, PNG, or WebP image');
    }

    if (file.size > UPLOAD_LIMITS.maxFileSizeBytes) {
      throw new BadRequestException('File size must be under 50MB');
    }

    const character = await this.findOne(clerkUserId, characterId);
    const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!user) throw new NotFoundException('User not found');

    const bucket = process.env.R2_BUCKET_UPLOADS || STORAGE_BUCKETS.uploads;
    const sanitizedFileName = sanitizeFileName(file.originalname);
    const storageKey = `users/${user.id}/characters/${character.id}/datasets/${Date.now()}-${sanitizedFileName}`;

    await this.storageService.saveBuffer(bucket, storageKey, file.buffer, file.mimetype);

    let asset;
    try {
      asset = await this.prisma.$transaction(async (tx) => {
        const createdAsset = await tx.asset.create({
          data: {
            userId: user.id,
            kind: 'dataset-image',
            storageBucket: bucket,
            storageKey,
            mimeType: file.mimetype,
            fileSizeBytes: BigInt(file.size),
            moderationStatus: 'approved',
          },
        });

        await tx.characterDataset.create({
          data: {
            characterId: character.id,
            status: 'uploaded',
            imageCount: 1,
            validationReport: {
              assetId: createdAsset.id,
              fileName: file.originalname,
            } as Prisma.InputJsonValue,
          },
        });

        const rawCharacter = await tx.character.findUnique({
          where: { id: character.id },
          select: { coverAssetId: true },
        });

        await tx.character.update({
          where: { id: character.id },
          data: {
            status: 'ready',
            ...(!rawCharacter?.coverAssetId ? { coverAssetId: createdAsset.id } : {}),
          },
        });

        return createdAsset;
      });
    } catch (error) {
      await this.storageService.deleteObject(bucket, storageKey).catch((cleanupError) => {
        console.error(
          `[CharacterService] Failed to clean up dataset upload ${storageKey}:`,
          cleanupError,
        );
      });
      throw error;
    }

    return {
      assetId: asset.id,
      imageUrl: await this.storageService.getSignedDownloadUrl(bucket, storageKey),
    };
  }

  async trainModel(clerkUserId: string, characterId: string, data: { trainingPreset: string }) {
    const character = await this.findOne(clerkUserId, characterId);
    const trainingPreset = assertNonEmptyString(data.trainingPreset, 'trainingPreset');
    const provider = this.getCharacterProvider();
    const usesReferenceMode =
      provider === 'fal' ||
      provider === 'google' ||
      provider === 'gemini' ||
      provider === 'stability';

    return this.prisma.$transaction(async (tx) => {
      const model = await tx.characterModel.create({
        data: {
          characterId: character.id,
          provider,
          modelType: usesReferenceMode ? 'reference-set' : 'lora',
          versionTag: `v${Date.now().toString(36)}`,
          status: usesReferenceMode ? 'ready' : 'queued',
          metadataJson: {
            trainingPreset,
            mode: usesReferenceMode ? 'reference-images' : 'lora-training',
          } as Prisma.InputJsonValue,
        },
      });

      await tx.character.update({
        where: { id: character.id },
        data: {
          status: usesReferenceMode ? 'ready' : 'training',
          latestModelId: model.id,
        },
      });

      return model;
    });
  }

  private getCharacterProvider(): string {
    if (process.env.IMAGE_PROVIDER === 'fal' || process.env.FAL_API_KEY) {
      return 'fal';
    }

    if (process.env.IMAGE_PROVIDER === 'google' || process.env.IMAGE_PROVIDER === 'gemini') {
      return 'google';
    }

    if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
      return 'google';
    }

    if (process.env.IMAGE_PROVIDER) {
      return process.env.IMAGE_PROVIDER;
    }

    return 'fal';
  }
}
