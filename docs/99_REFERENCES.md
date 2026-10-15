# 99 — Official implementation references

**Checked 2026-10-13.** These are authoritative starting points, not frozen API signatures. Tool/package versions can change. A coding agent should inspect installed versions and their current docs before integrating.

## Kage MCP

- [Kage MCP setup](https://kage.design/mcp-setup) — endpoint `https://kage.design/mcp`, official OpenCode/Claude/Codex/Cursor setup, tools `design_brief`, `search_designs`, `get_design`, `get_component`, `list_taxonomy`, `design_like` prompt; no key/account required.

## Better Auth

- [Better Auth SQLite](https://better-auth.com/docs/adapters/sqlite) — `better-sqlite3` support, auth CLI migrations.
- [Better Auth Fastify integration](https://better-auth.com/docs/integrations/fastify) — auth handler, headers, sessions.
- [Better Auth Admin plugin](https://better-auth.com/docs/plugins/admin) — provision and administrate accounts, bootstrap admin CLI.
- [Better Auth options](https://better-auth.com/docs/reference/options) — email-password `disableSignUp`, verification/reset settings.
- [Better Auth sessions](https://better-auth.com/docs/concepts/session-management) — cookie sessions, expiry/revocation.

## Fastify / views / CSS

- [Fastify schemas / validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/) — validation, serialization, content types.
- [Fastify view EJS engine](https://github.com/fastify/point-of-view) — EJS and layouts.
- [Tailwind CLI](https://tailwindcss.com/docs/installation/tailwind-cli) — compile static CSS with `@tailwindcss/cli`.
- [HTMX documentation](https://htmx.org/docs/) — server HTML interaction patterns.

## Railway

- [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles) — automatic root Dockerfile detection.
- [Railway start commands](https://docs.railway.com/deployments/start-command) — Dockerfile CMD vs Railway overrides.
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — official driver, Node 24 support and native addon build.
- [Railway volumes](https://docs.railway.com/volumes) — runtime mount path; unavailable at build/pre-deploy.
- [Railway volume reference](https://docs.railway.com/volumes/reference) — 1 volume/service, no replicas, redeploy downtime, plan limits.
- [Railway volume backups](https://docs.railway.com/volumes/backups) — daily/weekly/monthly schedule, caveats.
- [Railway infrastructure basics](https://docs.railway.com/overview/the-basics) — service deployment, metrics, networking.

## SQLite

- [SQLite WAL](https://www.sqlite.org/wal.html) — one writer, concurrent readers, WAL constraints.
- [SQLite online backup API](https://www.sqlite.org/backup.html) — safe consistent live SQLite backup.
- [SQLite FTS5](https://www.sqlite.org/fts5.html) — full-text external-content tables/triggers.

## Security and tests

- [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [k6 documentation](https://grafana.com/docs/k6/latest/)

## Citation and provenance rule

When code or behavior depends on an API or hosting feature, record the **documentation URL, current installed version, exact command output and observed result** in work logs. Do not copy unverified example snippets as proof a deployment or benchmark succeeded.
