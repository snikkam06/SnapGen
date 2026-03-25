import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { assertValidSupabaseDatabaseConfig } from '@snapgen/config';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const LOCAL_DB_PORT = process.env.SNAPGEN_LOCAL_DB_PORT || '55432';
const DEFAULT_DB_POOL_TIMEOUT_SEC = process.env.SNAPGEN_DB_POOL_TIMEOUT_SEC || '30';

let loaded = false;

function clearEmptyEnvVar(name: string): void {
  if (process.env[name]?.trim() === '') {
    delete process.env[name];
  }
}

function getEnvCandidatePaths(): string[] {
  return [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'apps/api/.env'),
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../../../.env'),
  ];
}

function hasLocalDbCluster(): boolean {
  const candidatePaths = [
    path.resolve(process.cwd(), '.local/postgres/PG_VERSION'),
    path.resolve(process.cwd(), '../../.local/postgres/PG_VERSION'),
    path.resolve(__dirname, '../../../../.local/postgres/PG_VERSION'),
  ];

  return candidatePaths.some((candidatePath) => fs.existsSync(candidatePath));
}

function isSupabaseTransactionPoolerUrl(parsed: URL): boolean {
  return parsed.hostname.endsWith('.pooler.supabase.com') && parsed.port === '6543';
}

function normalizeDatabaseUrl(
  rawValue?: string,
  options?: { applyRuntimePoolTuning?: boolean },
): string | undefined {
  if (!rawValue?.trim()) {
    return undefined;
  }

  try {
    const parsed = new URL(rawValue);
    if (hasLocalDbCluster() && LOCAL_HOSTS.has(parsed.hostname)) {
      parsed.port = LOCAL_DB_PORT;
    }

    if (parsed.protocol.startsWith('postgres') && isSupabaseTransactionPoolerUrl(parsed)) {
      parsed.searchParams.set('pgbouncer', 'true');
    }

    if (options?.applyRuntimePoolTuning && parsed.protocol.startsWith('postgres')) {
      if (!parsed.searchParams.has('connection_limit')) {
        const defaultConnectionLimit = process.env.SNAPGEN_DB_CONNECTION_LIMIT
          || (parsed.hostname.endsWith('.pooler.supabase.com') && parsed.port === '6543' ? '10' : '2');
        parsed.searchParams.set('connection_limit', defaultConnectionLimit);
      }
      if (!parsed.searchParams.has('pool_timeout')) {
        parsed.searchParams.set('pool_timeout', DEFAULT_DB_POOL_TIMEOUT_SEC);
      }
    }

    return parsed.toString();
  } catch {
    return rawValue;
  }
}

export function loadApiEnv(): void {
  if (loaded) {
    return;
  }

  clearEmptyEnvVar('DATABASE_URL');
  clearEmptyEnvVar('DIRECT_URL');
  clearEmptyEnvVar('DATABASE_READ_URL');

  for (const candidatePath of getEnvCandidatePaths()) {
    if (fs.existsSync(candidatePath)) {
      dotenv.config({ path: candidatePath, override: false });
    }
  }

  const databaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL, {
    applyRuntimePoolTuning: true,
  });
  const directUrl = normalizeDatabaseUrl(process.env.DIRECT_URL);
  const readUrl = normalizeDatabaseUrl(process.env.DATABASE_READ_URL, {
    applyRuntimePoolTuning: true,
  });

  if (databaseUrl) {
    process.env.DATABASE_URL = databaseUrl;
  }

  if (directUrl) {
    process.env.DIRECT_URL = directUrl;
  }

  if (readUrl) {
    process.env.DATABASE_READ_URL = readUrl;
  }

  assertValidSupabaseDatabaseConfig({
    databaseUrl: process.env.DATABASE_URL,
    directUrl: process.env.DIRECT_URL,
    readUrl: process.env.DATABASE_READ_URL,
    context: 'API DB config',
  });

  loaded = true;
}
