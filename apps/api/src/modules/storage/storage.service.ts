import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class StorageService {
    private s3: S3Client;

    constructor() {
        this.s3 = new S3Client({
            region: 'auto',
            endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
                secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
            },
        });
    }

    async getSignedUploadUrl(bucket: string, key: string, contentType: string): Promise<string> {
        const command = new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            ContentType: contentType,
        });
        return getSignedUrl(this.s3, command, { expiresIn: 3600 });
    }

    async getSignedDownloadUrl(bucket: string, key: string): Promise<string> {
        const command = new GetObjectCommand({
            Bucket: bucket,
            Key: key,
        });
        return getSignedUrl(this.s3, command, { expiresIn: 3600 });
    }

    getObjectKey(userId: string, type: string, ...parts: string[]): string {
        return `users/${userId}/${type}/${parts.join('/')}`;
    }
}
