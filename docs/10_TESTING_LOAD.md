# 10 — Testing strategy and 100-concurrent-user load test

## Test levels

| Level | Required scope |
|---|---|
| Static | strict TS check, lint/format, dependency audit, migration lint |
| Unit | validation, status transition policy, effective role resolver, FTS sanitizer |
| SQLite integration | new DB migrations, FK/FTS sync, transaction rollback, optimistic versions, WAL setup |
| Fastify integration | sessions, each protected route, errors, CSRF, auth Fastify bridge, upload guard |
| Browser E2E | login, creation, assignment, assignee resolution, creator closure, reopening, notification, mobile |
| Railway smoke | start/redeploy/volume persistence, readiness, real attachments, restart recoverability |
| Performance | real-like 100-user load on 1 vCPU, 512 MB, one replica |

Use **temporary SQLite files** for tests. Only test with synthetic tickets and user accounts. Each suite resets its own database; never point a test at `/data/tickets.db` in production.

## E2E suites

Two suites run against the same app on `http://127.0.0.1:3111`, each with its own ephemeral database under `.local/` (synthetic users only, seeded by `scripts/seed-e2e.ts`):

| Suite | Command | Scope | Gate |
|---|---|---|---|
| Playwright | `npm run test:e2e` | P0 smoke + P1 auth/RBAC (4 tests) | Required, deterministic |
| TesterArmy deterministic | `npm run test:e2e:tarmy` | health, login/logout, session persistence, admin user management, RBAC, unauthorized access, CSRF (15 tests, `tests/*.e2e.ts` minus `#exploratory`) | Required, deterministic |
| TesterArmy exploratory | `npm run test:e2e:tarmy:explore` | AI-agent sign-in + assertion via local Ollama model (1 test, tagged `#exploratory`) | Informational only — never part of the core acceptance gate |

Notes:

- TesterArmy deps (`e2e`, `@e2e-dev/web`) are devDependencies only and are excluded from the production Docker image.
- The exploratory test uses `qwen38-code:latest` on local Ollama (`http://127.0.0.1:11434/v1`); per-step agent timeouts are raised (act 480s, assert 240s, test body 600s) because the 27B thinking model exceeds the 120s default step budget. A typical run is ~45s.
- Both E2E launchers wipe their own `.local/e2e*` database directory before seeding so suites are idempotent across runs.

## Functional acceptance scenarios

### End-to-end happy path

1. Admin bootstraps account, creates manager, User A, User B and Viewer.
2. A signs in, creates ticket assigned to B; status `ASSIGNED`; event + notification created.
3. B signs in, sees assigned ticket, starts work, adds a private note and screenshot.
4. B enters **issue summary, actions taken, resolution**, resolves. Resolution row is append-only.
5. A sees `RESOLVED`, checks solution, closes. No missing resolution allowed.
6. A reopens with reason; B adds new solution, resolves again; A closes again; both resolutions are still visible.
7. Search finds the ticket, but unauthorized viewer for RESTRICTED ticket sees nothing.
8. Restart application; all tickets/comments/attachments/history persist.

### Negative critical path

- Assign to deactivated/nonexistent user -> 422.
- Viewer POST ticket create, blind POST close, comment -> denied.
- B tries to close A's ticket while not creator/manager/admin -> denied.
- A attempts to resolve work assigned to B -> denied (unless admin/manager override).
- Resolve without actions or resolution -> 422.
- Closed ticket edit / comment -> denied.
- Stale `version` update -> 409 and no lost update.
- Unauthorized attachment ID -> 404.
- Better Auth reset/cookie/CORS/origin and password flows in a real browser.

## Load scenarios — 100 virtual users

Use k6 or Artillery, or a similar reproducible open-source load tool. Implement scripted login/session handling, CSRF extraction, synthetic content and cleanup. Run in staging or test deployment **configured with exactly 1 vCPU and 512 MB RAM**; ensure generator runs elsewhere so its CPU is not counted against app.

### Dataset

Seed at least 100 active users, 10 teams, 20,000 tickets, 3 comments/ticket on average, representative resolutions/events/attachments metadata and FTS backfill. Include both RESTRICTED and TEAM tickets. Attachments can be sampled with 100 KB–2 MB test files, but upload stress should be measured separately.

### Scenario A — 100 logged in and browsing

Warm login; ramp to 100 users over 2–3 minutes; steady 15 minutes. Example distribution of actions:

- 35% ticket list/filter/search
- 25% ticket detail/timeline
- 15% dashboard
- 10% notifications
- 10% comments / work updates
- 5% create/assign/resolve/close

Each virtual user waits realistically between interactions (e.g. 3–10 seconds) rather than generating an unlimited request loop.

### Scenario B — 100 simultaneous write burst

Synchronize 100 authenticated users to submit a comment or edit at once (distinct tickets first, then deliberate same-ticket races). Observe SQLite writer contention, HTTP responses, busy timeouts and serialized transaction latency. Success requires **correctness**: zero silent lost updates or partial commits. Latency target is aspirational, not a promise.

### Scenario C — edge cases

Search high-frequency prefixes; upload 10 MB files with a few concurrent users; 100 tabs polling notifications (jitter on/off); restart service while logged in; close/reopen conflict.

## Proposed provisional targets

| Metric | Desired target / interpretation |
|---|---|
| Availability | no OOM or crash during 15-minute steady test |
| RSS memory | under 400 MB observed peak to preserve headroom in 512 MB limit |
| HTTP failures | near zero; zero unexpected 5xx, zero unhandled locked DB errors |
| Read p95 | <500 ms under mixed browsing workload |
| Write p95 | <1 second under mixed workload; burst evaluated separately |
| Integrity | `PRAGMA integrity_check = ok`, no FK violations, no missing audit/event rows |
| CPU | no sustained saturation causing unbounded queue/latency |

If targets fail, **profile before changing tech stacks**: remove N+1 queries, fix indices, reduce template work, tune poll interval, shorten transactions, lighten dashboard aggregation. If still short of budget, report measured RAM/CPU and request explicit budget approval; do not delete security and core capabilities.

## Evidence log

Record script version, commit hash, Railway instance limits, user count, dataset volume, request distribution, p50/p95/p99, throughput, 409 count, 429 count, 5xx count, lock errors, memory/RSS peak, CPU and query plans. Add results to `STATUS.md` with actual command output/graphs.
