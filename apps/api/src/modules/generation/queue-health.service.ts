import { Injectable, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export interface QueueHealthStatus {
  available: boolean;
  queues: Record<string, { connected: boolean; workers: number }>;
}

@Injectable()
export class QueueHealthService {
  constructor(
    @Optional() @InjectQueue('image-generation') private imageQueue?: Queue,
    @Optional() @InjectQueue('video-generation') private videoQueue?: Queue,
    @Optional() @InjectQueue('faceswap-generation') private faceswapQueue?: Queue,
  ) {}

  async checkHealth(): Promise<QueueHealthStatus> {
    const results: Record<string, { connected: boolean; workers: number }> = {};

    for (const [name, queue] of Object.entries({
      'image-generation': this.imageQueue,
      'video-generation': this.videoQueue,
      'faceswap-generation': this.faceswapQueue,
    })) {
      if (!queue) {
        results[name] = { connected: false, workers: 0 };
        continue;
      }

      try {
        const workers = await queue.getWorkersCount();
        results[name] = { connected: workers > 0, workers };
      } catch {
        results[name] = { connected: false, workers: 0 };
      }
    }

    return {
      available: Object.values(results).some((r) => r.connected),
      queues: results,
    };
  }

  async isQueueHealthy(queueName: 'image' | 'video' | 'faceswap'): Promise<boolean> {
    const queueMap = {
      image: this.imageQueue,
      video: this.videoQueue,
      faceswap: this.faceswapQueue,
    };

    const queue = queueMap[queueName];
    if (!queue) return false;

    try {
      const workers = await queue.getWorkersCount();
      return workers > 0;
    } catch {
      return false;
    }
  }

  async requireHealthyQueue(queueName: 'image' | 'video' | 'faceswap'): Promise<void> {
    const healthy = await this.isQueueHealthy(queueName);
    if (!healthy) {
      throw new QueueUnavailableError(queueName);
    }
  }
}

export class QueueUnavailableError extends Error {
  constructor(queueName: string) {
    super(
      `Generation service temporarily unavailable: ${queueName} queue is not reachable. Please try again later.`,
    );
    this.name = 'QueueUnavailableError';
  }
}
