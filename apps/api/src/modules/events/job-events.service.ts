import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { getRedisConnectionConfig } from '@snapgen/config';

export interface JobEvent {
  jobId: string;
  jobType: string;
  status: string;
  reservedCredits: number;
  finalCredits: number | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  outputs?: Array<{ id: string; url: string; mimeType: string }>;
}

@Injectable()
export class JobEventsService implements OnModuleDestroy {
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;
  private listeners = new Map<string, Set<(event: JobEvent) => void>>();
  private subscribedChannels = new Set<string>();

  private getPublisher(): Redis | null {
    if (this.publisher) return this.publisher;

    if (process.env.SNAPGEN_DISABLE_QUEUE === 'true') return null;

    try {
      const config = getRedisConnectionConfig(process.env.REDIS_URL);
      this.publisher = new Redis({
        host: config.host,
        port: config.port,
        db: config.db,
        username: config.username,
        password: config.password,
        tls: config.tls,
        maxRetriesPerRequest: null,
        lazyConnect: true,
      });

      this.publisher.on('error', (err) => {
        console.warn('[JobEventsService] Redis publisher error:', err.message);
      });

      void this.publisher.connect().catch(() => {
        // Connection will be retried on next publish
      });

      return this.publisher;
    } catch {
      return null;
    }
  }

  private async getSubscriber(): Promise<Redis | null> {
    if (this.subscriber) {
      return this.subscriber;
    }

    if (process.env.SNAPGEN_DISABLE_QUEUE === 'true') {
      return null;
    }

    try {
      const config = getRedisConnectionConfig(process.env.REDIS_URL);
      this.subscriber = new Redis({
        host: config.host,
        port: config.port,
        db: config.db,
        username: config.username,
        password: config.password,
        tls: config.tls,
        maxRetriesPerRequest: null,
        lazyConnect: true,
      });

      this.subscriber.on('error', (err) => {
        console.warn('[JobEventsService] Redis subscriber error:', err.message);
      });

      this.subscriber.on('message', (channel, message) => {
        const listeners = this.listeners.get(channel);
        if (!listeners?.size) {
          return;
        }

        try {
          const event = JSON.parse(message) as JobEvent;
          for (const listener of listeners) {
            listener(event);
          }
        } catch {
          // Ignore malformed messages from Redis.
        }
      });

      await this.subscriber.connect();
      return this.subscriber;
    } catch (error) {
      console.warn('[JobEventsService] Failed to initialize Redis subscriber:', error);
      this.subscriber = null;
      return null;
    }
  }

  async publishJobEvent(userId: string, event: JobEvent): Promise<void> {
    const pub = this.getPublisher();
    if (!pub) return;

    try {
      const channel = `job-events:user:${userId}`;
      await pub.publish(channel, JSON.stringify(event));
    } catch (error) {
      console.warn('[JobEventsService] Failed to publish job event:', error);
    }
  }

  async subscribeToUserEvents(
    userId: string,
    listener: (event: JobEvent) => void,
  ): Promise<() => Promise<void>> {
    const channel = `job-events:user:${userId}`;
    const listeners = this.listeners.get(channel) ?? new Set<(event: JobEvent) => void>();
    listeners.add(listener);
    this.listeners.set(channel, listeners);

    const subscriber = await this.getSubscriber();
    if (subscriber && !this.subscribedChannels.has(channel)) {
      await subscriber.subscribe(channel);
      this.subscribedChannels.add(channel);
    }

    return async () => {
      const currentListeners = this.listeners.get(channel);
      if (!currentListeners) {
        return;
      }

      currentListeners.delete(listener);
      if (currentListeners.size > 0) {
        return;
      }

      this.listeners.delete(channel);
      if (this.subscriber && this.subscribedChannels.has(channel)) {
        await this.subscriber.unsubscribe(channel).catch(() => {});
        this.subscribedChannels.delete(channel);
      }
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.publisher) {
      await this.publisher.quit().catch(() => {});
      this.publisher = null;
    }

    if (this.subscriber) {
      for (const channel of this.subscribedChannels) {
        await this.subscriber.unsubscribe(channel).catch(() => {});
      }
      await this.subscriber.quit().catch(() => {});
      this.subscriber = null;
      this.subscribedChannels.clear();
    }

    this.listeners.clear();
  }
}
