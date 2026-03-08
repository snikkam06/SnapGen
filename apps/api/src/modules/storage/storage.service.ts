import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as path from 'path';
import * as fs from 'fs/promises';

@Injectable()
export class StorageService {
    private s3: S3Client | null = null;
    private uploadsDir = path.join(process.cwd(), 'uploads');

    constructor() {
        if (process.env.R2_ACCOUNT_ID && process.env.STORAGE_MODE !== 'local') {
            this.s3 = new S3Client({
                region: 'auto',
                endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
                credentials: {
                    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
                    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
                },
            });
        }
    }

    isLocalMode(): boolean {
        return !this.s3;
    }

    async getSignedUploadUrl(bucket: string, key: string, contentType: string): Promise<string> {
        if (this.isLocalMode()) {
            const apiUrl = process.env.API_URL || 'http://localhost:3001';
            return `${apiUrl}/api/v1/storage/upload?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`;
        }
        const command = new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            ContentType: contentType,
        });
        return getSignedUrl(this.s3!, command, { expiresIn: 3600 });
    }

    async getSignedDownloadUrl(bucket: string, key: string): Promise<string> {
        if (this.isLocalMode()) {
            return this.getFileUrl(bucket, key);
        }
        const command = new GetObjectCommand({
            Bucket: bucket,
            Key: key,
        });
        return getSignedUrl(this.s3!, command, { expiresIn: 3600 });
    }

    getFileUrl(bucket: string, key: string): string {
        const apiUrl = process.env.API_URL || 'http://localhost:3001';
        return `${apiUrl}/api/v1/storage/files?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`;
    }

    async saveFileLocally(bucket: string, key: string, buffer: Buffer): Promise<void> {
        const filePath = path.join(this.uploadsDir, bucket, key);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, buffer);
    }

    async getLocalFileBuffer(bucket: string, key: string): Promise<Buffer> {
        return fs.readFile(path.join(this.uploadsDir, bucket, key));
    }

    getObjectKey(userId: string, type: string, ...parts: string[]): string {
        return `users/${userId}/${type}/${parts.join('/')}`;
    }
}
