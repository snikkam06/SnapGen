import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { loadApiEnv } from '../env/load-env';

loadApiEnv();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  readonly reader: PrismaClient;

  private static readonly SERIALIZABLE_RETRY_LIMIT = (() => {
    const parsed = Number.parseInt(process.env.SNAPGEN_DB_SERIALIZABLE_RETRY_LIMIT || '5', 10);
    if (!Number.isFinite(parsed) || parsed < 1) return 5;
    return parsed;
  })();
  private static readonly TRANSACTION_MAX_WAIT_MS = (() => {
    const parsed = Number.parseInt(process.env.SNAPGEN_DB_TRANSACTION_MAX_WAIT_MS || '30000', 10);
    if (!Number.isFinite(parsed) || parsed < 1000) return 30000;
    return parsed;
  })();
  private static readonly TRANSACTION_TIMEOUT_MS = (() => {
    const parsed = Number.parseInt(process.env.SNAPGEN_DB_TRANSACTION_TIMEOUT_MS || '30000', 10);
    if (!Number.isFinite(parsed) || parsed < 1000) return 30000;
    return parsed;
  })();

  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
    // Fall back to primary if no read replica configured
    this.reader = process.env.DATABASE_READ_URL
      ? new PrismaClient({ datasourceUrl: process.env.DATABASE_READ_URL })
      : this;
  }

  async onModuleInit() {
    await this.$connect();
    if (this.reader !== this) await this.reader.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    if (this.reader !== this) await this.reader.$disconnect();
  }

  async withSerializableTransaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
    maxRetries = PrismaService.SERIALIZABLE_RETRY_LIMIT,
  ): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        return await this.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: PrismaService.TRANSACTION_MAX_WAIT_MS,
          timeout: PrismaService.TRANSACTION_TIMEOUT_MS,
        });
      } catch (error) {
        const isRetryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' || error.code === 'P2028') &&
          attempt < maxRetries;

        if (!isRetryable) {
          throw error;
        }

        // Exponential backoff with jitter
        const baseDelay = Math.min(100 * Math.pow(2, attempt - 1), 2000);
        const jitter = Math.floor(Math.random() * baseDelay * 0.5);
        await delay(baseDelay + jitter);
      }
    }

    throw new Error('Unreachable transaction retry state');
  }
}
