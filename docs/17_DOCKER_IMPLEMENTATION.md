# 17 — Docker implementation for Railway (required deployment method)

**Decision:** Deploy with the root-level `Dockerfile`, not Railpack. Keep a single Railway service, a single Node 24 Fastify process, and one persistent Railway volume at `/data`. Docker is the build/package mechanism; SQLite is embedded, not a container/service of its own.

## Files supplied in this guide kit

- `/Dockerfile` — multi-stage Debian-based build: Node 24; TypeScript + Tailwind compiled in build; no compiler/toolchain in runtime.
- `/.dockerignore` — prevents bundling `.env`, local SQLite, uploads, docs, caches, and development output.
- `/.env.example` — illustrative non-secret local environment only.

**Important:** The kit is an implementation specification. Docker cannot build a running ticketing app until P0 creates `package.json`, `package-lock.json`, `src/server.ts`, `src/views`, `public`, `migrations`, and `npm run build`. The agent must create them, then run the actual build and smoke tests. Do not report `docker build` as passing before those files exist.

## Why this Dockerfile differs from the operator's example

| Operator's working sample | Ticketing system | Explanation |
|---|---|---|
| `node:20-bookworm` | `node:24-bookworm-slim` | User-selected Node 24 LTS; smaller Debian runtime |
| `npm ci --build-from-source=sqlite3` | `npm ci` + native build toolchain available | This project uses **better-sqlite3**, not `sqlite3`; verify/pin a Node 24-compatible version |
| `apt-get install ffmpeg` | No ffmpeg | Ordinary attachments do not require transcoding |
| `COPY . .` into sole runtime stage | Copy compiled runtime artifacts from build | Excludes TS compiler, dev dependencies and build toolchain |
| Only `CMD npm start` | `CMD node dist/server.js` | Explicit single production entrypoint; the app migrates on startup |

If `better-sqlite3` needs compilation, the **build** image already contains Python, make, and g++; it does not need those tools in the production image. Builder and runtime use the **same Debian family and Node major** to avoid native-addon ABI/libc mismatch. Pin dependency versions in `package-lock.json`, and pin the base image by tested digest at release time.

## Required application contract to make Docker work

1. `package.json` includes `"type": "module"`, `"engines": { "node": ">=24 <25" }`, and a `build` script that emits **`dist/server.js`** and compiled **`public/assets/app.css`**. Use `npm ci` with committed `package-lock.json`.
2. `tsconfig` compiles ESM TypeScript (`src` to `dist`) for Node 24; no `tsx`, `vite dev`, watcher, or Tailwind compiler runs in production.
3. The app loads view templates from `/app/src/views` or a path resolved relative to its application root, and static assets from `/app/public`.
4. The app reads `PORT` at runtime, binds `0.0.0.0`, and implements `GET /health/live` and `GET /health/ready`.
5. **Startup order:** validate environment -> require `/data` mounted and writable in production -> create `/data/uploads` -> open SQLite at `DATABASE_PATH` -> configure WAL/foreign keys/busy timeout -> run **reviewed idempotent, versioned** Better Auth/application migrations -> mark ready -> listen.
6. Fail the startup if a configured `/data` database cannot be opened; **never silently fall back** to `:memory:` or a fresh database within `/app`.
7. Do not download external web UI assets at runtime; vendored HTMX and compiled CSS must be present in `/app/public`.
8. On SIGTERM, stop receiving requests, flush/finish active operations, and close SQLite cleanly.

## Local Docker smoke test (after P0)

From the application root:

```bash
docker build -t ticketing:local .
docker volume create ticketing-local-data
# Development-only value. Use a randomly generated secret in real deployments.
docker run --rm --name ticketing -p 3000:3000 \
  -v ticketing-local-data:/data \
  -e BETTER_AUTH_URL=http://localhost:3000 \
  -e SESSION_TRUSTED_ORIGIN=http://localhost:3000 \
  -e BETTER_AUTH_SECRET=local-dev-example-replace-with-random-secret \
  ticketing:local
```

In a second terminal: `curl -fsS http://localhost:3000/health/live` and `curl -fsS http://localhost:3000/health/ready`. Stop and rerun the **same named volume**. Confirm ticket data and files persist; then check that a new image redeploy preserves them.

The sample secret is **not** production-safe. If `PORT` is assigned by Railway, the app must respect it; `EXPOSE 3000` is documentation only and does not force the runtime port.

## Railway dashboard setup

1. Push the implemented application, including root-level `Dockerfile`, `.dockerignore`, `package-lock.json` and compiled-build scripts, to GitHub.
2. Create Railway project -> add **one** GitHub repository service. Railway detects root `Dockerfile` (capital D); verify deployment logs say the Dockerfile was used. Do **not** add a separate PostgreSQL or SQLite service.
3. Add one persistent volume to that same service, mount path **`/data`**. Volumes mount at **runtime**, not build/pre-deploy. Do not use Railway pre-deploy migrations to access `/data`.
4. Configure `DATABASE_PATH=/data/tickets.db`, `UPLOAD_DIR=/data/uploads`, `NODE_ENV=production`, `BETTER_AUTH_URL=https://<real-domain>`, `BETTER_AUTH_SECRET` (random and secret), and trusted origins. Railway injects runtime `PORT`; do not hardcode the listening port.
5. Generate a Railway domain; configure readiness path `/health/ready`. Keep a single replica and begin at 1 vCPU / 512 MB, subject to available plan limits.
6. Confirm the service can write the volume. The supplied image runs as root by default because Railway volume ownership is root; document and review this security tradeoff. If changing to non-root, design a *tested* volume permissions strategy first. `RAILWAY_RUN_UID=0` is Railway's documented workaround for permission errors with non-root images.
7. Confirm signup is disabled, first-admin bootstrap uses reviewed Better Auth tooling, cookies work under HTTPS, and all attachments have authorized download routes (never static `/data` URLs).
8. **Redeploy** and verify an existing ticket, authentication, and upload survive. Enable volume backups, perform a separate consistent SQLite backup, and practice restore before production use.
9. Load-test 100 active users against staging; record RSS, CPU, error rate, lock/busy errors, p95 reads and p95 writes. Do not assert 512 MB success without observed evidence.

## No unexpected Railway overrides

Use the Dockerfile `CMD` as the start command. A Railway start-command override supersedes the Docker image entrypoint/command; remove stale override unless documented. Do not try to migrate in a pre-deploy command: the attached `/data` volume is not present then.

## Rollback caveat

The image can roll back, but **database migrations are persistent** on the volume. Migrations must be backward-compatible or have an explicit, separately tested recovery plan. Railway volume services also experience some deploy downtime; they are not zero-downtime HA.

## Sources

- Railway Dockerfiles: https://docs.railway.com/builds/dockerfiles
- Railway start commands: https://docs.railway.com/deployments/start-command
- Railway volume mount/permissions: https://docs.railway.com/volumes
- Railway volume restrictions: https://docs.railway.com/volumes/reference
- better-sqlite3 native module: https://github.com/WiseLibs/better-sqlite3
