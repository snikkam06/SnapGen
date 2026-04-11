import { Injectable } from '@nestjs/common';
import { isProductionRuntime } from '@snapgen/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueHealthService } from '../generation/queue-health.service';
import { StorageService } from '../storage/storage.service';

type ServiceCheck = {
  healthy: boolean;
  detail: string;
};

@Injectable()
export class HealthService {
  constructor(
    private prisma: PrismaService,
    private queueHealth: QueueHealthService,
    private storageService: StorageService,
  ) {}

  async getReport(): Promise<{
    status: 'ok' | 'error';
    timestamp: string;
    uptimeSec: number;
    environment: string;
    services: {
      database: ServiceCheck;
      queue: ServiceCheck & {
        mode: 'queue' | 'inline';
        queues: Record<string, { connected: boolean; workers: number }>;
      };
      storage: ServiceCheck & {
        mode: 'local' | 'r2';
        bucket: string | null;
      };
    };
  }> {
    const [database, queue, storage] = await Promise.all([
      this.checkDatabase(),
      this.checkQueue(),
      this.storageService.checkHealth(),
    ]);

    const status =
      database.healthy && queue.healthy && storage.healthy ? 'ok' : 'error';

    return {
      status,
      timestamp: new Date().toISOString(),
      uptimeSec: Math.floor(process.uptime()),
      environment: process.env.NODE_ENV || 'development',
      services: {
        database,
        queue,
        storage,
      },
    };
  }

  private async checkDatabase(): Promise<ServiceCheck> {
    try {
      await this.prisma.$queryRaw(Prisma.sql`SELECT 1`);
      return { healthy: true, detail: 'Database reachable' };
    } catch (error) {
      return {
        healthy: false,
        detail: error instanceof Error ? error.message : 'Database check failed',
      };
    }
  }

  private async checkQueue(): Promise<
    ServiceCheck & {
      mode: 'queue' | 'inline';
      queues: Record<string, { connected: boolean; workers: number }>;
    }
  > {
    const queueStatus = await this.queueHealth.checkHealth();
    const inlineMode =
      process.env.SNAPGEN_DISABLE_QUEUE === 'true'
      || process.env.SNAPGEN_INLINE_PROCESSING === 'true';

    if (inlineMode) {
      return {
        healthy: !isProductionRuntime(),
        detail: isProductionRuntime()
          ? 'Inline processing fallback is active in production'
          : 'Inline processing fallback is active for development',
        mode: 'inline',
        queues: queueStatus.queues,
      };
    }

    return {
      healthy: queueStatus.available,
      detail: queueStatus.available
        ? 'At least one queue worker is connected'
        : 'No generation workers are connected',
      mode: 'queue',
      queues: queueStatus.queues,
    };
  }
}
