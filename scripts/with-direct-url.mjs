import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function resolveEnvValue(scriptName, envName) {
  const env = { ...process.env };
  if (!env[envName]?.trim()) {
    delete env[envName];
  }

  const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', scriptName)], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `Failed to resolve ${envName}\n`);
    process.exit(result.status || 1);
  }

  const resolvedValue = result.stdout.trim();
  if (!resolvedValue) {
    process.stderr.write(`Resolved ${envName} is empty\n`);
    process.exit(1);
  }

  return resolvedValue;
}

const command = process.argv[2];
const args = process.argv.slice(3);

if (!command) {
  process.stderr.write('Usage: node scripts/with-direct-url.mjs <command> [args...]\n');
  process.exit(1);
}

const child = spawn(command, args, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DATABASE_URL: resolveEnvValue('resolve-database-url.mjs', 'DATABASE_URL'),
    DIRECT_URL: resolveEnvValue('resolve-direct-url.mjs', 'DIRECT_URL'),
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
