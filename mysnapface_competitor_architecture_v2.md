# MySnapFace Competitor — Production-Ready Build Plan (Opinionated V2)

This is a **more opinionated continuation** of the first architecture document. It turns the high-level design into a concrete production plan you can hand to an engineer or use to scaffold the app.

## What was publicly observable from the reference site

From the public MySnapFace pages, the product currently exposes:

- a login page with **Google sign-in** and **email/password** login,
- a **signup** flow,
- a **forgot password** flow,
- messaging around building and scaling AI influencers.

Public references:
- Login page: https://app.mysnapface.com/
- Signup page: https://app.mysnapface.com/signup
- Forgot password page: https://app.mysnapface.com/forgotPassword

---

# 1. Exact stack to use

## Frontend
- **Next.js 15**
- **TypeScript**
- **Tailwind CSS**
- **shadcn/ui**
- **TanStack Query**
- **React Hook Form**
- **Zod**
- **next-intl** if you want i18n later

## Backend
- **NestJS**
- **REST API with OpenAPI/Swagger**
- **Prisma** ORM
- **class-validator** only where needed, but prefer **Zod** at API edges if your team is comfortable with it

## Auth
- **Clerk**
- Providers enabled:
  - Email/password
  - Google
  - Apple
  - GitHub
  - Discord

## Database / infra
- **PostgreSQL**
- **Redis**
- **Cloudflare R2** for object storage
- **BullMQ** for queues
- **Stripe** for billing
- **Resend** for transactional email not already handled by Clerk
- **Sentry** for errors
- **PostHog** for analytics

## Deployment
- **Vercel** for web
- **Railway / Render / Fly.io** for API and workers
- **Neon** or **AWS RDS** for Postgres
- **Upstash Redis** or managed Redis

## AI execution layer
Start with a provider abstraction over:
- **Fal** or **Replicate** for image generation
- an external **image-to-video/video model provider**
- a provider or internal service for **face swap**
- a provider or internal service for **upscaling**
- a dedicated training worker for **LoRA/fine-tune jobs** later

---

# 2. Production architecture

```text
[Client Browser]
    |
    v
[Next.js Web App on Vercel]
    |
    +--> [Clerk]
    |
    +--> [NestJS API]
              |
              +--> [Postgres]
              +--> [Redis / BullMQ]
              +--> [Cloudflare R2]
              +--> [Stripe]
              +--> [Resend]
              +--> [AI Provider Adapter Layer]
                              |
                              +--> image provider
                              +--> video provider
                              +--> face swap provider
                              +--> upscale provider
                              +--> training workers
```

## Architectural rule set
- Web app handles presentation and light orchestration only.
- API is the source of truth for business logic.
- Heavy jobs are always async.
- Files upload directly to object storage through signed URLs.
- Billing checks happen before queueing work.
- A credit ledger records every debit/refund.
- AI providers are hidden behind adapters so you can swap vendors later.

---

# 3. Recommended repo structure

```text
/apps
  /web
  /api
  /worker-media
  /worker-training
/packages
  /db
  /ui
  /config
  /auth
  /billing
  /media-adapters
  /types
  /observability
```

## Suggested tooling
- **pnpm**
- **Turborepo**
- **Prisma**
- **ESLint**
- **Prettier**
- **Vitest**
- **Playwright**
- **Changesets** if you want versioned packages

---

# 4. Core product modules

## Public-facing
- Landing page
- Pricing page
- FAQ / trust / safety page
- Terms / privacy / consent language

## Auth + onboarding
- Email signup/login
- OAuth signup/login
- Verify email
- Forgot password / reset password
- Onboarding wizard

## App
- Dashboard
- Character library
- Character training
- Image generation
- Video generation
- Face swap
- Upscaling
- Output gallery
- Billing and credit history
- Account settings
- Linked OAuth providers

## Admin
- User search
- Credit adjustments
- Job inspection
- Failed job retries
- Moderation review
- Asset deletion / takedown

---

# 5. Database schema

Below is the concrete schema direction. Use UUID primary keys.

## users
```sql
id uuid pk
clerk_user_id text unique not null
email text unique not null
email_verified_at timestamptz null
full_name text null
avatar_url text null
role text not null default 'user'
status text not null default 'active'
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

## oauth_accounts
```sql
id uuid pk
user_id uuid fk -> users.id
provider text not null
provider_account_id text not null
created_at timestamptz not null default now()
unique(provider, provider_account_id)
```

## subscriptions
```sql
id uuid pk
user_id uuid fk -> users.id unique
stripe_customer_id text unique not null
stripe_subscription_id text unique null
plan_code text not null default 'free'
status text not null default 'inactive'
current_period_end timestamptz null
cancel_at_period_end boolean not null default false
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

## credit_ledgers
```sql
id uuid pk
user_id uuid fk -> users.id
amount integer not null
entry_type text not null
reason text not null
reference_type text null
reference_id uuid null
created_at timestamptz not null default now()
```

## plans
```sql
id uuid pk
code text unique not null
name text not null
monthly_price_cents integer not null
monthly_credits integer not null
is_active boolean not null default true
features_json jsonb not null default '{}'
created_at timestamptz not null default now()
```

## characters
```sql
id uuid pk
user_id uuid fk -> users.id
name text not null
slug text not null
character_type text not null
status text not null default 'draft'
cover_asset_id uuid null
latest_model_id uuid null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
unique(user_id, slug)
```

## character_datasets
```sql
id uuid pk
character_id uuid fk -> characters.id
status text not null default 'uploaded'
image_count integer not null default 0
quality_score numeric(5,2) null
validation_report jsonb not null default '{}'
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

## character_models
```sql
id uuid pk
character_id uuid fk -> characters.id
provider text not null
external_model_id text null
model_type text not null
version_tag text not null
status text not null default 'queued'
metadata_json jsonb not null default '{}'
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

## style_packs
```sql
id uuid pk
name text not null
slug text unique not null
description text null
thumbnail_asset_id uuid null
base_cost integer not null default 0
config_json jsonb not null default '{}'
is_active boolean not null default true
created_at timestamptz not null default now()
```

## assets
```sql
id uuid pk
user_id uuid fk -> users.id
kind text not null
storage_bucket text not null
storage_key text not null
mime_type text not null
file_size_bytes bigint not null
width integer null
height integer null
duration_sec numeric(10,2) null
checksum text null
moderation_status text not null default 'pending'
metadata_json jsonb not null default '{}'
created_at timestamptz not null default now()
```

## generation_jobs
```sql
id uuid pk
user_id uuid fk -> users.id
character_id uuid null fk -> characters.id
style_pack_id uuid null fk -> style_packs.id
job_type text not null
status text not null default 'queued'
prompt text null
negative_prompt text null
settings_json jsonb not null default '{}'
provider text not null
external_job_id text null
reserved_credits integer not null default 0
final_credits integer null
error_message text null
started_at timestamptz null
completed_at timestamptz null
failed_at timestamptz null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

## job_assets
```sql
id uuid pk
job_id uuid fk -> generation_jobs.id
asset_id uuid fk -> assets.id
relation text not null
created_at timestamptz not null default now()
```

## webhooks
```sql
id uuid pk
source text not null
external_id text null
payload_json jsonb not null
processed_at timestamptz null
status text not null default 'received'
created_at timestamptz not null default now()
```

## audit_logs
```sql
id uuid pk
actor_user_id uuid null fk -> users.id
action text not null
target_type text not null
target_id uuid null
metadata_json jsonb not null default '{}'
created_at timestamptz not null default now()
```

---

# 6. Credit model

## Why a ledger
Never store only `balance`.

Instead:
- calculate balance as the sum of ledger entries,
- optionally cache the computed balance for fast reads,
- preserve a fully auditable trail.

## Example entry types
- `monthly_grant`
- `topup_purchase`
- `job_reservation`
- `job_finalization`
- `job_refund`
- `manual_adjustment`
- `promo_grant`

## Reservation flow
1. User requests job.
2. API calculates estimated cost.
3. API verifies available balance.
4. API writes a negative reservation ledger entry.
5. Job is queued.
6. On completion, API converts reservation to final cost or issues refund delta.

---

# 7. Auth implementation details

## Clerk setup
Enable:
- Email + password
- Email verification
- Password reset
- Google OAuth
- Apple OAuth
- GitHub OAuth
- Discord OAuth

## App-side sync flow
When a user signs in for the first time:
1. Frontend obtains Clerk session.
2. Frontend calls `POST /v1/auth/sync`.
3. API validates Clerk JWT.
4. API upserts user row.
5. API ensures a `subscriptions` row exists.
6. API optionally grants starter credits.

## Account linking
Create a settings page where users can link or unlink providers.

## Security rules
- Require verified email before allowing paid generation.
- Step-up auth for deleting account and exporting sensitive assets.
- Rate limit signup, login, reset password, and job creation.

---

# 8. API contract

Use `/v1` versioning from the start.

## auth
### `POST /v1/auth/sync`
Used after frontend login.

**Response**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "fullName": "Jane Doe",
    "role": "user",
    "status": "active"
  }
}
```

## me
### `GET /v1/me`
Returns the authenticated user profile, balance, and active plan.

### `PATCH /v1/me`
Updates profile.

**Body**
```json
{
  "fullName": "Jane Doe",
  "avatarUrl": "https://..."
}
```

## billing
### `POST /v1/billing/checkout-session`
Creates Stripe checkout session.

**Body**
```json
{
  "planCode": "creator-monthly"
}
```

### `POST /v1/billing/portal-session`
Creates Stripe portal session.

### `GET /v1/billing/credits`
Returns current credit balance and recent ledger entries.

## characters
### `POST /v1/characters`
```json
{
  "name": "Sophia",
  "characterType": "real"
}
```

### `GET /v1/characters`
List user characters.

### `GET /v1/characters/:id`
Get one character.

### `PATCH /v1/characters/:id`
Update character metadata.

### `DELETE /v1/characters/:id`
Soft-delete character.

### `POST /v1/characters/:id/dataset/upload-url`
Returns signed URL for direct upload.

**Body**
```json
{
  "fileName": "img_01.jpg",
  "contentType": "image/jpeg",
  "fileSizeBytes": 3519221
}
```

**Response**
```json
{
  "assetId": "uuid",
  "uploadUrl": "https://...",
  "publicUrl": null,
  "headers": {
    "Content-Type": "image/jpeg"
  }
}
```

### `POST /v1/characters/:id/dataset/complete`
Confirms upload completion.

### `POST /v1/characters/:id/validate-dataset`
Runs dataset quality checks.

### `POST /v1/characters/:id/train`
Queues model training.

**Body**
```json
{
  "trainingPreset": "standard-v1"
}
```

## generation
### `POST /v1/generations/image`
```json
{
  "characterId": "uuid",
  "stylePackId": "uuid",
  "prompt": "editorial portrait in a luxury hotel lobby",
  "negativePrompt": "blurry, deformed, low quality",
  "settings": {
    "aspectRatio": "4:5",
    "numImages": 4,
    "seed": 12345,
    "guidance": 6.5
  }
}
```

### `POST /v1/generations/video`
```json
{
  "characterId": "uuid",
  "prompt": "walking confidently through a rooftop party",
  "sourceAssetId": "uuid",
  "settings": {
    "durationSec": 5,
    "aspectRatio": "9:16"
  }
}
```

### `POST /v1/generations/faceswap-image`
```json
{
  "sourceAssetId": "uuid",
  "targetAssetId": "uuid"
}
```

### `POST /v1/generations/faceswap-video`
```json
{
  "sourceFaceAssetId": "uuid",
  "targetVideoAssetId": "uuid"
}
```

### `POST /v1/generations/upscale`
```json
{
  "assetId": "uuid",
  "mode": "realism"
}
```

## jobs
### `GET /v1/jobs`
Filterable list.

### `GET /v1/jobs/:id`
Returns full status and output assets.

## assets
### `GET /v1/assets`
List gallery assets.

### `DELETE /v1/assets/:id`
Soft-delete or schedule hard delete.

## webhooks
### `POST /v1/webhooks/stripe`
### `POST /v1/webhooks/provider/:provider`

---

# 9. Job state machine

## Allowed statuses
- `queued`
- `running`
- `completed`
- `failed`
- `canceled`

## State rules
- A job can only move forward through valid transitions.
- Each transition updates timestamps.
- Callbacks must be idempotent.
- External provider callbacks must be verified.

## Processing sequence
1. API writes `generation_jobs` row.
2. API reserves credits.
3. API enqueues BullMQ job.
4. Worker loads job and marks `running`.
5. Worker calls provider adapter.
6. Worker stores outputs to R2.
7. Worker writes `assets` and `job_assets`.
8. Worker finalizes ledger.
9. Job becomes `completed`.
10. Realtime update is pushed to UI.

---

# 10. Realtime updates

Use one of:
- **Server-Sent Events** for simplicity, or
- **Pusher / Ably / WebSocket gateway** if you need broader realtime support.

## Recommendation
Start with **SSE** for job progress updates. It is simpler and good enough for generation status.

Endpoints:
- `GET /v1/events/jobs/stream`

UI behaviors:
- optimistic “queued” state,
- spinner while running,
- auto-refresh on completion,
- toast on failure.

---

# 11. Storage design

## Buckets
- `uploads-private`
- `outputs-private`
- `thumbnails-public` or signed only
- `exports-private`

## Object key scheme
```text
users/{userId}/characters/{characterId}/datasets/{assetId}.jpg
users/{userId}/jobs/{jobId}/outputs/{assetId}.png
users/{userId}/jobs/{jobId}/outputs/{assetId}.mp4
```

## Rules
- All original assets private by default.
- Use signed URLs for downloads.
- Optionally expose compressed thumbnails through a CDN.
- Keep deletion workflows asynchronous and audited.

---

# 12. Moderation and abuse prevention

This category is high-risk for identity abuse. Treat moderation as part of the core product.

## Minimum controls
- prompt moderation before generation,
- image moderation after generation,
- upload type and virus scanning,
- per-user, per-IP, and per-plan rate limits,
- anomaly detection for mass signups / scraping / abuse,
- terms that explicitly require rights to uploaded faces and likenesses.

## Additional controls to strongly consider
- explicit consent checkbox before training a “real” character,
- age and sexual-content checks,
- admin review queue for flagged outputs,
- face/identity misuse escalation path,
- DMCA / takedown workflow.

---

# 13. Stripe setup

## Products
Create these products:
- `free`
- `creator-monthly`
- `pro-monthly`
- `business-monthly`

## Webhooks to handle
- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

## Webhook processing rules
- Verify signature.
- Persist raw payload to `webhooks` table first.
- Process idempotently.
- Update `subscriptions`.
- Add credit ledger entries.
- Log failures for replay.

---

# 14. Environment variables

## web
```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_API_BASE_URL=
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_APP_URL=
SENTRY_AUTH_TOKEN=
```

## api
```bash
DATABASE_URL=
REDIS_URL=
CLERK_SECRET_KEY=
CLERK_JWKS_URL=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
RESEND_API_KEY=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_UPLOADS=
R2_BUCKET_OUTPUTS=
R2_PUBLIC_BASE_URL=
FAL_API_KEY=
REPLICATE_API_TOKEN=
SENTRY_DSN=
POSTHOG_API_KEY=
APP_URL=
API_URL=
JWT_AUDIENCE=
```

## workers
```bash
DATABASE_URL=
REDIS_URL=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
FAL_API_KEY=
REPLICATE_API_TOKEN=
SENTRY_DSN=
```

---

# 15. Build sequence

## Phase 0 — project setup
1. Create monorepo.
2. Add Next.js app.
3. Add NestJS API.
4. Add shared packages.
5. Configure linting, formatting, CI.

## Phase 1 — auth + shell
6. Set up Clerk.
7. Build public landing page.
8. Build login/signup/reset flows.
9. Build app layout and protected routes.
10. Implement `POST /v1/auth/sync`.

## Phase 2 — data + billing
11. Create Prisma schema.
12. Run initial migrations.
13. Add plans seed script.
14. Integrate Stripe checkout and portal.
15. Add Stripe webhook processing.
16. Add credit ledger helpers.

## Phase 3 — assets + characters
17. Implement signed upload URLs.
18. Add asset persistence.
19. Build character CRUD.
20. Build dataset upload UI.
21. Build dataset validation job.
22. Build training UI and queue path.

## Phase 4 — generation
23. Build provider adapter interface.
24. Implement first image provider.
25. Implement image generation endpoint.
26. Build jobs list and job detail pages.
27. Build gallery.
28. Add upscale job.
29. Add face swap image job.
30. Add video generation job.
31. Add face swap video job.

## Phase 5 — hardening
32. Add moderation checks.
33. Add rate limits.
34. Add audit logs.
35. Add Sentry and tracing.
36. Add admin pages.
37. Add deletion and retention workflows.
38. Load test queues and uploads.

---

# 16. Provider adapter interface

Create a provider abstraction like this:

```ts
export interface ImageGenerationAdapter {
  createJob(input: {
    prompt: string;
    negativePrompt?: string;
    referenceImages?: string[];
    aspectRatio?: string;
    seed?: number;
    numImages?: number;
    settings?: Record<string, unknown>;
  }): Promise<{
    externalJobId: string;
    status: 'queued' | 'running' | 'completed';
  }>;

  getJob(externalJobId: string): Promise<{
    status: 'queued' | 'running' | 'completed' | 'failed';
    outputs?: Array<{ url: string; mimeType: string }>;
    errorMessage?: string;
  }>;
}
```

Do the same for:
- video generation,
- face swap,
- upscaling,
- model training.

This is the key to avoiding vendor lock-in.

---

# 17. Testing strategy

## Unit tests
- ledger calculations
- plan enforcement
- job state transitions
- webhook idempotency
- dataset validation scoring

## Integration tests
- auth sync flow
- Stripe webhook flow
- signed upload lifecycle
- job creation and completion

## E2E tests
- signup/login
- subscribe to plan
- create character
- upload dataset
- start training
- generate image
- upscale output
- view billing ledger

---

# 18. Launch checklist

- [ ] Auth flows work across email + OAuth.
- [ ] Verified email required before paid actions.
- [ ] Stripe webhooks tested in staging.
- [ ] All uploads use signed URLs.
- [ ] Queue retries are configured.
- [ ] Failed jobs refund correctly.
- [ ] Outputs are stored and retrievable via signed URLs.
- [ ] Abuse/rate limiting is enabled.
- [ ] Sentry and logs are wired.
- [ ] Admin tooling exists for failed jobs and credit adjustments.
- [ ] Terms/privacy/consent flows are live.

---

# 19. Strong recommendation

If you want a competitor that feels more serious than the reference product, win on these specific areas:

1. **Better onboarding** — clearer first-run flow, simpler first character creation.
2. **More transparent billing** — visible credit math and ledger history.
3. **More reliable jobs** — better retries and provider abstraction.
4. **Trust and safety** — clear consent language and stronger moderation.
5. **Higher production quality** — fast gallery UX, clean settings, good error states.

---

# 20. Immediate next step

Build this in the following exact order:

1. auth,
2. DB schema,
3. billing,
4. uploads,
5. characters,
6. image generation,
7. gallery,
8. video/face swap/upscale,
9. moderation/admin,
10. production hardening.

That order minimizes rework and gets you to a usable paid product fastest.
