import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const children = [];
let shuttingDown = false;

async function findAvailablePort(startPort) {
  let candidatePort = startPort;

  while (candidatePort < startPort + 100) {
    const available = await new Promise((resolve) => {
      const server = net.createServer();
      server.unref();
      server.once('error', () => resolve(false));
      server.listen(candidatePort, () => {
        server.close(() => resolve(true));
      });
    });

    if (available) {
      return candidatePort;
    }

    candidatePort += 1;
  }

  throw new Error(`Unable to find an open port starting from ${startPort}`);
}

const requestedPort = Number(process.env.PORT || '3001');
const resolvedPort = process.env.PORT ? requestedPort : await findAvailablePort(requestedPort);
const port = String(resolvedPort);
const apiBaseUrl = process.env.API_URL || `http://127.0.0.1:${port}`;

function startProcess(name, file) {
  const child = spawn('node', [file], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: port,
      API_URL: apiBaseUrl,
      API_PUBLIC_URL: process.env.API_PUBLIC_URL || apiBaseUrl,
      APP_URL: process.env.APP_URL || 'http://127.0.0.1:3000',
    },
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    if (code !== 0) {
      console.error(`[smoke] ${name} exited unexpectedly with code ${code ?? 'null'}${signal ? ` (signal ${signal})` : ''}`);
      process.exit(code ?? 1);
    }
  });

  children.push(child);
  return child;
}

async function cleanup() {
  shuttingDown = true;
  await Promise.allSettled(
    children.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null) {
            resolve();
            return;
          }

          child.once('exit', () => resolve());
          child.kill('SIGTERM');
        }),
    ),
  );
}

process.on('SIGINT', async () => {
  await cleanup();
  process.exit(130);
});

process.on('SIGTERM', async () => {
  await cleanup();
  process.exit(143);
});

async function waitForHealthyApi(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'service unavailable';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/health`);
      const body = await response.json().catch(() => ({}));
      if (response.ok && body?.status === 'ok') {
        return;
      }

      lastStatus = `${response.status} ${JSON.stringify(body)}`;
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : 'request failed';
    }

    await delay(1000);
  }

  throw new Error(`Timed out waiting for /api/health: ${lastStatus}`);
}

try {
  startProcess('api', path.join('apps', 'api', 'dist', 'main.js'));
  await delay(2000);
  startProcess('worker', path.join('apps', 'worker-media', 'dist', 'index.js'));
  await waitForHealthyApi();
  console.log('[smoke] /api/health returned ok');
} finally {
  await cleanup();
}
