import { Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getLegacyLocalStorageDirs, getLocalStorageDir } from '@snapgen/config';
import * as path from 'path';
import * as fs from 'fs/promises';

@Injectable()
export class StorageService {
  private s3: S3Client | null = null;
  private uploadsDir = getLocalStorageDir(__dirname);
  private legacyUploadsDirs = getLegacyLocalStorageDirs(__dirname);

  constructor() {
    if (this.hasRemoteStorageConfig()) {
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

  private hasRemoteStorageConfig(): boolean {
    return Boolean(
      process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.STORAGE_MODE !== 'local',
    );
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

  private getLocalFilePaths(bucket: string, key: string): string[] {
    return [this.uploadsDir, ...this.legacyUploadsDirs].map((baseDir) =>
      path.join(baseDir, bucket, key),
    );
  }

  private async getExistingLocalFilePath(bucket: string, key: string): Promise<string | null> {
    for (const filePath of this.getLocalFilePaths(bucket, key)) {
      try {
        await fs.access(filePath);
        return filePath;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }

    return null;
  }

  async saveBuffer(
    bucket: string,
    key: string,
    buffer: Buffer,
    contentType = 'application/octet-stream',
  ): Promise<void> {
    if (this.isLocalMode()) {
      await this.saveFileLocally(bucket, key, buffer);
      return;
    }

    await this.s3!.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );
  }

  async saveFromUrl(
    bucket: string,
    key: string,
    url: string,
    contentType?: string,
  ): Promise<{ contentType: string; sizeBytes: number }> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download remote file: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const resolvedContentType =
      contentType || response.headers.get('content-type') || 'application/octet-stream';

    await this.saveBuffer(bucket, key, buffer, resolvedContentType);

    return {
      contentType: resolvedContentType,
      sizeBytes: buffer.byteLength,
    };
  }

  async saveFileLocally(bucket: string, key: string, buffer: Buffer): Promise<void> {
    const filePath = path.join(this.uploadsDir, bucket, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    if (this.isLocalMode()) {
      const filePath = await this.getExistingLocalFilePath(bucket, key);
      if (!filePath) {
        return;
      }

      await fs.unlink(filePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      });
      return;
    }

    await this.s3!.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
  }

  async getLocalFileBuffer(bucket: string, key: string): Promise<Buffer> {
    const filePath = await this.getExistingLocalFilePath(bucket, key);
    if (filePath) {
      return fs.readFile(filePath);
    }

    throw new Error(`Local file not found for ${bucket}/${key}`);
  }

  getObjectKey(userId: string, type: string, ...parts: string[]): string {
    return `users/${userId}/${type}/${parts.join('/')}`;
  }

  async getAssetUrl(asset: {
    storageBucket: string;
    storageKey: string;
    metadataJson: unknown;
  }): Promise<string> {
    const metadata = asset.metadataJson as Record<string, unknown> | null;
    const sourceUrl = typeof metadata?.sourceUrl === 'string' ? metadata.sourceUrl : null;
    if (sourceUrl) {
      return sourceUrl;
    }

    const providerUrl = typeof metadata?.providerUrl === 'string' ? metadata.providerUrl : null;
    if (providerUrl?.startsWith('data:')) {
      return providerUrl;
    }

    if (await this.getExistingLocalFilePath(asset.storageBucket, asset.storageKey)) {
      return this.getFileUrl(asset.storageBucket, asset.storageKey);
    }

    return this.getSignedDownloadUrl(asset.storageBucket, asset.storageKey);
  }
}
