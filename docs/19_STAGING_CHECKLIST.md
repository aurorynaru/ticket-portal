# 19 — Railway Staging Checklist

Scope: the exact, ordered steps to deploy the ticketing system to a **single
Railway service** with one persistent volume, verify persistence and backups,
and capture the load evidence required by `docs/10_TESTING_LOAD.md`. Every
item below runs **only after explicit owner approval** to create Railway
resources. Nothing in this document is executed from this machine — Railway
has no Docker here and no deployment has been performed.

Companion docs: `docs/11_RAILWAY_DEPLOY.md` (config), `docs/17_DOCKER_IMPLEMENTATION.md`
(image contract), `docs/18_BACKUP_RESTORE.md` (backup/restore),
`docs/20_DEPLOYMENT_READINESS.md` (readiness + load evidence).

## Pre-flight (before any Railway resource exists)

- [ ] `npm run build` exits 0 and emits `dist/server.js` + `public/assets/app.css`.
- [ ] `npm run typecheck` exits 0.
- [ ] `npm test` (vitest) passes; `npm run test:e2e` (Playwright) passes.
- [ ] `package-lock.json` is committed and `npm ci` reproduces `node_modules`
      from it (better-sqlite3 12.11.1 prebuild resolves for Node 24).
- [ ] Root `Dockerfile` + `.dockerignore` present; `.env` is **not** tracked in
      Git (only `.env.example` with fake placeholders).
- [ ] A fresh `docker build` succeeds on a Docker-enabled machine (this machine
      has no Docker — run it on the CI/staging host before pushing).
- [ ] A **random** `BETTER_AUTH_SECRET` (≥32 bytes) is generated and stored only
      as a Railway secret — never in the repo.

## 1. Create the service and volume (P6.1)

- [ ] Push the implemented app (Dockerfile, .dockerignore, package-lock.json,
      build scripts) to the GitHub repo that Railway watches.
- [ ] Create a Railway project → add **one** service from that repo. Confirm the
      deploy log says the root `Dockerfile` was used (not Railpack). Do **not**
      add a Postgres/SQLite service.
- [ ] Attach **one** persistent volume to that service, mount path **`/data`**.
      Volumes mount at **runtime** only — no pre-deploy command may touch `/data`.
- [ ] Set environment (Railway injects `PORT`; do not hardcode the port):

  ```dotenv
  NODE_ENV=production
  DATABASE_PATH=/data/tickets.db
  UPLOAD_DIR=/data/uploads
  BETTER_AUTH_URL=https://<real-domain>
  SESSION_TRUSTED_ORIGIN=https://<real-domain>
  BETTER_AUTH_SECRET=<random-secret>
  DEFAULT_TIMEZONE=Asia/Manila
  MAX_UPLOAD_BYTES=10485760
  NOTIFICATION_POLL_SECONDS=45
  ```

- [ ] Confirm the image's start command is the Dockerfile `CMD`
      (`node dist/server.js`). Remove any stale Railway start-command override.
- [ ] Resource budget: **1 replica, 1 vCPU, 512 MB** (do not scale replicas with
      a volume attached).
- [ ] Generate the public HTTPS domain; set the readiness path to
      `/health/ready`.

## 2. First boot + health (P6.1)

- [ ] Deploy. In the Railway logs confirm, in order: env validated → `/data`
      writable → `/data/uploads` created → SQLite opened at `DATABASE_PATH` →
      WAL/FK/busy-timeout set → Better Auth + app migrations applied → ready.
- [ ] `GET /health/live` → 200 (process responding).
- [ ] `GET /health/ready` → 200 only **after** migrations + a DB read/write check
      pass. Neither endpoint reveals secrets.
- [ ] Startup did **not** run any seed/demo fixtures (production is empty until
      an admin provisions it).

## 3. Identity + core flows (P6.1)

- [ ] Public sign-up is disabled (no self-service account creation).
- [ ] First admin created with the reviewed Better Auth bootstrap tooling
      (`npm run auth:create-admin`), not by hand-editing the DB.
- [ ] Sign-in sets the session cookie over HTTPS; sign-out clears it.
- [ ] Verified end-to-end in a browser: create ticket → attach file → assign →
      resolve → close. Reopen works.

## 4. Persistence across redeploy (P6.2)

- [ ] Record a known state: a specific ticket id + number, one uploaded file
      (note its sha256), and a signed-in session.
- [ ] **Redeploy** the same image (no schema change). After boot:
  - [ ] The recorded ticket still exists with identical content.
  - [ ] The uploaded file downloads byte-identical (sha256 matches).
  - [ ] The auth session / a fresh sign-in still works.
- [ ] **Schema-touching redeploy** (if any migration is pending): a pre-deploy
      backup exists (step 6), and a failed boot is recoverable from it.

## 5. Backups + recovery drill (P6.5)

- [ ] Run an in-service backup: `node dist/db/cli-backup.js /data/backups`
      (or `npm run db:backup` locally). Confirm the JSON summary and that the
      snapshot's `integrity_check = ok` with zero FK violations.
- [ ] Enable Railway volume backups (daily) and, where appropriate, a weekly
      cadence. Export the most recent backup **off-volume** (download from the
      volume / copy to object storage) so a volume failure does not destroy all
      copies.
- [ ] **Recovery drill** (isolated target, never the live path without `--force`):
  1. `node dist/db/cli-restore.js <backup-dir> /data/restore/tickets.db /data/restore/uploads`
  2. Verify the restored DB opens with `integrity_check = ok`, zero FK violations,
     and sha256 matches the manifest.
  3. Stop the service, swap the restored `tickets.db` + `uploads` into place
     (move the current ones aside, do not delete), start the service, and confirm
     `/health/ready` = 200 and the restored ticket/file are present.
- [ ] Document the drill outcome (timestamps, backup dir, restored ticket id) in
      `docs/20_DEPLOYMENT_READINESS.md`.

## 6. Load evidence on the real limit (P6.3 / P6.4)

- [ ] Run the 100-user mixed and 100-write burst scenarios against the staging
      service at **1 vCPU / 512 MB** (see `docs/10_TESTING_LOAD.md` and
      `load/k6/mixed.js`, `load/k6/burst.js`). The load generator runs **outside**
      the constrained service.
- [ ] Record: read p95, write p95, app RSS peak, CPU, 5xx/SQLite-busy count,
      error rate. Do **not** assert 512 MB success without observed numbers.
- [ ] If a target is missed, profile (slow queries / CPU / memory) and tune
      **before** requesting more RAM/CPU. Log the profile + change.

## 7. Rollback + go/no-go

- [ ] Confirm the image can roll back, and that **migrations are persistent** on
      the volume — any forward migration must be backward-compatible or have a
      separately tested recovery plan.
- [ ] Confirm single-service downtime on redeploy is acceptable (this is not HA).
- [ ] Owner signs off go/no-go. Only then is P6 complete and P7 unblocked.

## Out of scope / not done here

- No Railway resources, deployments, account connections, or hosting costs are
  created from this machine.
- Docker build/run validation is deferred to a Docker-enabled host (none
  installed here).
- P7 (documentation handoff + production acceptance) starts only after owner
  approval of this checklist's results.