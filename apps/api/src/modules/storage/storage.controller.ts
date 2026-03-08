import { Controller, Get, Put, Query, Req, Res, NotFoundException } from '@nestjs/common';
import { Response, Request } from 'express';
import { StorageService } from './storage.service';
import * as path from 'path';

@Controller('v1/storage')
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

        const chunks: Buffer[] = [];
        for await (const chunk of req as any) {
            chunks.push(Buffer.from(chunk));
        }
        const buffer = Buffer.concat(chunks);
        await this.storageService.saveFileLocally(bucket, key, buffer);
        res.status(200).json({ success: true });
    }
}
