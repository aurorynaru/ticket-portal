# 11 — Railway one-service deployment

**Objective:** Fastify/Node application + local SQLite + attachments using one persistent volume, one replica.

## Project configuration

- GitHub repo, Railway service built from the **supplied root-level multistage `Dockerfile`**. Railway must detect Dockerfile automatically; see `docs/17_DOCKER_IMPLEMENTATION.md` for exact commands, sample image, and smoke test.
- **1 running service**, 1 replica, 1 vCPU budget, initially **512 MB** memory budget (subject to current plan limits).
- Attach a persistent volume mounted at **`/data`**. Set `DATABASE_PATH=/data/tickets.db`, `UPLOAD_DIR=/data/uploads`.
- Publish HTTP service; bind Node server to `0.0.0.0` and `process.env.PORT`.
- HTTPS domain is configured in Railway; set Better Auth trusted origin/base URL to the **actual HTTPS domain**.
- Railway's volumes are **not available during image build or pre-deploy commands**. Perform auth/app migrations at startup *after* `/data` mounts and before the app serves traffic.
- Do not scale to multiple replicas with an attached volume. Expect short restart/deploy downtime with this architecture.

## Environment variables

```dotenv
NODE_ENV=production
PORT=3000
DATABASE_PATH=/data/tickets.db
UPLOAD_DIR=/data/uploads
BETTER_AUTH_URL=https://YOUR-RAILWAY-DOMAIN.example
BETTER_AUTH_SECRET=GENERATE_32_PLUS_RANDOM_BYTES_AND_STORE_AS_SECRET
SESSION_TRUSTED_ORIGIN=https://YOUR-RAILWAY-DOMAIN.example
DEFAULT_TIMEZONE=Asia/Manila
MAX_UPLOAD_BYTES=10485760
NOTIFICATION_POLL_SECONDS=45
# Optional: EMAIL_PROVIDER_API_KEY=... (enables password reset mail and email notifications)
# Optional: EMAIL_FROM=... (verified sender)
```

Use `.env.example` with fake placeholders in the actual code repository; store genuine values only in Railway secrets. `PORT` is assigned by Railway in production; the app must accept its runtime value. Configure local development separately, e.g. `DATABASE_PATH=./.local/tickets.db`.

## Docker implementation (required)

Use **root `Dockerfile`** and **root `.dockerignore`**, not a generic template produced at deployment time; `docs/17_DOCKER_IMPLEMENTATION.md` specifies tested-at-P0 expectations. The Dockerfile currently serves as an implementation template until P0 source/package files exist. No FFmpeg or separate sqlite3 package is needed: the application uses `better-sqlite3`. Railway defaults to the Dockerfile CMD if there is no conflicting Start Command override.

## Suggested multi-stage Docker build

1. Build stage: `node:24-bookworm-slim`; `npm ci` with pinned lockfile; `npm run build` runs TS compilation and Tailwind CLI.
2. Runtime stage: **same Debian family** (`node:24-bookworm-slim`) so `better-sqlite3` native bindings are compatible. The included Dockerfile copies compiled JS, views, public assets, migrations, package manifest and production node_modules (`npm prune --omit=dev` in the build stage).
3. Startup: verify `/data` writable, initialize schema once with safe migrations, then `node dist/server.js` (if startup implemented inside app) or a single deterministic entrypoint. Never bootstrap a second DB at `./database.sqlite` when `/data` missing.
4. Avoid Alpine/musl mismatch for prebuilt native SQLite bindings unless deliberately built/tested.
5. Health: `GET /health/live` returns 200 if process responds, `GET /health/ready` returns 200 only after schema/database read-write checks complete; neither reveals secrets.

## Persistent volume permissions

Railway docs note volumes are root-mounted and non-root container images can face write-permission problems. Prefer a reviewed ownership/UID approach; if necessary Railway documents `RAILWAY_RUN_UID=0` as an operational workaround, which means accepting the tradeoff of running the process as root. Test exact container user and filesystem permissions, and record decision. Do not change file permissions recursively on an unintended path.

## Migrations startup contract

- Check DB backup policy before release; automatically apply only compatible, already-reviewed forward migrations.
- Better Auth schema generation is done during controlled development and checked into migration artifact strategy. Do not run unreviewed auto-generated production schema changes on every startup.
- Application numbered migrations run once transactionally; fail startup loudly if migration fails.
- Health `ready` should not return 200 until all migrations succeeded and basic DB check passes.
- Startup script must not run production seed/demo fixtures.

## Railway deploy checklist

- [ ] Service builds from pinned source revision and lockfile.
- [ ] Volume attached `/data`, file paths absolute, writable at startup.
- [ ] Production secrets configured and no `.env` checked into Git.
- [ ] Public hostname/HTTPS configured and Better Auth sign-in cookie tested.
- [ ] `/health/live` and `/health/ready` checked externally.
- [ ] Admin created using supported Better Auth bootstrap method.
- [ ] Login, create ticket, attach file, resolve, close tested.
- [ ] Redeploy, verify exact ticket, file and auth session persisted.
- [ ] Daily + weekly Railway volume backups enabled where appropriate.
- [ ] Database-consistent logical backup run and restoration tested separately.
- [ ] 100-user load evidence captured with actual resource limit.
- [ ] Rollback and migration failure behavior reviewed before production switch.

## References and known limitations

See https://docs.railway.com/volumes and https://docs.railway.com/volumes/reference: volumes mount at runtime, no replicas attached, possible redeploy downtime. Backups: https://docs.railway.com/volumes/backups. One service is low cost, **not high availability**. Monitor volume fill rate, especially screenshots/error-log attachments.
