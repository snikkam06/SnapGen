import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const LOCAL_DB_PORT = process.env.SNAPGEN_LOCAL_DB_PORT || '55432';

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

function normalizeDatabaseUrl(rawValue?: string): string | undefined {
  if (!rawValue?.trim()) {
    return undefined;
  }

  try {
    const parsed = new URL(rawValue);
    if (hasLocalDbCluster() && LOCAL_HOSTS.has(parsed.hostname)) {
      parsed.port = LOCAL_DB_PORT;
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

  for (const candidatePath of getEnvCandidatePaths()) {
    if (fs.existsSync(candidatePath)) {
      dotenv.config({ path: candidatePath, override: false });
    }
  }

  const databaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL);
  const directUrl = normalizeDatabaseUrl(process.env.DIRECT_URL);

  if (databaseUrl) {
    process.env.DATABASE_URL = databaseUrl;
  }

  if (directUrl) {
    process.env.DIRECT_URL = directUrl;
  }

  loaded = true;
}
