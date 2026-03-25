import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function resolveDatabaseUrl() {
  const env = { ...process.env };
  if (!env.DATABASE_URL?.trim()) {
    delete env.DATABASE_URL;
  }

  const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/resolve-database-url.mjs')], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || 'Failed to resolve DATABASE_URL\n');
    process.exit(result.status || 1);
  }

  const resolvedUrl = result.stdout.trim();
  if (!resolvedUrl) {
    process.stderr.write('Resolved DATABASE_URL is empty\n');
    process.exit(1);
  }

  return resolvedUrl;
}

const command = process.argv[2];
const args = process.argv.slice(3);

if (!command) {
  process.stderr.write('Usage: node scripts/with-database-url.mjs <command> [args...]\n');
  process.exit(1);
}

const child = spawn(command, args, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DATABASE_URL: resolveDatabaseUrl(),
  },
  stdio: 'inherit',
  shell: false,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

child.on('error', (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
