import * as Sentry from '@sentry/node';

let initialized = false;

function getDefaultTraceSampleRate(): number {
  return process.env.NODE_ENV === 'production' ? 0.1 : 1;
}

function getTraceSampleRate(): number {
  const configuredValue = process.env.SENTRY_TRACES_SAMPLE_RATE?.trim();
  if (!configuredValue) {
    return getDefaultTraceSampleRate();
  }

  const parsed = Number(configuredValue);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return getDefaultTraceSampleRate();
  }

  return parsed;
}

function normalizeException(exception: unknown): Error {
  if (exception instanceof Error) {
    return exception;
  }

  if (typeof exception === 'string') {
    return new Error(exception);
  }

  return new Error('Non-Error exception captured');
}

export function initWorkerSentry(): void {
  if (initialized) {
    return;
  }

  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) {
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: getTraceSampleRate(),
    attachStacktrace: true,
  });

  Sentry.setTag('service', 'worker-media');
  Sentry.setTag('runtime', 'node');
  initialized = true;
}

export function captureWorkerException(
  exception: unknown,
  context?: Record<string, string | number | boolean | null>,
): void {
  if (!initialized) {
    return;
  }

  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context || {})) {
      scope.setExtra(key, value);
    }
    Sentry.captureException(normalizeException(exception));
  });
}

export async function flushWorkerSentry(timeoutMs = 2000): Promise<void> {
  if (!initialized) {
    return;
  }

  await Sentry.close(timeoutMs);
}
