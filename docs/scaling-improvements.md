# Scaling Improvements

Current capacity with defaults: **~50 simultaneous job-submitting users** before wait times become noticeable. These changes, applied in order, push that to hundreds–thousands.

---

## 1. Dispatch / Resolve Split ⭐ Highest impact (5–20× throughput)

**The problem:** A worker slot is held for the entire job duration (15s for image, up to 10min for video). Only 6 image slots exist by default, so throughput is capped at ~24 images/min.

**The fix:** Split each job into two BullMQ jobs so the slot is freed while waiting on the AI provider.

```
Before: [submit → ██████ poll every 5s ██████ → save]  (slot held 15–600s)
After:  [submit → done]  ...wait...  [poll → done]  (slot held ~2s each)
```

### Step 1 — Add new queue names to the worker module

**`apps/api/src/modules/job/job.module.ts`**

Register two additional BullMQ queues — one for polling callbacks:

```ts
BullModule.registerQueue(
  { name: 'image-generation' },
  { name: 'video-generation' },
  { name: 'faceswap-generation' },
  { name: 'image-poll' },      // ADD
  { name: 'video-poll' },      // ADD
  { name: 'faceswap-poll' },   // ADD
),
```

Inject them in `GenerationService`:

```ts
@Optional() @InjectQueue('image-poll') private imagePollQueue?: Queue,
@Optional() @InjectQueue('video-poll') private videoPollQueue?: Queue,
@Optional() @InjectQueue('faceswap-poll') private faceswapPollQueue?: Queue,
```

### Step 2 — Split the worker processor

**`apps/worker-media/src/index.ts`**

Replace the monolithic job handler with two handlers per queue type.

**Dispatch handler** (submits to provider, schedules a poll job):

```ts
const imageDispatchWorker = new Worker(
  'image-generation',
  async (job: Job) => {
    const { jobId } = job.data;
    const genJob = await claimQueuedJob(jobId, 'image');
    if (!genJob) return;

    const adapter = createImageAdapter(genJob.provider, getImageProviderApiKey(genJob.provider));
    const result = await adapter.createJob({ ...buildImageInput(genJob) });

    // Store the external ID so the poll worker knows what to check
    await prisma.generationJob.update({
      where: { id: jobId },
      data: { externalJobId: result.externalJobId },
    });

    if (result.status === 'completed') {
      // Provider returned immediately — handle inline
      await finalizeImageJob(jobId, genJob, result);
      return;
    }

    // Schedule the poll job — slot is now FREE
    await imagePollQueue.add(
      'poll-image',
      { jobId, externalJobId: result.externalJobId, attempts: 0 },
      { delay: 5000, removeOnComplete: 10, removeOnFail: 50 },
    );
  },
  { connection, concurrency: IMAGE_CONCURRENCY },
);

// Poll handler — lightweight, checks status and reschedules if not done
const imagePollWorker = new Worker(
  'image-poll',
  async (job: Job) => {
    const { jobId, externalJobId, attempts } = job.data;
    const MAX_ATTEMPTS = 60; // 60 × 5s = 5 min max

    const genJob = await prisma.generationJob.findUnique({ where: { id: jobId } });
    if (!genJob || genJob.status !== 'running') return; // already handled

    const adapter = createImageAdapter(genJob.provider, getImageProviderApiKey(genJob.provider));
    const result = await adapter.getJob(externalJobId);

    if (result.status === 'completed') {
      await finalizeImageJob(jobId, genJob, result);
      return;
    }

    if (result.status === 'failed' || attempts >= MAX_ATTEMPTS) {
      await failJob(jobId, result.errorMessage ?? 'Job timed out');
      return;
    }

    // Reschedule — slot freed between polls
    await imagePollQueue.add(
      'poll-image',
      { jobId, externalJobId, attempts: attempts + 1 },
      { delay: 5000, removeOnComplete: 10, removeOnFail: 50 },
    );
  },
  { connection, concurrency: 20 }, // poll workers are cheap — run many
);
```

Extract `finalizeImageJob` from the existing job completion logic (save assets, update DB, publish event).

Repeat the same pattern for `video-generation` and `faceswap-generation`.

### Step 3 — Optional: use provider webhooks instead of polling

FAL and Replicate support webhooks. If configured, the provider calls your API when done — no polling loop needed at all.

Add a webhook endpoint in the API:

```ts
// apps/api/src/modules/generation/generation.controller.ts
@Post('webhook/fal')
async falWebhook(@Body() body: FalWebhookPayload, @Headers('x-fal-signature') sig: string) {
  await this.generationService.handleFalWebhook(body, sig);
}
```

In the dispatch handler, pass your webhook URL:

```ts
const result = await adapter.createJob({
  ...input,
  webhookUrl: `${process.env.API_PUBLIC_URL}/api/v1/generation/webhook/fal`,
});
```

---

## 2. Per-User Job Fairness (1 day)

**The problem:** One user can submit 100 jobs and starve everyone else in the queue.

### Step 1 — Add a pending job cap per user

**`apps/api/src/modules/generation/generation.service.ts`**

Add this check before creating any job (inside `createImageJob`, `createVideoJob`, `createFaceSwapImageJob`):

```ts
private async assertPendingJobLimit(userId: string): Promise<void> {
  const MAX_PENDING = Number(process.env.MAX_PENDING_JOBS_PER_USER) || 5;
  const count = await this.prisma.generationJob.count({
    where: { userId, status: { in: ['queued', 'running'] } },
  });
  if (count >= MAX_PENDING) {
    throw new BadRequestException(
      `You have ${count} pending jobs. Wait for some to finish before submitting more.`,
    );
  }
}
```

Call it at the top of each create method:

```ts
async createImageJob(clerkUserId: string, data: ...) {
  const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
  if (!user) throw new NotFoundException('User not found');
  await this.assertPendingJobLimit(user.id); // ADD THIS
  // ... rest of method
}
```

### Step 2 — Add environment variable to `.env.example`

```
MAX_PENDING_JOBS_PER_USER=5
```

---

## 3. PgBouncer Transaction Mode (1 hour)

**The problem:** Each Prisma `PrismaClient` holds a pool of connections directly to PostgreSQL. PostgreSQL has a hard `max_connections` limit (25–100 depending on Supabase plan). With multiple API instances + worker replicas, you can exhaust it.

**The fix:** Use Supabase's built-in PgBouncer pooler URL in transaction mode. It multiplexes many client connections onto far fewer PostgreSQL connections.

### Step 1 — Use the correct Supabase URLs

In `apps/api/.env` and your production environment:

```bash
# Transaction-mode pooler (port 6543) — use for all runtime queries
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres

# Direct connection (port 5432) — use ONLY for migrations
DIRECT_URL=postgresql://postgres.[ref]:[password]@db.[ref].supabase.co:5432/postgres
```

> **Important:** Never use the direct URL for runtime queries. Never use the pooler URL for `prisma migrate`.

### Step 2 — Verify `schema.prisma` uses both URLs

**`packages/db/prisma/schema.prisma`**

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

This is already correct if `DIRECT_URL` is set. Prisma automatically uses `DIRECT_URL` for migrations and `DATABASE_URL` for queries.

### Step 3 — Lower per-process pool sizes now that PgBouncer handles multiplexing

With PgBouncer in transaction mode, each client connection is not a real PostgreSQL connection. You can safely use smaller client-side pools:

```bash
# API: 10 is plenty with PgBouncer
SNAPGEN_DB_CONNECTION_LIMIT=10

# Workers: keep auto-sizing (concurrency + 3), which is already correct
```

---

## 4. Provider-Aware Concurrency Limits (4 hours)

**The problem:** `IMAGE_WORKER_CONCURRENCY=3` applies to all providers equally, but FAL allows 20 concurrent while Replicate allows 5. You're either under-utilizing or over-loading the provider.

### Step 1 — Add a per-provider semaphore in the worker

**`apps/worker-media/src/index.ts`**

Install a semaphore library or implement a simple one:

```ts
class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }
}

const providerSemaphores: Record<string, Semaphore> = {
  fal: new Semaphore(Number(process.env.FAL_CONCURRENCY_LIMIT) || 10),
  replicate: new Semaphore(Number(process.env.REPLICATE_CONCURRENCY_LIMIT) || 5),
  google: new Semaphore(Number(process.env.GOOGLE_CONCURRENCY_LIMIT) || 5),
  mock: new Semaphore(100),
};

function getProviderSemaphore(provider: string): Semaphore {
  return providerSemaphores[provider] ?? new Semaphore(5);
}
```

### Step 2 — Wrap each adapter call with the semaphore

In the image job processor:

```ts
const sem = getProviderSemaphore(genJob.provider);
await sem.acquire();
try {
  const result = await adapter.createJob({ ... });
  // ...
} finally {
  sem.release();
}
```

### Step 3 — Add env vars to `.env.example`

```bash
FAL_CONCURRENCY_LIMIT=10
REPLICATE_CONCURRENCY_LIMIT=5
GOOGLE_CONCURRENCY_LIMIT=5
```

---

## 5. Read Replica for the API (2 hours)

**The problem:** All DB queries (including read-heavy gallery, job list, asset queries) hit the primary, consuming connections needed for writes and transactions.

### Step 1 — Enable a read replica in Supabase

In the Supabase dashboard: **Project Settings → Database → Read Replicas → Add replica**.

Supabase provides a separate connection string for the replica.

### Step 2 — Add the read replica URL to your environment

```bash
DATABASE_READ_URL=postgresql://postgres.[ref]:[password]@aws-0-[region]-read.pooler.supabase.com:6543/postgres
```

### Step 3 — Add a read-only Prisma client to PrismaService

**`apps/api/src/prisma/prisma.service.ts`**

```ts
import { loadApiEnv } from '../env/load-env';
loadApiEnv();

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  readonly reader: PrismaClient;

  constructor() {
    super({ log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'] });
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
  // ... withSerializableTransaction unchanged
}
```

### Step 4 — Use `prisma.reader` for read-only queries

In services, swap list/find queries to use the reader:

```ts
// Before
const jobs = await this.prisma.generationJob.findMany({ where: { userId } });

// After — read replica, frees primary pool
const jobs = await this.prisma.reader.generationJob.findMany({ where: { userId } });
```

Use `this.prisma` (primary) only for: creates, updates, deletes, and transactions.

---

## Summary

| Change | Effort | Throughput gain | Do first? |
|--------|--------|-----------------|-----------|
| Dispatch/resolve split | 2 days | 5–20× | ✅ Yes |
| Per-user job cap | 2 hours | stability | ✅ Yes |
| PgBouncer transaction mode | 1 hour | 2–3× DB headroom | ✅ Yes |
| Provider-aware concurrency | 4 hours | 1.5–2× | After split |
| Read replica | 2 hours | frees primary pool | After split |

### Connection budget after all changes

| Process | Before | After |
|---------|--------|-------|
| API (1 instance) | 15 | 10 |
| Worker replica (each) | 10 (auto) | 7 (auto) |
| 2 replicas total | 20 | 14 |
| **Grand total** | **35** | **24** |

With PgBouncer, these are *pooler client connections*, not PostgreSQL connections. The actual PostgreSQL connection count stays at 5–10 regardless of how many clients connect.
