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
  private publisherReady: Promise<boolean> | null = null;
  private subscriber: Redis | null = null;
  private listeners = new Map<string, Set<(event: JobEvent) => void>>();
  private subscribedChannels = new Set<string>();

  private emitToLocalListeners(channel: string, event: JobEvent): void {
    const listeners = this.listeners.get(channel);
    if (!listeners?.size) {
      return;
    }

    for (const listener of listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[JobEventsService] Listener callback error:', err);
      }
    }
  }

  private async resetPublisher(): Promise<void> {
    const publisher = this.publisher;
    this.publisher = null;
    this.publisherReady = null;

    if (!publisher) {
      return;
    }

    await publisher.quit().catch(() => {
      publisher.disconnect();
    });
  }

  private getPublisher(): Redis | null {
    if (this.publisher) return this.publisher;

    if (process.env.SNAPGEN_DISABLE_QUEUE === 'true') return null;

    try {
      const config = getRedisConnectionConfig(process.env.REDIS_URL);
      this.publisher = new Redis({
        ...config,
        maxRetriesPerRequest: null,
        lazyConnect: true,
      });

      this.publisher.on('error', (err) => {
        console.warn('[JobEventsService] Redis publisher error:', err.message);
      });

      this.publisherReady = this.publisher.connect()
        .then(() => true)
        .catch(async (err) => {
          console.error('[JobEventsService] Redis publisher connection failed:', err.message);
          await this.resetPublisher();
          return false;
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
            try {
              listener(event);
            } catch (err) {
              console.error('[JobEventsService] Listener callback error:', err);
            }
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
    const channel = `job-events:user:${userId}`;
    const pub = this.getPublisher();
    if (!pub) {
      this.emitToLocalListeners(channel, event);
      return;
    }

    try {
      if (this.publisherReady) {
        const connected = await this.publisherReady;
        if (!connected) {
          this.emitToLocalListeners(channel, event);
          return;
        }
      }
      await pub.publish(channel, JSON.stringify(event));
    } catch (error) {
      console.warn('[JobEventsService] Failed to publish job event:', error);
      this.emitToLocalListeners(channel, event);
      await this.resetPublisher();
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
      try {
        await subscriber.subscribe(channel);
        this.subscribedChannels.add(channel);
      } catch {
        console.warn(`[JobEventsService] Failed to subscribe to channel ${channel}`);
      }
    }

    return async () => {
      const currentListeners = this.listeners.get(channel);
      if (!currentListeners) {
        return;
      }

      currentListeners.delete(listener);

      if (currentListeners.size === 0) {
        this.listeners.delete(channel);
        if (this.subscriber && this.subscribedChannels.has(channel)) {
          await this.subscriber.unsubscribe(channel).catch(() => {});
          this.subscribedChannels.delete(channel);
        }
      }
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.resetPublisher();

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
