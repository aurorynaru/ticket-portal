# Lightweight Ticketing System — Local LLM Implementation Kit

**Version:** 1.1 — Docker-first Railway deployment | **Prepared:** 2026-10-13 | **Audience:** A local coding LLM, developer, or coding agent

## Mission

Build a secure, pleasant-to-use internal ticketing application for **up to 100 concurrent users** on **one Railway application service**, **1 vCPU**, a starting **512 MB RAM budget**, and **one Railway persistent volume** containing SQLite and private attachments.

All main features remain in scope. Optimize architecture and queries rather than deleting important user features. **This kit is an implementation specification and agent playbook, not implemented source code.**

## Frozen stack

- Language: TypeScript, strict mode; Node.js 24 LTS, ESM.
- Server: Fastify in one process; no separate frontend server.
- UI: Fastify `@fastify/view` + EJS server-side templates + HTMX (local production assets), with small vanilla JavaScript only where needed.
- Styling: Tailwind CSS, built and minified for production; no runtime CDN.
- Database: SQLite, `better-sqlite3`, WAL, FTS5, application-owned migrations.
- Authentication: Better Auth, SQLite adapter, Admin plugin for controlled account provisioning.
- Authorization: custom server-side RBAC + ticket visibility, ownership, and workflow policies.
- Notifications: SQLite in-app queue + browser polling; optional email outbox (external provider only if configured).
- Attachments: private local files on a Railway persistent volume.
- Deployment: **Dockerfile-first** single Railway service + volume, Docker multi-stage build, single replica. Root-level `Dockerfile` and `.dockerignore` templates are included; no Railpack dependency.
- Visual design references: **Kage MCP** (`https://kage.design/mcp`), following `docs/06_KAGE_MCP_DESIGN.md`.

## Read in this order

1. `AGENTS.md` — mandatory operating constraints and execution loop.
2. `STATUS.md` — current phase and evidence tracker.
3. `docs/00_PRODUCT_SCOPE.md` — audience, requirements, rules, priorities.
4. `docs/01_ARCHITECTURE.md` — modules, paths, runtime and stack.
5. `docs/02_DATABASE.md` — authoritative application data model.
6. `docs/03_AUTH_RBAC.md` — identity and permission decisions.
7. `docs/04_TICKET_WORKFLOWS.md` — state transitions and resolution semantics.
8. `docs/05_ROUTES_HTMX.md` — contract for pages, actions and HTMX.
9. `docs/06_KAGE_MCP_DESIGN.md` — install Kage and create original design briefs.
10. `docs/07_UI_SPEC.md` — pages/components/accessibility.
11. `docs/08_FEATURE_SERVICES.md` — notifications, files, search, dashboards.
12. `docs/09_SECURITY.md` — threat model and security gates.
13. `docs/10_TESTING_LOAD.md` — functional, authorization and 100-user tests.
14. `docs/11_RAILWAY_DEPLOY.md` — environment, volume, Docker and rollout.
    Also read `docs/17_DOCKER_IMPLEMENTATION.md` and use the supplied root-level `Dockerfile`, `.dockerignore`, and `.env.example`.
15. `docs/12_PHASE_PLAN.md` — implementation tickets and dependencies.
16. `docs/13_DEFINITION_OF_DONE.md` — release acceptance checklist.
17. `docs/14_OPERATIONS.md` — backup, recovery, incident procedures.
18. `docs/15_DECISIONS.md` — defaults and documented optional decisions.
19. `docs/16_AGENT_PROMPTS.md` — copy/paste tasks for each implementation phase.
20. `docs/99_REFERENCES.md` — original documentation sources.

## Docker files in this ZIP

The kit includes a **root-level `Dockerfile` and `.dockerignore`** so the coding agent can build a Docker-deployable app once it scaffolds source and `package-lock.json` in P0. The Dockerfile is **not runnable yet**, because this download contains the implementation instructions, not the application source. `docs/17_DOCKER_IMPLEMENTATION.md` describes the exact build/start contract and Railway setup.

## First instruction to your local coding agent

> Read `AGENTS.md`, `STATUS.md`, and all linked specs before coding. Follow the frozen stack. Begin at Phase 0 in `docs/12_PHASE_PLAN.md`, implement the supplied root-level `Dockerfile` contract, and smoke-test Docker locally before Railway. Implement one phase at a time, run its tests, collect evidence, and update `STATUS.md`. For UI work, connect Kage MCP and use actual returned design briefs and components; never claim a Kage call succeeded unless you received a response. Stop and report only when blocked by a truly essential secret, irreversible action, unavailable tool, or failed required gate.

## What success looks like

- Users can log in, be assigned tickets by colleagues, resolve their own assigned work with **issue / actions / resolution**, and authorized users can close or reopen tickets.
- Admins can provision/deactivate accounts; all permissions are enforced on the server.
- Search, comments, attachments, activity history, dashboard, and notifications work without external infrastructure.
- Test pass: **100 virtual users**, representative real workflows, memory and CPU observed on actual Railway limits, no unhandled SQLite lock failures.
- Database and attachments survive deploys; backup restoration has been rehearsed.

## Resource constraints — not promises

Start with **1 vCPU / 512 MB** and test; aim for <400 MB observed RSS peak to preserve headroom. **256 MB is an optimization experiment only after measured results**. Do not assume that 100 logged-in browsers equal 100 actively writing requests.

## Source freshness

Documents were checked against official sources on 2026-10-13. Before implementing integration-specific code, check the current Kage / Better Auth / Railway / Fastify docs referenced in `docs/99_REFERENCES.md`; pin and record dependency versions in the lockfile. Do not invent or assume MCP tool outputs.
