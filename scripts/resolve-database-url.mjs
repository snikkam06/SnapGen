import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
const defaultDbPoolTimeoutSec = process.env.SNAPGEN_DB_POOL_TIMEOUT_SEC || '30';

function isSupabasePoolerHost(hostname) {
    return hostname.endsWith('.pooler.supabase.com');
}

function isSupabaseDirectHost(hostname) {
    return hostname.startsWith('db.') && hostname.endsWith('.supabase.co');
}

function isSupabaseTransactionPoolerUrl(parsed) {
    return isSupabasePoolerHost(parsed.hostname) && parsed.port === '6543';
}

function assertValidRuntimeDatabaseUrl(parsed) {
    if (isSupabaseDirectHost(parsed.hostname)) {
        throw new Error(
            `DATABASE_URL points to the direct Supabase host (${parsed.hostname}). Use the transaction pooler host on port 6543 for runtime queries.`,
        );
    }

    if (isSupabasePoolerHost(parsed.hostname) && parsed.port !== '6543') {
        throw new Error(
            `DATABASE_URL points to the Supabase pooler on port ${parsed.port || '(default)'}. Use port 6543 for transaction mode runtime queries.`,
        );
    }
}

const envPathCandidates = [
    path.join(repoRoot, '.env'),
    path.join(repoRoot, 'apps/api/.env'),
];
const databaseUrlFromEnv = process.env.DATABASE_URL?.trim();
const envPath = envPathCandidates.find((candidatePath) => fs.existsSync(candidatePath));

if (!databaseUrlFromEnv && !envPath) {
    throw new Error(
        `DATABASE_URL is not set and no env file was found. Checked: ${envPathCandidates.join(', ')}`,
    );
}

const databaseUrl = databaseUrlFromEnv
    || (() => {
        const envContents = fs.readFileSync(envPath, 'utf8');
        const databaseUrlLine = envContents
            .split(/\r?\n/)
            .find((line) => line.startsWith('DATABASE_URL='));

        if (!databaseUrlLine) {
            throw new Error(`DATABASE_URL not found in ${envPath}`);
        }

        return databaseUrlLine.slice('DATABASE_URL='.length).trim();
    })();

if (!databaseUrl) {
    if (envPath) {
        throw new Error(`DATABASE_URL is empty in ${envPath}`);
    }

    throw new Error('DATABASE_URL is empty');
}
const parsed = new URL(databaseUrl);
assertValidRuntimeDatabaseUrl(parsed);
const localClusterPath = path.join(repoRoot, '.local/postgres/PG_VERSION');

if (fs.existsSync(localClusterPath) && localHosts.has(parsed.hostname)) {
    parsed.port = process.env.SNAPGEN_LOCAL_DB_PORT || '55432';
}

if (isSupabaseTransactionPoolerUrl(parsed)) {
    parsed.searchParams.set('pgbouncer', 'true');
}

if (!parsed.searchParams.has('connection_limit')) {
    const defaultDbConnectionLimit = process.env.SNAPGEN_DB_CONNECTION_LIMIT
        || (parsed.hostname.endsWith('.pooler.supabase.com') && parsed.port === '6543' ? '10' : '2');
    parsed.searchParams.set('connection_limit', defaultDbConnectionLimit);
}

if (!parsed.searchParams.has('pool_timeout')) {
    parsed.searchParams.set('pool_timeout', defaultDbPoolTimeoutSec);
}

process.stdout.write(parsed.toString());
