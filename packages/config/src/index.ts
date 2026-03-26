import fs from 'node:fs';
import path from 'node:path';

// ─── App configuration constants ─────────────────────

export const APP_NAME = 'SnapGen';
export const APP_DESCRIPTION = 'Create stunning AI-generated images with custom characters and styles';

// ─── Credit costs per job type ───────────────────────
export const CREDIT_COSTS = {
    image: 5,
    video: 25,
    'faceswap-image': 10,
    'faceswap-video': 30,

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

export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.NODE_ENV === 'production';
}

export function hasRemoteStorageConfig(env: NodeJS.ProcessEnv = process.env): boolean {
    return Boolean(
        env.R2_ACCOUNT_ID
        && env.R2_ACCESS_KEY_ID
        && env.R2_SECRET_ACCESS_KEY
        && env.STORAGE_MODE !== 'local',
    );
}

type SupabaseUrlExpectation = 'runtime' | 'direct';

function isSupabasePoolerHost(hostname: string): boolean {
    return hostname.endsWith('.pooler.supabase.com');
}

function isSupabaseDirectHost(hostname: string): boolean {
    return hostname.startsWith('db.') && hostname.endsWith('.supabase.co');
}

function validateSupabaseUrl(
    envVar: 'DATABASE_URL' | 'DIRECT_URL' | 'DATABASE_READ_URL',
    rawValue: string | undefined,
    expectation: SupabaseUrlExpectation,
): string[] {
    if (!rawValue?.trim()) {
        return [];
    }

    let parsed: URL;
    try {
        parsed = new URL(rawValue);
    } catch {
        return [];
    }

    const errors: string[] = [];
    const host = parsed.hostname;
    const port = parsed.port;

    if (expectation === 'runtime') {
        if (isSupabaseDirectHost(host)) {
            errors.push(
                `${envVar} points to the direct Supabase host (${host}). Use the transaction pooler host on port 6543 for runtime queries.`,
            );
        }

        if (isSupabasePoolerHost(host) && port !== '6543') {
            errors.push(
                `${envVar} points to the Supabase pooler on port ${port || '(default)'}. Use port 6543 for transaction mode runtime queries.`,
            );
        }

        if (
            isSupabasePoolerHost(host)
            && port === '6543'
            && parsed.searchParams.get('pgbouncer') !== 'true'
        ) {
            errors.push(
                `${envVar} is missing pgbouncer=true. Supabase transaction mode requires pgbouncer=true so Prisma does not use prepared statements.`,
            );
        }
    }

    if (expectation === 'direct') {
        if (isSupabasePoolerHost(host) && port && port !== '5432') {
            errors.push(
                `${envVar} points to the Supabase pooler on port ${port}. Use the session pooler on port 5432 for IPv4 migrations, or the direct database host on port 5432 when IPv6 direct access is available.`,
            );
        }

        if (isSupabaseDirectHost(host) && port && port !== '5432') {
            errors.push(
                `${envVar} points to the Supabase direct host on port ${port}. Use port 5432 for direct migration access.`,
            );
        }
    }

    return errors;
}

export function assertValidSupabaseDatabaseConfig(options: {
    databaseUrl?: string;
    directUrl?: string;
    readUrl?: string;
    context?: string;
}): void {
    const errors = [
        ...validateSupabaseUrl('DATABASE_URL', options.databaseUrl, 'runtime'),
        ...validateSupabaseUrl('DIRECT_URL', options.directUrl, 'direct'),
        ...validateSupabaseUrl('DATABASE_READ_URL', options.readUrl, 'runtime'),
    ];

    if (errors.length === 0) {
        return;
    }

    const prefix = options.context ? `[${options.context}] ` : '';
    throw new Error(`${prefix}${errors.join(' ')}`);
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

export function findWorkspaceRoot(startDir = process.cwd()): string {
    let currentDir = path.resolve(startDir);

    while (true) {
        if (fs.existsSync(path.join(currentDir, 'pnpm-workspace.yaml'))) {
            return currentDir;
        }

        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            return path.resolve(startDir);
        }

        currentDir = parentDir;
    }
}

export function getLocalStorageDir(startDir = process.cwd()): string {
    if (process.env.STORAGE_LOCAL_DIR) {
        return path.resolve(process.env.STORAGE_LOCAL_DIR);
    }

    return path.join(findWorkspaceRoot(startDir), 'uploads');
}

export function getLegacyLocalStorageDirs(startDir = process.cwd()): string[] {
    const workspaceRoot = findWorkspaceRoot(startDir);
    const primaryDir = getLocalStorageDir(startDir);

    return [
        path.join(workspaceRoot, 'apps/api/uploads'),
        path.join(workspaceRoot, 'apps/worker-media/uploads'),
    ].filter((dir) => dir !== primaryDir);
}
