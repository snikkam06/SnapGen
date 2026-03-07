// ─── App configuration constants ─────────────────────

export const APP_NAME = 'SnapGen';
export const APP_DESCRIPTION = 'Create stunning AI-generated images with custom characters and styles';

// ─── Credit costs per job type ───────────────────────
export const CREDIT_COSTS = {
    image: 5,
    video: 25,
    'faceswap-image': 10,
    'faceswap-video': 30,
    upscale: 3,
    training: 100,
} as const;

// ─── Rate limits ─────────────────────────────────────
export const RATE_LIMITS = {
    auth: { ttl: 60, limit: 10 },
    generation: { ttl: 60, limit: 20 },
    upload: { ttl: 60, limit: 50 },
    api: { ttl: 60, limit: 100 },
} as const;

// ─── File upload limits ──────────────────────────────
export const UPLOAD_LIMITS = {
    maxFileSizeBytes: 50 * 1024 * 1024, // 50MB
    allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp'],
    allowedVideoTypes: ['video/mp4', 'video/webm'],
    maxDatasetImages: 50,
    minDatasetImages: 5,
} as const;

// ─── Job settings defaults ───────────────────────────
export const JOB_DEFAULTS = {
    image: {
        aspectRatio: '1:1',
        numImages: 4,
        guidance: 7.0,
        steps: 30,
    },
    video: {
        durationSec: 5,
        aspectRatio: '9:16',
    },
    upscale: {
        mode: 'realism' as const,
        scale: 2,
    },
} as const;

// ─── Storage buckets ─────────────────────────────────
export const STORAGE_BUCKETS = {
    uploads: 'uploads-private',
    outputs: 'outputs-private',
    thumbnails: 'thumbnails-public',
    exports: 'exports-private',
} as const;

// ─── Subscription plan codes ─────────────────────────
export const PLAN_CODES = {
    FREE: 'free',
    CREATOR: 'creator-monthly',
    PRO: 'pro-monthly',
    BUSINESS: 'business-monthly',
} as const;

// ─── Job status transitions ─────────────────────────
export const VALID_JOB_TRANSITIONS: Record<string, string[]> = {
    queued: ['running', 'canceled', 'failed'],
    running: ['completed', 'failed', 'canceled'],
    completed: [],
    failed: [],
    canceled: [],
} as const;

export interface RedisConnectionConfig {
    host: string;
    port: number;
    db?: number;
    username?: string;
    password?: string;
    tls?: Record<string, never>;
    maxRetriesPerRequest: null;
}

export function getRedisConnectionConfig(
    redisUrl = 'redis://localhost:6379',
): RedisConnectionConfig {
    const parsed = new URL(redisUrl);
    const db = parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : undefined;

    return {
        host: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : parsed.protocol === 'rediss:' ? 6380 : 6379,
        ...(Number.isFinite(db) ? { db } : {}),
        ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
        ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
        ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
        maxRetriesPerRequest: null,
    };
}
