# 16 — Copy/paste prompts for a local implementation agent

Use these prompts in order. Each assumes the coding agent has **read repository `AGENTS.md`, `README.md`, `STATUS.md`, and specs**. The agent should not ask for approval between small reversible code changes, but must pause before irreversible production actions, secret/account setup, or unsupported MCP calls.

## Prompt 0 — Repository scaffold

> Read `AGENTS.md`, `README.md`, `STATUS.md`, and `docs/01_ARCHITECTURE.md`, `docs/02_DATABASE.md`, `docs/11_RAILWAY_DEPLOY.md`, `docs/12_PHASE_PLAN.md`. Implement **P0 only**: Node.js 24 TypeScript strict Fastify, EJS, HTMX local assets, compiled Tailwind, dev/build/start scripts, error mapper, live/readiness checks, SQLite open/config/versioned migration runner, and validate the **provided root Dockerfile** following `docs/17_DOCKER_IMPLEMENTATION.md`. Do not include unrelated features or SPA frameworks. Run typecheck/build and a restart-persistence smoke test. Update STATUS with exact commands and results. Report next task.

## Prompt 1 — Authentication + permissions

> Implement **P1 only**, using `docs/03_AUTH_RBAC.md` and `docs/09_SECURITY.md`. Check latest Better Auth SQLite/Fastify/Admin plugin docs. Migrate auth schema using approved CLI, disable public sign-up, provide first-admin bootstrap instructions, working login/logout/reset, app profiles, effective role resolver and admin account UI. Add CSRF/session/rate-limit safeguards and authorization tests for all roles. Don't manually create Better Auth credential tables. Run tests, update STATUS, show evidence.

## Prompt 2 — Ticket engine and correctness

> Implement **P2 only** from `docs/02_DATABASE.md` and `docs/04_TICKET_WORKFLOWS.md`. Add ticket creation, assignment, reads/list with visibility, edits with optimistic versions, named status transitions, mandatory resolution documentation, creator close, reopen, comments, private notes, watchers, immutable events and notifications. Every ticket state change must be transactional. Implement positive and negative integration tests and correct any mismatches. Update STATUS with outputs and current DB migration ID.

## Prompt 3 — Kage design and UI

> Implement **P3 only**. First read `docs/06_KAGE_MCP_DESIGN.md`, connect verified Kage MCP, obtain actual `design_brief` and design/component refs and create `design/STYLE_GUIDE.md`. Then build responsive EJS + HTMX pages in `docs/07_UI_SPEC.md`. All button visibility and server guards must align with `docs/03_AUTH_RBAC.md`. Test desktop/mobile, keyboard interactions and no-JS core forms. Capture original app screenshots and reference provenance; don't claim Kage calls that didn't run. Update STATUS.

## Prompt 4 — Search/files/notifications/dashboard

> Implement **P4 only** using `docs/08_FEATURE_SERVICES.md`. Add indexed FTS5 with correct trigger synchronization, visibility-safe filtering and pagination; secure streamed uploads/downloads on `/data`; SQLite-backed notification polling; optional email outbox; scoped dashboard and CSV. Test content access, filenames, size limits, search injection, and notification ownership. Update STATUS with evidence.

## Prompt 5 — Security and E2E gate

> Implement **P5 only** from `docs/09_SECURITY.md`, `docs/10_TESTING_LOAD.md`, and `docs/13_DEFINITION_OF_DONE.md`. Build and execute role×route×object integration tests, CSRF/XSS/SQL/FTS/upload security probes, browser happy paths, concurrency conflict tests, migration rollback and restart checks. Do not mark tests passed without output. Fix failures and update STATUS.

## Prompt 6 — Railway staging and load

> Implement **P6 only**. Read `docs/11_RAILWAY_DEPLOY.md`, `docs/17_DOCKER_IMPLEMENTATION.md`, `docs/14_OPERATIONS.md`, `docs/10_TESTING_LOAD.md`. Prepare a deployment checklist; only deploy to user-authorized Railway staging. Verify volume `/data`, safe startup migrations, HTTPS auth/cookies, persisted attachments after redeploy, backups and independent restore rehearsal. Run realistic 100-user mixed and 100-write burst tests under 1 vCPU/512 MB. Report measured RSS/CPU/latency/errors and query plans; no performance guarantees without evidence. Update STATUS.

## Prompt 7 — Release acceptance

> Implement **P7 only**. Audit `docs/13_DEFINITION_OF_DONE.md`, `docs/15_DECISIONS.md` and STATUS. Write operator instructions, document deviations and risk, clean synthetic test data from release deployment only with approval, verify secrets and backups, and prepare owner sign-off. Do not claim production release without owner authorization.

## When a phase fails

> Stop the failing operation, preserve files/logs and user data. Report the exact error, commands already executed, whether any DB mutation occurred, affected acceptance check and the smallest safe next step. Avoid speculative dependency changes or changing stack choices. Resume only after a grounded fix or owner's guidance for an irreversible action.
