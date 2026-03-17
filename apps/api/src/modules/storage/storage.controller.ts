import { Controller, Get, Put, Query, Req, Res, NotFoundException, BadRequestException, UseGuards } from '@nestjs/common';
import { Response, Request } from 'express';
import { StorageService } from './storage.service';
import { ClerkAuthGuard } from '../../guards/clerk-auth.guard';
import * as path from 'path';

const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50MB

function validateStoragePath(bucket: string, key: string): void {
    // Prevent path traversal: no ".." segments, no absolute paths in key
    if (bucket.includes('..') || bucket.startsWith('/')) {
        throw new BadRequestException('Invalid bucket name');
    }
    if (key.includes('..') || key.startsWith('/')) {
        throw new BadRequestException('Invalid key');
    }
    // Ensure resolved path stays within expected directory
    const normalized = path.normalize(path.join(bucket, key));
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
        throw new BadRequestException('Invalid storage path');
    }
}

@Controller('v1/storage')
@UseGuards(ClerkAuthGuard)
export class StorageController {
    constructor(private storageService: StorageService) {}

    @Get('files')
    async serveFile(
        @Query('bucket') bucket: string,
        @Query('key') key: string,
        @Res() res: Response,
    ) {
        if (!bucket || !key) {
            throw new NotFoundException('Missing bucket or key');
        }

        validateStoragePath(bucket, key);

        try {
            const buffer = await this.storageService.getLocalFileBuffer(bucket, key);
            const ext = path.extname(key).toLowerCase();
            const contentTypeMap: Record<string, string> = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
                '.svg': 'image/svg+xml',
                '.bmp': 'image/bmp',
            };
            res.set('Content-Type', contentTypeMap[ext] || 'application/octet-stream');
            res.set('Cache-Control', 'public, max-age=3600');
            res.send(buffer);
        } catch {
            throw new NotFoundException('File not found');
        }
    }

    @Put('upload')
    async uploadFile(
        @Query('bucket') bucket: string,
        @Query('key') key: string,
        @Req() req: Request,
        @Res() res: Response,
    ) {
        if (!bucket || !key) {
            res.status(400).json({ message: 'Missing bucket or key' });
            return;
        }

        validateStoragePath(bucket, key);

        const chunks: Buffer[] = [];
        const requestStream = req as Request & AsyncIterable<Buffer | string>;
        let totalSize = 0;
        for await (const chunk of requestStream) {
            const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            totalSize += bufferChunk.length;
            if (totalSize > MAX_UPLOAD_SIZE) {
                res.status(413).json({ message: 'File too large (max 50MB)' });
                return;
            }
            chunks.push(bufferChunk);
        }
        const buffer = Buffer.concat(chunks);
        await this.storageService.saveFileLocally(bucket, key, buffer);
        res.status(200).json({ success: true });
    }
}
