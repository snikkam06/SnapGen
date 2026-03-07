import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { STORAGE_BUCKETS } from '@snapgen/config';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class CharacterService {
    constructor(
        private prisma: PrismaService,
        private storageService: StorageService,
    ) { }

    async create(clerkUserId: string, data: { name: string; characterType: string }) {
        const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
        if (!user) throw new NotFoundException('User not found');

        const slug = data.name
            .toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '');

        return this.prisma.character.create({
            data: {
                userId: user.id,
                name: data.name,
                slug: `${slug}-${Date.now().toString(36)}`,
                characterType: data.characterType,
                status: 'draft',
            },
        });
    }

    async findAll(clerkUserId: string) {
        const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
        if (!user) throw new NotFoundException('User not found');

        const characters = await this.prisma.character.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: 'desc' },
            include: {
                _count: {
                    select: {
                        datasets: true,
                    },
                },
            },
        });

        return characters.map((character) => ({
            id: character.id,
            name: character.name,
            slug: character.slug,
            characterType: character.characterType,
            status: character.status,
            coverUrl: null,
            imageCount: character._count.datasets,
            createdAt: character.createdAt.toISOString(),
        }));
    }

    async findOne(clerkUserId: string, id: string) {
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

    async getUploadUrl(clerkUserId: string, characterId: string, data: { fileName: string; contentType: string; fileSizeBytes: number }) {
        const character = await this.findOne(clerkUserId, characterId);
        const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
        if (!user) throw new NotFoundException('User not found');

        // Create asset record
        const bucket = process.env.R2_BUCKET_UPLOADS || STORAGE_BUCKETS.uploads;
        const storageKey = `users/${user.id}/characters/${character.id}/datasets/${Date.now()}-${data.fileName}`;
        const asset = await this.prisma.asset.create({
            data: {
                userId: user.id,
                kind: 'dataset-image',
                storageBucket: bucket,
                storageKey,
                mimeType: data.contentType,
                fileSizeBytes: BigInt(data.fileSizeBytes),
                moderationStatus: 'approved',
            },
        });

        return {
            assetId: asset.id,
            uploadUrl: await this.storageService.getSignedUploadUrl(
                bucket,
                storageKey,
                data.contentType,
            ),
            publicUrl: null,
            headers: {
                'Content-Type': data.contentType,
            },
        };
    }

    async trainModel(clerkUserId: string, characterId: string, data: { trainingPreset: string }) {
        const character = await this.findOne(clerkUserId, characterId);

        const model = await this.prisma.characterModel.create({
            data: {
                characterId: character.id,
                provider: 'fal',
                modelType: 'lora',
                versionTag: `v${Date.now().toString(36)}`,
                status: 'queued',
                metadataJson: {
                    trainingPreset: data.trainingPreset,
                } as Prisma.InputJsonValue,
            },
        });

        // Update character status
        await this.prisma.character.update({
            where: { id: character.id },
            data: { status: 'training', latestModelId: model.id },
        });

        return model;
    }
}
