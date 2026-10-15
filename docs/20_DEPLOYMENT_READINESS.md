# 20 — Deployment Readiness

Scope: the readiness assessment for taking the ticketing system to Railway,
with the **measured** local load evidence that stands in for the on-Railway
run until owner approval lets us exercise the real 1 vCPU / 512 MB service.
Nothing here is a projection presented as fact: every number below was
produced by a command and is cited. Railway-side items are tracked in
`docs/19_STAGING_CHECKLIST.md` and remain **open** until executed with
approval.

## Status

| Area | State | Evidence |
| --- | --- | --- |
| Build / typecheck | Ready | `npm run build` + `npm run typecheck` exit 0 |
| Unit + integration tests | Ready | `npm test` (vitest) — see test count below |
| Deterministic E2E | Ready | `npm run test:e2e:tarmy` + `npm run test:e2e` (Playwright) |
| Backup / restore | Ready (local) | `tests/backup.test.ts`; `docs/18_BACKUP_RESTORE.md` |
| 100-user load (local) | **Measured** | table below |
| Docker image build | **Blocked** | No Docker on this machine |
| Railway deploy / persistence / on-Railway load | **Not started** | Requires owner approval (`docs/19`) |

## Measured load evidence (local, isolated DB)

Environment: Node v24.11.1, Fastify + better-sqlite3 12.11.1, isolated SQLite
at `.local/load/load.db` (101 users, 10 teams, 20,000 tickets, 60,000
comments; ~1,372 tickets CLOSED). Load generator (k6 v2.2.0) runs **outside**
the app process. The app ran with production-equivalent durability settings
(WAL, `synchronous=NORMAL`, FK on, bounded busy timeout).

Scenario: `load/k6/mixed.js`, 100 virtual users, 60 s steady mixed read/write.

| Metric | Result | Target | Met |
| --- | ---: | ---: | :--: |
| Checks passed | 11,473 / 11,473 (100%) | 100% | ✓ |
| `http_req_failed` | 0 | 0 | ✓ |
| Iterations | 8,704 | — | — |
| Read p95 | 184.77 ms | < 500 ms | ✓ |
| Write p95 | 71.39 ms | < 1,000 ms | ✓ |
| App RSS peak | 258 MB | < 400 MB | ✓ |
| 5xx / SQLite busy | 0 | 0 | ✓ |

Commands:

```powershell
# app (separate process, port 3199)
$env:NODE_ENV="development"; $env:PORT="3199"
$env:DATABASE_PATH="C:\AI\Ticket\.local\load\load.db"
$env:UPLOAD_DIR="C:\AI\Ticket\.local\load\uploads"
$env:BETTER_AUTH_SECRET="local-load-only-secret-0123456789abcdef"
$env:BETTER_AUTH_URL="http://127.0.0.1:3199"
$env:SESSION_TRUSTED_ORIGIN="http://127.0.0.1:3199"
$env:RATE_LIMIT_MAX="100000"; $env:RATE_LIMIT_AUTH_MAX="100000"; $env:LOG_LEVEL="warn"
node dist/server.js

# load (separate process)
& "C:\Program Files\k6\k6.exe" run --env TARGET=http://127.0.0.1:3199 --env DURATION=60s load/k6/mixed.js
```

### Caveats on the local numbers

- **Not the real Railway limit.** This ran on a developer workstation, not a
  1 vCPU / 512 MB Railway service. It demonstrates the app is not
  structurally slow and that the workload is well inside target, but it is
  **not** the acceptance measurement. The on-Railway run (step 6 of
  `docs/19`) is the number that counts.
- **k6 2.x quirks handled in the harness** (not app defects): the per-VU
  cookie jar resets between iterations, so the script sends an explicit
  `Cookie` header on every post-login request; POSTs set `redirects: { max: 0 }`
  so the raw 302 is asserted. CLOSED tickets (~7% of seed) legitimately
  422 on edit/comment, so the manifest exposes `openTickets` / `ownOpen` and
  the script only writes to open tickets.

## Profiling / tuning notes (P6.4)

- The due-date parser (`src/modules/tickets/service.ts`, `parseDueAt`) was
  found to accept only bare `YYYY-MM-DD` while the forms submit
  `datetime-local` (`YYYY-MM-DDTHH:mm`). Fixed to accept both; regression
  tests added in `tests/tickets.test.ts`. This was a correctness bug surfaced
  by the load run, not a performance issue.
- No slow-query or memory-pressure tuning was required to hit the local
  targets. If the on-Railway run misses a target, profile there (SQLite
  `EXPLAIN QUERY PLAN` on the dashboard/search queries, RSS over time) and
  tune **before** requesting more RAM/CPU.

## Gating summary

- **Local readiness: ready** to attempt the Railway staging run, subject to a
  Docker-enabled host for the image build.
- **Not release-ready** until the `docs/19` checklist is executed with owner
  approval: image build, service + volume, persistence-across-redeploy,
  backup + recovery drill, and the on-Railway 100-user load at the real limit.
- P7 (documentation handoff + production acceptance) is **blocked** on the
  above and on explicit owner approval.

## Open items carried into Railway

1. Docker image build + volume-backed container smoke test (no Docker here).
2. On-Railway 100-user mixed + 100-write burst at 1 vCPU / 512 MB.
3. Redeploy persistence proof (ticket + upload + session survive).
4. Backup schedule (daily/weekly) + off-volume export + recovery drill.
5. First-admin bootstrap + HTTPS cookie verification on the real domain.