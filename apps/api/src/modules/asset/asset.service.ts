import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    BadRequestException,
} from '@nestjs/common';
import { STORAGE_BUCKETS, UPLOAD_LIMITS } from '@snapgen/config';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class AssetService {
    constructor(
        private prisma: PrismaService,
        private storageService: StorageService,
    ) { }

    async findAll(clerkUserId: string, params?: { kind?: string; page?: number; limit?: number }) {
        const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
        if (!user) throw new NotFoundException('User not found');

        const page = params?.page || 1;
        const limit = params?.limit || 20;
        const where: Record<string, unknown> = {
            userId: user.id,
            moderationStatus: { not: 'deleted' },
        };
        if (params?.kind) where.kind = params.kind;

        const [items, total] = await Promise.all([
            this.prisma.asset.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.prisma.asset.count({ where }),
        ]);

        const data = await Promise.all(items.map((item) => this.serializeAsset(item)));

        return {
            data,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

    async uploadImage(
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
        if (!allowedImageTypes.includes(file.mimetype)) {
            throw new BadRequestException('Please upload a JPEG, PNG, or WebP image');
        }

        if (file.size > UPLOAD_LIMITS.maxFileSizeBytes) {
            throw new BadRequestException('File size must be under 50MB');
        }

        const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
        if (!user) throw new NotFoundException('User not found');

        const bucket = process.env.R2_BUCKET_UPLOADS || STORAGE_BUCKETS.uploads;
        const sanitizedFileName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '-');
        const storageKey = `users/${user.id}/uploads/images/${Date.now()}-${sanitizedFileName}`;

        await this.storageService.saveBuffer(bucket, storageKey, file.buffer, file.mimetype);

        const asset = await this.prisma.asset.create({
            data: {
                userId: user.id,
                kind: 'uploaded-image',
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
        const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
        if (!user) throw new NotFoundException('User not found');

        const asset = await this.prisma.asset.findUnique({ where: { id } });
        if (!asset) throw new NotFoundException('Asset not found');
        if (asset.userId !== user.id) throw new ForbiddenException();

        // Soft delete by updating moderation status
        return this.prisma.asset.update({
            where: { id },
            data: { moderationStatus: 'deleted' },
        });
    }

    private async serializeAsset(asset: {
        id: string;
        kind: string;
        mimeType: string;
        width: number | null;
        height: number | null;
        createdAt: Date;
        storageBucket: string;
        storageKey: string;
        metadataJson: unknown;
    }) {
        return {
            id: asset.id,
            kind: asset.kind,
            mimeType: asset.mimeType,
            width: asset.width,
            height: asset.height,
            url: await this.storageService.getAssetUrl(asset),
            createdAt: asset.createdAt.toISOString(),
        };
    }
}
