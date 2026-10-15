# 09 — Security threat model and acceptance gates

## Assets and threats

Protect passwords, authentication sessions, personally identifying data, ticket contents, internal investigation notes, screenshots/logs, and audit evidence. Threats include ID enumeration, cross-role permission bypass, CSRF, XSS through comments/descriptions, SQL/FTS injection, password stuffing, exposed uploads, malicious filenames, privilege escalation, file system compromise and accidental production data loss.

## Minimum hardening controls

### Identity and sessions

- Delegate password hashing, session lifecycle, verification/reset and admin creation to Better Auth. **Do not invent hashing schemes** or read/write Better Auth credential records manually.
- Disable open registration. Provision with admin privilege; support secure password reset through a configured mail provider. If email isn't configured, clearly label self-service reset unavailable and provide a secure **admin-supported process**, not an insecure URL.
- Set HTTPS-only/Secure cookies in production, HttpOnly, SameSite Lax or Strict as appropriate, short session max age chosen intentionally, session revocation on ban/password reset/privilege change.
- Throttle login, password reset, admin changes and ticket mutations with `@fastify/rate-limit` plus Better Auth's rate-limit mechanisms. Verify SQLite-backed/cookie constraints in one-process setup.
- One active admin must remain: prevent accidental disable/demotion of the last active administrator.

### Authorization and query isolation

- Authenticate **every** ticket-detail, download, search, dashboard, comment, and mutation route; enforce scoped predicate in DB query or equivalent policy validated before returning data.
- Never accept `created_by`, `resolved_by`, `actor_id`, `role`, `is_active` directly from untrusted user input; derive actor from validated session.
- For restricted tickets, return 404 to unauthorized readers. Do not expose restricted title in notifications or report counts.
- Verify assignee still active, current role and ownership at transaction time, not only when rendering button.

### CSRF, XSS, templates

- Protect app-owned state-changing routes with session-bound CSRF token or current-session origin-checked double-submit pattern; test regular HTML and HTMX submissions. SameSite alone is **not** a substitute for CSRF defense.
- Better Auth auth endpoints must use its documented CSRF/origin protections; **do not disable them** to resolve form integration errors.
- EJS defaults to escaped `<%= ... %>` for untrusted values; never render raw user HTML via `<%- ... %>` except trusted, reviewed partial markup. If Markdown comments are later supported, sanitize carefully before rendering.
- Apply `@fastify/helmet` headers, secure CSP allowing the local HTMX/auth scripts without `unsafe-inline` where possible; use nonces or external JS. Set nosniff, referrer policy, frame controls, strict HTTPS.

### Validation / SQL / uploads

- Parameterize all SQL; whitelist dynamic ORDER BY fields. Sanitize FTS queries and enforce max query complexity and length.
- Validate types/length/ids/enums, upload size/MIME/signature and count **server-side**. Limit JSON/form bodies. Avoid error traces exposed to browsers.
- Upload random storage keys; protect file access by verified DB metadata + ticket policy. Reject traversal, encoded dot segments, symlink escapes and public static exposure. Store files outside web root.
- Use UUIDs internally but **do not rely on unguessable IDs as authorization**.

### Secrets and deployment

- `BETTER_AUTH_SECRET`, provider secrets and administrative tokens only in Railway secrets/env, never `.env` in Git, HTML template or client bundle.
- `DATABASE_PATH` absolute path. Fail fast if production `/data` missing/unwritable; never silently create production DB in ephemeral working directory.
- Retain minimal logs; redact cookies, passwords, reset URLs/tokens and sensitive header values. Request IDs on errors.
- Backups encrypted/access-controlled as appropriate; periodically test restore on a separate local/staging copy.

## Required negative tests

1. Anonymous GET ticket/comment/attachment/search -> redirect/401.
2. Viewer attempting create/assign/resolve/close -> rejected.
3. User reads RESTRICTED ticket without participation -> 404.
4. Ex-assignee uses old form to resolve/reassign -> rejected, no side effects.
5. User changes `created_by` or `role` via form -> server ignores/rejects.
6. Cross-site forged POST with no/bad CSRF token -> 403, no mutation.
7. `<script>` placed in title/comment/filename -> escaped, never runs.
8. Upload `../secret.txt`, SVG/HTML or huge files -> safe rejection or forced non-executable download.
9. FTS expression injection / wildcard abuse -> bounded error, no SQL execution.
10. Two concurrent updates to same ticket version -> no lost update.
11. Disable admin or member -> old sessions cannot access privileged routes after required revocation.
12. Partial failure of email/API during transition -> ticket transaction remains correct, outbox retries.

No release until these pass on real HTTP/browser flows as well as unit tests.
