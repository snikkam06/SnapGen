# Production Checklist

## Before First Production Traffic

1. Provision PostgreSQL, Redis, and Cloudflare R2. Production startup now fails fast if Redis or R2 are unavailable.
2. Set `APP_URL`, `API_URL`, and `API_PUBLIC_URL` to the real public origins.
3. Run:

```bash
pnpm db:migrate:deploy
pnpm db:seed
```

This seeds plans and style packs required by the billing and generation flows.

## Staging

Create a separate staging environment that mirrors production:

- its own PostgreSQL database
- its own Redis instance
- its own R2 buckets
- its own public API URL so provider webhooks can reach it

Use the same deploy sequence in staging before promoting:

```bash
pnpm db:migrate:deploy
pnpm db:seed
pnpm smoke:test
```

## Monitoring

Railway deploy health checks are not enough on their own. Add both:

- External uptime alerts against `GET /api/health` from outside Railway
- Error tracking for API and worker runtime failures in your monitoring vendor of choice

Treat any non-200 response from `/api/health` as paging-worthy in production. The endpoint reports database, queue worker, and storage status.

GitHub-side setup included in this repo:

- Set repository variable `HEALTHCHECK_URL` to your deployed `https://.../api/health` endpoint
- Optionally set repository secret `UPTIME_ALERT_WEBHOOK_URL` to a Slack-compatible incoming webhook URL
- The scheduled workflow in `.github/workflows/uptime-check.yml` will probe the endpoint every 5 minutes from outside Railway

Sentry setup included in code:

- Set `SENTRY_DSN` in API and worker environments
- Optionally set `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, and `SENTRY_TRACES_SAMPLE_RATE`
- The API captures server-side 5xx exceptions
- The worker captures bootstrap, dispatch, poll, and unhandled runtime failures

## Provider Webhooks

Provider webhook completion is now supported for `fal` and `replicate`.

Required configuration:

- `API_PUBLIC_URL`
- `ENABLE_PROVIDER_WEBHOOKS=true`
- `REPLICATE_API_TOKEN`
- `REPLICATE_WEBHOOK_SIGNING_SECRET` or permission for the API to fetch the webhook secret from Replicate

The worker still schedules a delayed polling fallback using `PROVIDER_WEBHOOK_FALLBACK_DELAY_MS` so a missed callback does not leave jobs stuck indefinitely.
