# Deploying On Railway

This repo is set up to run as three Railway services from the monorepo:

- `apps/web`
- `apps/api`
- `apps/worker-media`

Each service now includes a local [`railway.json`](../apps/api/railway.json) or equivalent config file so Railway can pick up the right build, start, healthcheck, and restart settings from code.

## 1. Create The Railway Project

1. In Railway, create a new project from this GitHub repository.
2. Import the three application packages from the monorepo:
   - `apps/web`
   - `apps/api`
   - `apps/worker-media`
3. Add a Redis service in the same Railway project.
4. Either:
   - add a Railway PostgreSQL service, or
   - use an external database such as Supabase

The API and web services need public domains. The worker does not.

## 2. Configure Public URLs

After Railway assigns domains, wire them like this:

- `APP_URL=https://<web-domain>`
- `API_URL=https://<api-domain>`
- `API_PUBLIC_URL=https://<api-domain>`
- `API_SERVER_URL=https://<api-domain>`
- `NEXT_PUBLIC_API_BASE_URL=https://<api-domain>/api`
- `NEXT_PUBLIC_APP_URL=https://<web-domain>`

`APP_URL` drives API CORS and Stripe return URLs.
`API_URL` and `API_PUBLIC_URL` drive storage links and provider webhook callbacks.
`API_SERVER_URL` and `NEXT_PUBLIC_API_BASE_URL` are required by the web app for server-side fetches and browser-side SSE.

## 3. Configure Shared Environment Variables

Use [`.env.example`](../.env.example) as the source of truth. At minimum, set these before the first production deploy:

- `NODE_ENV=production`
- `DATABASE_URL`
- `DIRECT_URL`
- `REDIS_URL`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_UPLOADS`
- `R2_BUCKET_OUTPUTS`
- `STORAGE_MODE=r2`
- `STORAGE_SIGNING_SECRET`
- `CLERK_SECRET_KEY`
- `CLERK_JWKS_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- your provider keys such as `FAL_API_KEY`, `REPLICATE_API_TOKEN`, or `GEMINI_API_KEY`

Service-specific reminders:

- `apps/web`: needs `API_SERVER_URL`, `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_APP_URL`, Clerk public vars
- `apps/api`: needs billing secrets, auth secrets, DB, Redis, R2, and provider keys
- `apps/worker-media`: needs DB, Redis, R2, provider keys, and concurrency vars

## 4. First Deploy Sequence

The API service pre-deploy command runs:

```bash
pnpm --dir ../.. db:migrate:deploy && pnpm --dir ../.. db:seed
```

That keeps schema and seed data aligned with code on each API deploy.

Recommended first cutover:

1. Deploy `apps/api`
2. Wait for `GET /api/health` to report `status: "ok"`
3. Deploy `apps/worker-media`
4. Deploy `apps/web`

## 5. Verify Production

Run these checks after the first green deploy:

1. Open `https://<api-domain>/api/health`
2. Confirm the response reports:
   - `database.healthy: true`
   - `queue.mode: "queue"`
   - `storage.mode: "r2"`
3. Sign in through Clerk on the web app
4. Upload a dataset image
5. Submit an image generation job
6. Confirm SSE updates arrive in the browser
7. Confirm outputs are written to R2

## 6. Railway Settings To Double-Check

- Disable sleep for API and worker services
- Keep restart policy enabled for all three services
- Expose a public domain for web and API only
- Set the GitHub repository variable `HEALTHCHECK_URL` to `https://<api-domain>/api/health`
- Optionally set `UPTIME_ALERT_WEBHOOK_URL` for the uptime workflow

## 7. Notes

- The API will now fail fast in production if Redis or R2 are missing.
- The worker will now fail fast in production if R2 is missing.
- The worker uses provider webhooks when enabled and falls back to delayed polling.
- If you use Supabase, keep `DATABASE_URL` on the transaction pooler and `DIRECT_URL` on the direct host.
