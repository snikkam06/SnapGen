import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(__filename);
const workerDir = path.resolve(scriptsDir, '..');
const repoRoot = path.resolve(workerDir, '../..');
const pnpmCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function parseArgs(argv) {
  const parsed = {
    mode: 'start',
    replicas: undefined,
    dryRun: false,
  };

  for (const arg of argv) {
    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }

    if (arg.startsWith('--mode=')) {
      parsed.mode = arg.slice('--mode='.length);
      continue;
    }

    if (arg.startsWith('--replicas=')) {
      parsed.replicas = Number.parseInt(arg.slice('--replicas='.length), 10);
      continue;
    }
  }

  return parsed;
}

function printHelp() {
  process.stdout.write(
    [
      'Usage: node scripts/start-multi.mjs [--mode=start|dev] [--replicas=N] [--dry-run]',
      '',
      'Environment:',
      '  WORKER_REPLICAS   Number of worker replicas to launch (default: 2)',
    ].join('\n'),
  );
}

function loadEnvFiles() {
  const candidatePaths = [
    path.join(repoRoot, '.env'),
    path.join(repoRoot, 'apps/api/.env'),
  ];

  for (const candidatePath of candidatePaths) {
    if (fs.existsSync(candidatePath)) {
      dotenv.config({ path: candidatePath, override: false });
    }
  }
}

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
    const errorOutput = (result.stderr || result.stdout || 'Unknown error').trim();
    throw new Error(`Failed to resolve DATABASE_URL: ${errorOutput}`);
  }

  const resolvedUrl = result.stdout.trim();
  if (!resolvedUrl) {
    throw new Error('Failed to resolve DATABASE_URL: script returned an empty value');
  }

  return resolvedUrl;
}

function getWorkerCommand(mode) {
  if (mode === 'dev') {
    return {
      command: pnpmCmd,
      args: ['exec', 'tsx', '--watch', 'src/index.ts'],
    };
  }

  return {
    command: process.execPath,
    args: ['dist/index.js'],
  };
}

function prefixStream(stream, target, label) {
  let buffer = '';

  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      target.write(`[${label}] ${line}\n`);
    }
  });

  stream.on('end', () => {
    if (buffer) {
      target.write(`[${label}] ${buffer}\n`);
      buffer = '';
    }
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.stdout.write('\n');
    return;
  }

  loadEnvFiles();
  if (options.replicas == null) {
    options.replicas = Number.parseInt(process.env.WORKER_REPLICAS || '2', 10);
  }

  if (!Number.isInteger(options.replicas) || options.replicas < 1) {
    throw new Error(`Invalid replica count: ${String(options.replicas)}`);
  }

  if (!['start', 'dev'].includes(options.mode)) {
    throw new Error(`Invalid mode: ${options.mode}`);
  }

  process.env.DATABASE_URL = resolveDatabaseUrl();

  const workerCommand = getWorkerCommand(options.mode);
  const commandPreview = `${workerCommand.command} ${workerCommand.args.join(' ')}`;

  process.stdout.write(
    [
      `Launching ${options.replicas} worker replica(s) in ${options.mode} mode`,
      `Command: ${commandPreview}`,
      `cwd: ${workerDir}`,
    ].join('\n') + '\n',
  );

  if (options.dryRun) {
    return;
  }

  const children = [];
  let shuttingDown = false;
  const SHUTDOWN_GRACE_MS = Number(process.env.WORKER_SHUTDOWN_GRACE_MS) || 10000;

  const stopChildren = async (exitCode) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    // Copy array to avoid modification during iteration
    const currentChildren = [...children];

    for (const child of currentChildren) {
      try {
        if (!child.killed) {
          child.kill('SIGTERM');
        }
      } catch {
        // Process may have already exited
      }
    }

    await delay(SHUTDOWN_GRACE_MS);

    for (const child of currentChildren) {
      try {
        if (child.exitCode === null && !child.killed) {
          process.stdout.write(`[multi-worker] Force killing child pid=${child.pid}\n`);
          child.kill('SIGKILL');
        }
      } catch {
        // Process may have already exited
      }
    }

    process.exit(exitCode);
  };

  process.on('SIGINT', () => {
    stopChildren(0).catch((err) => {
      process.stderr.write(`[multi-worker] Error during SIGINT shutdown: ${err.message}\n`);
      process.exit(1);
    });
  });

  process.on('SIGTERM', () => {
    stopChildren(0).catch((err) => {
      process.stderr.write(`[multi-worker] Error during SIGTERM shutdown: ${err.message}\n`);
      process.exit(1);
    });
  });

  for (let index = 0; index < options.replicas; index += 1) {
    const label = `worker-${index + 1}`;
    const child = spawn(workerCommand.command, workerCommand.args, {
      cwd: workerDir,
      env: {
        ...process.env,
        WORKER_INSTANCE_ID: String(index + 1),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    prefixStream(child.stdout, process.stdout, label);
    prefixStream(child.stderr, process.stderr, label);

    child.on('exit', (code, signal) => {
      const exitLabel = signal ? `signal ${signal}` : `code ${code ?? 0}`;
      process.stdout.write(`[${label}] exited with ${exitLabel}\n`);

      if (!shuttingDown) {
        const normalizedCode = typeof code === 'number' ? code : 1;
        stopChildren(normalizedCode).catch((err) => {
          process.stderr.write(`[multi-worker] Error during child exit shutdown: ${err.message}\n`);
          process.exit(1);
        });
      }
    });

    child.on('error', (error) => {
      process.stderr.write(`[${label}] failed to start: ${error.message}\n`);
      if (!shuttingDown) {
        stopChildren(1).catch((err) => {
          process.stderr.write(`[multi-worker] Error during error shutdown: ${err.message}\n`);
          process.exit(1);
        });
      }
    });

    children.push(child);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
