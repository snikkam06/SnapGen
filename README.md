# SnapGen

Monorepo for the SnapGen API, media worker, web app, and shared packages.

## Health And CI

- API health endpoint: `GET /api/health`
- PR validation: GitHub Actions runs `pnpm typecheck`, `pnpm build`, database migrate/seed, and `pnpm smoke:test`
- Smoke test: starts the built API and worker, then waits for `/api/health` to report `status: "ok"`
- External uptime workflow: `.github/workflows/uptime-check.yml` runs from GitHub Actions every 5 minutes once `HEALTHCHECK_URL` is configured
- Error tracking: API and worker initialize Sentry automatically when `SENTRY_DSN` is set

## Deployment

Use the production checklist before opening traffic:

- [Production checklist](./docs/deployment-checklist.md)
- [Railway deploy guide](./docs/railway-deploy.md)
