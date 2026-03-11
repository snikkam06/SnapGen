import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
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
        const where: Record<string, unknown> = { userId: user.id };
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
