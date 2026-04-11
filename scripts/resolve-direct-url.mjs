import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);

function isSupabasePoolerHost(hostname) {
    return hostname.endsWith('.pooler.supabase.com');
}

function isSupabaseDirectHost(hostname) {
    return hostname.startsWith('db.') && hostname.endsWith('.supabase.co');
}

function assertValidDirectDatabaseUrl(parsed) {
    if (isSupabasePoolerHost(parsed.hostname) && parsed.port && parsed.port !== '5432') {
        throw new Error(
            `DIRECT_URL points to the Supabase pooler host (${parsed.hostname}) on port ${parsed.port}. Use the session pooler on port 5432 for IPv4 migrations, or the direct database host on port 5432 when IPv6 direct access is available.`,
        );
    }

    if (isSupabaseDirectHost(parsed.hostname) && parsed.port && parsed.port !== '5432') {
        throw new Error(
            `DIRECT_URL points to the Supabase direct host on port ${parsed.port}. Use port 5432 for direct migration access.`,
        );
    }
}

function readEnvValue(envPath, name) {
    const value = process.env[name];
    if (value?.trim()) {
        return value;
    }

    if (!envPath) {
        return undefined;
    }

    const envContents = fs.readFileSync(envPath, 'utf8');
    const envLine = envContents
        .split(/\r?\n/)
        .find((line) => line.startsWith(`${name}=`));

    return envLine ? envLine.slice(`${name}=`.length) : undefined;
}

const envPathCandidates = [
    path.join(repoRoot, '.env'),
    path.join(repoRoot, 'apps/api/.env'),
];
const directUrlFromEnv = process.env.DIRECT_URL?.trim();
const envPath = envPathCandidates.find((candidatePath) => fs.existsSync(candidatePath));
const localClusterPath = path.join(repoRoot, '.local/postgres/PG_VERSION');

const databaseUrl = readEnvValue(envPath, 'DATABASE_URL');
const directUrl = directUrlFromEnv
    || readEnvValue(envPath, 'DIRECT_URL')
    || (() => {
        if (!databaseUrl?.trim()) {
            return undefined;
        }

        const parsedDatabaseUrl = new URL(databaseUrl);
        if (isSupabasePoolerHost(parsedDatabaseUrl.hostname)) {
            throw new Error(
                'DIRECT_URL is required when DATABASE_URL uses the Supabase pooler host.',
            );
        }

        return databaseUrl;
    })();

if (!directUrl?.trim()) {
    throw new Error(
        `DIRECT_URL is not set and no usable fallback was found. Checked: ${envPathCandidates.join(', ')}`,
    );
}

const parsed = new URL(directUrl);
assertValidDirectDatabaseUrl(parsed);

if (fs.existsSync(localClusterPath) && localHosts.has(parsed.hostname)) {
    parsed.port = process.env.SNAPGEN_LOCAL_DB_PORT || '55432';
}

process.stdout.write(parsed.toString());
