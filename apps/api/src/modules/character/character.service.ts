import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
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

        const coverAssets = coverAssetIds.length > 0
            ? await this.prisma.asset.findMany({
                where: { id: { in: coverAssetIds } },
                select: { id: true, storageBucket: true, storageKey: true },
            })
            : [];

        const coverMap = new Map(coverAssets.map((a) => [a.id, a]));

        return characters.map((character) => {
            const coverAsset = character.coverAssetId
                ? coverMap.get(character.coverAssetId)
                : null;

            return {
                id: character.id,
                name: character.name,
                slug: character.slug,
                characterType: character.characterType,
                status: character.status,
                coverUrl: coverAsset
                    ? this.storageService.getFileUrl(coverAsset.storageBucket, coverAsset.storageKey)
                    : null,
                imageCount: character.datasets.reduce((sum, d) => sum + d.imageCount, 0),
                createdAt: character.createdAt.toISOString(),
            };
        });
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

        await this.prisma.characterDataset.create({
            data: {
                characterId: character.id,
                status: 'uploaded',
                imageCount: 1,
                validationReport: {
                    assetId: asset.id,
                    fileName: data.fileName,
                } as Prisma.InputJsonValue,
            },
        });

        await this.prisma.character.update({
            where: { id: character.id },
            data: { status: 'ready' },
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

    async uploadDataset(clerkUserId: string, characterId: string, file: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
        if (!file) throw new BadRequestException('No file provided');

        const character = await this.findOne(clerkUserId, characterId);
        const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
        if (!user) throw new NotFoundException('User not found');

        const bucket = process.env.R2_BUCKET_UPLOADS || STORAGE_BUCKETS.uploads;
        const storageKey = `users/${user.id}/characters/${character.id}/datasets/${Date.now()}-${file.originalname}`;

        // Save the file
        await this.storageService.saveFileLocally(bucket, storageKey, file.buffer);

        // Create asset record
        const asset = await this.prisma.asset.create({
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

        // Create dataset record
        await this.prisma.characterDataset.create({
            data: {
                characterId: character.id,
                status: 'uploaded',
                imageCount: 1,
                validationReport: {
                    assetId: asset.id,
                    fileName: file.originalname,
                } as Prisma.InputJsonValue,
            },
        });

        // Update character status and set cover if first image
        const rawCharacter = await this.prisma.character.findUnique({
            where: { id: character.id },
        });

        await this.prisma.character.update({
            where: { id: character.id },
            data: {
                status: 'ready',
                ...(!rawCharacter?.coverAssetId ? { coverAssetId: asset.id } : {}),
            },
        });

        return {
            assetId: asset.id,
            imageUrl: this.storageService.getFileUrl(bucket, storageKey),
        };
    }

    async trainModel(clerkUserId: string, characterId: string, data: { trainingPreset: string }) {
        const character = await this.findOne(clerkUserId, characterId);
        const provider = this.getCharacterProvider();
        const usesGeminiReferenceMode = provider === 'google' || provider === 'gemini' || provider === 'stability';

        const model = await this.prisma.characterModel.create({
            data: {
                characterId: character.id,
                provider,
                modelType: usesGeminiReferenceMode ? 'reference-set' : 'lora',
                versionTag: `v${Date.now().toString(36)}`,
                status: usesGeminiReferenceMode ? 'ready' : 'queued',
                metadataJson: {
                    trainingPreset: data.trainingPreset,
                    mode: usesGeminiReferenceMode ? 'reference-images' : 'lora-training',
                } as Prisma.InputJsonValue,
            },
        });

        // Update character status
        await this.prisma.character.update({
            where: { id: character.id },
            data: {
                status: usesGeminiReferenceMode ? 'ready' : 'training',
                latestModelId: model.id,
            },
        });

        return model;
    }

    private getCharacterProvider(): string {
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
