# 01 — Technical architecture

## Single-process request path

```text
browser (EJS HTML + CSS + HTMX)
  -> HTTPS / Railway proxy
  -> one Fastify Node 24 process
       -> Better Auth sessions + app RBAC
       -> ticket/comment/admin/domain services
       -> synchronous short SQLite statements, `better-sqlite3`
       -> EJS full page or small HTMX partial
       -> authorized attachment streaming
  -> /data/tickets.db, /data/uploads/* on one mounted Railway volume
```

SQLite is embedded: it is **not** a separate Railway database service. Notifications, job state and FTS live in the same DB. Optional external email is invoked using an outbox with retry; failure does not roll back the ticket transaction.

## Dependencies (lean baseline)

Runtime: `fastify`, `@fastify/view`, `ejs`, `@fastify/static`, `@fastify/formbody`, `@fastify/multipart`, `@fastify/helmet`, `@fastify/rate-limit`, `better-auth`, `better-sqlite3`, `zod` (for input/env validation), `htmx.org` as local asset if convenient.

Dev: TypeScript, `tsx` (local runner), `@types/node`, `@types/better-sqlite3`, `@types/ejs`, Tailwind CSS v4 + `@tailwindcss/cli`, test runner `vitest`, Playwright optional for browser E2E, `k6`/`autocannon` for load testing. Check current Fastify plugin compatibility and pin tested versions. Avoid ORM/GraphQL/state-management layers in v1.

## Build and runtime

- ESM (`type: module`, TypeScript `NodeNext`); compiled JS via `tsc` into **`dist/server.js`**, **no TypeScript runtime needed in production**. Use the included root Dockerfile and `docs/17_DOCKER_IMPLEMENTATION.md`.
- `src/views` EJS templates are copied into the production image and resolved with an absolute application-root path; not emitted by TypeScript compiler.
- `src/styles/input.css` compiled to `public/assets/app.css` with `@tailwindcss/cli`, minified in build. Host static HTMX JS locally.
- Run DB bootstrap and **versioned migrations at process start**, before `/health/ready` returns 200.
- Listen on `0.0.0.0:${PORT}`; readiness checks DB readability and migration completion.
- Shut down gracefully; stop accepting new HTTP, finish in-flight requests, close DB handle, do not interrupt file transfers midway without clear client error.

## Recommended modules and ownership

| Module | Responsibility | Prohibited shortcuts |
|---|---|---|
| config | validated env, absolute paths | undocumented defaults in prod |
| db | one DB handle, pragmas, migrations, transactions, indexes | interpolated SQL strings |
| auth | Better Auth adapter, session extraction, account admin | hand-coded auth cookies |
| policy | role resolver, canRead/canWrite/canTransition | role checks only in templates |
| tickets | transitions + validation + events in one transaction | update with no audit |
| comments | comment and visibility | unrestricted private notes |
| attachments | upload metadata/files, authorized download | static public uploads |
| notifications | DB queue, polling, optional email outbox | fire-and-forget inside SQL transaction |
| search | indexed filters + FTS5 | SELECT * on every refresh |
| dashboard | small aggregation queries | full database scan per request |

## SQLite settings

```sql
PRAGMA journal_mode = WAL;       -- database-level setting, initialize on startup
PRAGMA busy_timeout = 5000;      -- per connection
PRAGMA foreign_keys = ON;        -- per connection
```

Use a **single shared `better-sqlite3` DB handle per Node process**, prepare statements and bound parameters. Do not enable immutable/read-only URI tricks for normal writes. Keep transactions free of `await`, external HTTP and file copies. Monitor WAL size; checkpoint outside peak usage if required.

## Performance design boundaries

- Ticket lists default 25 rows, max 100, indexed filters, cursor pagination preferred for growing datasets.
- Debounce search; FTS query tokenization and length guard.
- Notification poll 30–60s only when tab visible; jitter intervals to reduce spikes.
- HTTP static assets cache appropriately; cache HTML as private/no-store for user data.
- Avoid repeatedly rendering large dashboard aggregation in every HTMX fragment; cache short-term in process only if measured necessary.
- File uploads streamed with bounded limits; never buffer multi-megabyte payloads in memory.

## Reliability constraints

One app replica + volume. SQLite locking assumed to work on target Railway filesystem; validate with load tests and integrity checks. Deployments of volume-attached service have brief downtime. Local DB data must survive restart, app crash, and image replacement. No zero-downtime or HA promise.
