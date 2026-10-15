# 12 — Phase-by-phase local LLM task execution plan

Complete phases in order; branch changes only with documented acceptance and tests. Every task has an observable result. Do not pretend that specification docs are code.

## P0 — Foundation / deployment skeleton

- [ ] P0.1 Scaffold Node 24 ESM strict TypeScript Fastify repo; dev and production scripts; Git ignore; health live/ready.
- [ ] P0.2 Register EJS rendering, local static assets, formbody, safe multipart limits, Helmet, request IDs, error mapper, optional dev logger.
- [ ] P0.3 Create `better-sqlite3` open function with absolute env path, WAL/busy timeout/FK, checked migration runner and schema version.
- [ ] P0.4 Pin dependency versions and lockfile, satisfy the **supplied root Dockerfile** layout/`npm run build` contract; run `docker build`, local volume-backed container smoke tests and data persistence after container recreation. See `docs/17_DOCKER_IMPLEMENTATION.md`.

**Gate P0:** `npm run build`, typecheck, `GET /health/live`, local SQLite persistence after process restart, migration test pass.

## P1 — Identity and authorization

- [ ] P1.1 Integrate Better Auth SQLite per official docs and its generated tables/migrations; mount `/api/auth/*` on Fastify.
- [ ] P1.2 Configure email/password, disable signup, secure reset/signout, Admin plugin and safe first-admin bootstrap command.
- [ ] P1.3 Implement app profile, effective role resolver, per-route session middleware, policy functions.
- [ ] P1.4 Admin user provisioning/deactivation and team membership; revoke sessions on privilege changes.
- [ ] P1.5 Security tests: unauthorized/read-only/user/admin boundaries, cookie handling, reset, CSRF.

**Gate P1:** admin and regular users log in/out, no public signup, viewer cannot mutate, missing profiles deny access.

## P2 — Ticket domain and transactions

- [ ] P2.1 Create schema, indexes, ticket number counter and seed categories in migration.
- [ ] P2.2 Create/list/detail ticket repositories; team/restricted visibility at SQL level.
- [ ] P2.3 Implement named transition commands, optimistic version checks, atomic events and notifications.
- [ ] P2.4 Comments, internal notes, watchers, resolution history, reopen/close rules.
- [ ] P2.5 Test all transitions, no-resolution close denial, race/concurrent writes, audit completeness.

**Gate P2:** automated A assigns B -> B documents issue/actions/solution -> A closes -> reopen/resolution again, no missing events or permissions bypass.

## P3 — Kage-driven UI (do not skip MCP)

- [ ] P3.1 Connect Kage MCP; record actual `design_brief`/`get_design`/component tool results or a specific blocker.
- [ ] P3.2 Write `design/STYLE_GUIDE.md` derived from source designs; implement layout, tokens, responsive nav.
- [ ] P3.3 Implement dashboard and ticket list/filter in EJS+HTMX with normal GET fallback.
- [ ] P3.4 Implement detail, create/edit/assign/resolve/close/reopen, comments and timeline; maintain accessible forms.
- [ ] P3.5 Capture desktop/mobile screenshots, do visual and keyboard/accessibility QA.

**Gate P3:** no SPA/runtime CSS dependency; all essential flows work in browser and with core no-JS form fallback; Kage provenance recorded.

## P4 — Supporting features

- [ ] P4.1 FTS5 triggers/backfill, scoped search/filter/pagination and index plans.
- [ ] P4.2 Secure streamed attachment upload/download, metadata/file consistency, cleanup.
- [ ] P4.3 In-app notification polling, unread count, recipient authorization, optional email outbox.
- [ ] P4.4 Dashboard/reports/CSV with scoped aggregations and no data leakage.
- [ ] P4.5 Admin screens for teams/categories, user active status and basic storage metrics.

**Gate P4:** search returns correct authorized results, notifications update, files remain private, no unbounded queries.

## P5 — Security, correctness, resilience

- [ ] P5.1 Full role/action/object matrix tests, CSRF/XSS/upload/SQL injection tests.
- [ ] P5.2 Check DB integrity, restart persistence, migration failure/rollback plan and orphan-file cleanup.
- [ ] P5.3 Run browser E2E with all required flows and error/empty/loading states.
- [ ] P5.4 Triage failures, pin patched libraries, audit logs/headers/secrets.

**Gate P5:** `09_SECURITY.md` negative tests pass; no high-severity open issues.

## P6 — Railway staging and load

- [ ] P6.1 Dockerfile-based Railway deployment (verify auto-detection, no conflicting start override), 1 service/replica, `/data` volume, public HTTPS, health and secrets.
- [ ] P6.2 Verify account, ticket, upload persist after **redeploy**, and restore a logical copy of DB.
- [ ] P6.3 Run representative 100-user steady and 100-write burst scenarios on **1 vCPU / 512 MB**.
- [ ] P6.4 Profile slow queries/CPU/memory; tune before requesting more RAM/CPU.
- [ ] P6.5 Set Railway daily/weekly backup schedule and document recovery drill.

**Gate P6:** written p95/RSS/CPU/error evidence and successful restart/recovery tests; targets either achieved or explicit accepted limitations.

## P7 — Release and handoff

- [ ] P7.1 Finish `13_DEFINITION_OF_DONE.md`, final user guide and admin runbook.
- [ ] P7.2 Validate no test data or secrets in prod; record actual deploy/revision.
- [ ] P7.3 Owner approves public release and risk acceptance; mark STATUS completed.

## Agent report format after EACH small task

```text
Task and commit:
Files changed:
Behavior implemented:
Test commands + summarized output:
Visual/Kage evidence if UI:
Security and DB migration impact:
Known issues / follow-up:
Next task:
```
