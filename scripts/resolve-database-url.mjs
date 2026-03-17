import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);

if (process.env.DATABASE_URL) {
    process.stdout.write(process.env.DATABASE_URL);
    process.exit(0);
}

const envPathCandidates = [
    path.join(repoRoot, '.env'),
    path.join(repoRoot, 'apps/api/.env'),
];
const envPath = envPathCandidates.find((candidatePath) => fs.existsSync(candidatePath));

if (!envPath) {
    throw new Error(
        `DATABASE_URL env file not found. Checked: ${envPathCandidates.join(', ')}`,
    );
}

const envContents = fs.readFileSync(envPath, 'utf8');
const databaseUrlLine = envContents
    .split(/\r?\n/)
    .find((line) => line.startsWith('DATABASE_URL='));

if (!databaseUrlLine) {
    throw new Error(`DATABASE_URL not found in ${envPath}`);
}

const databaseUrl = databaseUrlLine.slice('DATABASE_URL='.length);
if (!databaseUrl.trim()) {
    throw new Error(`DATABASE_URL is empty in ${envPath}`);
}
const parsed = new URL(databaseUrl);
const localClusterPath = path.join(repoRoot, '.local/postgres/PG_VERSION');

if (fs.existsSync(localClusterPath) && localHosts.has(parsed.hostname)) {
    parsed.port = process.env.SNAPGEN_LOCAL_DB_PORT || '55432';
}

process.stdout.write(parsed.toString());
