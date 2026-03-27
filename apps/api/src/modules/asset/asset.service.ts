import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Asset, Prisma } from '@prisma/client';
import { STORAGE_BUCKETS, UPLOAD_LIMITS } from '@snapgen/config';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { assertUuid } from '../../utils/validation';

type AssetListParams = {
  kind?: string;
  page?: number;
  limit?: number;
  sort?: string;
};

type AssetWithContext = Prisma.AssetGetPayload<{
  include: {
    jobAssets: {
      include: {
        job: {
          select: {
            id: true;
            jobType: true;
            prompt: true;
            createdAt: true;
            character: {
              select: {
                name: true;
              };
            };
            stylePack: {
              select: {
                name: true;
              };
            };
          };
        };
      };
    };
  };
}>;

type AssetForSerialization = Asset & {
  jobAssets?: AssetWithContext['jobAssets'];
};

@Injectable()
export class AssetService {
  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
  ) {}

  async findAll(clerkUserId: string, params?: AssetListParams) {
    // Newly generated assets should appear immediately after job completion.
    const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!user) throw new NotFoundException('User not found');

    const page = Math.max(1, params?.page || 1);
    const limit = Math.min(Math.max(1, params?.limit || 24), 60);
    const sort = params?.sort === 'oldest' ? 'oldest' : 'newest';
    const where: Record<string, unknown> = {
      userId: user.id,
      moderationStatus: { not: 'deleted' },
    };
    if (params?.kind) where.kind = params.kind;

    const [items, total] = await Promise.all([
      this.prisma.asset.findMany({
        where,
        orderBy: { createdAt: sort === 'oldest' ? 'asc' : 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          jobAssets: {
            where: { relation: 'output' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              job: {
                select: {
                  id: true,
                  jobType: true,
                  prompt: true,
                  createdAt: true,
                  character: {
                    select: {
                      name: true,
                    },
                  },
                  stylePack: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.asset.count({ where }),
    ]);

    const data = await Promise.all(items.map((item) => this.serializeAsset(item)));

    return {
      data,
      total,
      page,
      limit,
      sort,
      totalPages: Math.ceil(total / limit),
    };
  }

  async uploadAsset(
    clerkUserId: string,
    file: {
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    },
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const allowedImageTypes = UPLOAD_LIMITS.allowedImageTypes as readonly string[];
    const allowedVideoTypes = UPLOAD_LIMITS.allowedVideoTypes as readonly string[];
    const isImage = allowedImageTypes.includes(file.mimetype);
    const isVideo = allowedVideoTypes.includes(file.mimetype);

    if (!isImage && !isVideo) {
      throw new BadRequestException('Please upload a JPEG, PNG, WebP, MP4, or WebM file');
    }

    if (file.size > UPLOAD_LIMITS.maxFileSizeBytes) {
      throw new BadRequestException('File size must be under 50MB');
    }

    const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!user) throw new NotFoundException('User not found');

    const bucket = process.env.R2_BUCKET_UPLOADS || STORAGE_BUCKETS.uploads;
    const sanitizedFileName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '-');
    const assetDirectory = isVideo ? 'videos' : 'images';
    const assetKind = isVideo ? 'uploaded-video' : 'uploaded-image';
    const storageKey = `users/${user.id}/uploads/${assetDirectory}/${Date.now()}-${sanitizedFileName}`;

    await this.storageService.saveBuffer(bucket, storageKey, file.buffer, file.mimetype);

    const asset = await this.prisma.asset.create({
      data: {
        userId: user.id,
        kind: assetKind,
        storageBucket: bucket,
        storageKey,
        mimeType: file.mimetype,
        fileSizeBytes: BigInt(file.size),
        moderationStatus: 'approved',
        metadataJson: {
          originalFileName: file.originalname,
          uploadSource: 'user',
        },
      },
    });

    return this.serializeAsset(asset);
  }

  async remove(clerkUserId: string, id: string) {
    assertUuid(id, 'assetId');

    const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!user) throw new NotFoundException('User not found');

    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('Asset not found');
    if (asset.userId !== user.id) throw new ForbiddenException();

    await this.storageService.deleteObject(asset.storageBucket, asset.storageKey);

    await this.prisma.$transaction(async (tx) => {
      await tx.character.updateMany({
        where: {
          userId: user.id,
          coverAssetId: id,
        },
        data: {
          coverAssetId: null,
        },
      });

      await tx.asset.delete({
        where: { id },
      });
    });

    return { id, deleted: true };
  }

  private async serializeAsset(asset: AssetForSerialization) {
    const metadata =
      asset.metadataJson &&
      typeof asset.metadataJson === 'object' &&
      !Array.isArray(asset.metadataJson)
        ? (asset.metadataJson as Record<string, unknown>)
        : {};
    const sourceJob = asset.jobAssets?.[0]?.job;

    return {
      id: asset.id,
      kind: asset.kind,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      fileSizeBytes: asset.fileSizeBytes.toString(),
      durationSec: asset.durationSec ? Number(asset.durationSec) : null,
      metadata: {
        originalFileName:
          typeof metadata.originalFileName === 'string' ? metadata.originalFileName : null,
        uploadSource: typeof metadata.uploadSource === 'string' ? metadata.uploadSource : null,
      },
      sourceJob: sourceJob
        ? {
            id: sourceJob.id,
            jobType: sourceJob.jobType,
            prompt: sourceJob.prompt,
            createdAt: sourceJob.createdAt.toISOString(),
            characterName: sourceJob.character?.name || null,
            stylePackName: sourceJob.stylePack?.name || null,
          }
        : null,
      url: await this.storageService.getAssetUrl(asset),
      createdAt: asset.createdAt.toISOString(),
    };
  }
}
