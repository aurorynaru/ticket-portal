# 08 — Search, notifications, attachments, and reporting

## Search and filters

- SQLite FTS5 on ticket title and description via triggers as defined in `02_DATABASE.md`.
- Filter by assignee, creator, team, status, type, priority, overdue, due range, updated date.
- All queries must enforce `canReadTicket` equivalent **at SQL query level**, not filter results after full page retrieval. Search results include only visible tickets and safe snippets.
- Bound parameters for all structured filters. Bound and limit FTS query input to avoid SQL injection, runaway prefix queries, malformed MATCH, and expensive huge OR expressions.
- Page size 25 default / 100 max; bounded sort whitelist (`updated_at`, `due_at`, `priority`, `ticket_no`) and stable secondary `id`.
- Optional resolution text search only after adding its own secured FTS index and tests; v1 base FTS indexes title and description.

## In-app notifications

Create notification row inside transaction when a ticket is assigned/reassigned, resolved, closed, reopened or mentioned (mention feature later). Skip notifying actor when they are the recipient unless explicitly useful. For each recipient, verify permission at **time of reading**; notifications may need redaction after reassign/restriction.

Endpoints: `GET /notifications/unread` (fragment, count + top items), `GET /notifications`, `POST /notifications/:id/read` (recipient only).

Browser polls approximately every 45 seconds with **jitter and pause while hidden**. This is ~2.2 polls/second averaged across 100 always-visible users; do not poll all pages every five seconds. Index `(recipient_id, read_at, created_at)`. Use `ETag` or lightweight counts if needed after measurement.

## Email outbox (optional provider)

- A ticket transaction inserts `app_email_outbox` alongside notification. A bounded single-process scheduler picks due messages (`LIMIT 10`) and sends via configured external email API. Mark sent or back off exponentially on failure.
- Never send email in SQLite transaction; never store credentials or confidential issue descriptions in outbox payload.
- If no provider is configured, in-app notifications work, while email explicitly displays as disabled (not a pretend success).
- Do not enable multiple scheduler instances for one DB; only one Railway replica exists.
- Dead-letter after bounded retries, admin can inspect safely; queue state survives app restart.

## Attachments

- Store binary files at `/data/uploads/<random-uuid-or-hash>`; keep client filename **only as metadata**, never use client filename in disk path.
- Default per-file max: **10 MB**; allow image PNG/JPEG/WebP, plain text, PDF and supported log/text types; exclude executable/script uploads by default. Limit number per ticket and total request bytes (e.g., 5 files / 30 MB request).
- Stream files to a temp directory **within `/data`**, compute hash, verify actual file type/magic signature where possible, then atomic rename; store DB metadata. Implement orphan temp-file cleanup after failure or crash.
- Never serve uploads through `@fastify/static` or publicly exposed `/data`; all download/preview requires a fresh session + ticket visibility check. Sanitize `Content-Disposition`, enforce `X-Content-Type-Options: nosniff`, default download disposition for risky types.
- Use a randomized disk key, `path.resolve` containment, no symlink traversal, max request body limit and authenticated rate limit.
- Default off by policy: inline rendering of HTML/SVG uploads. Consider antivirus scanning as later operational upgrade if uploading external/untrusted files becomes common.
- Dashboard shows storage consumption; warn before volume reaches capacity.

## Dashboard and reports

Required cards: open, assigned, in progress, blocked, resolved, overdue. Additional: created by me, assigned to me, priorities, tickets by team, average resolution time (computed from `created_at` to latest resolution timestamp, clearly labeled), closed per date. Exclude unauthorized tickets **before aggregate**, not after counts are calculated.

Queries use covering indexes, max bounded time windows for reports; provide CSV export with formula-injection protection (prefix cells starting `=`, `+`, `-`, `@` as needed) and scoped exports. No separate analytics database or chart backend needed; render simple HTML/CSS charts or tiny client JS only when helpful.

## Admin workflows

- Active/inactive users; roles, team memberships; active categories.
- Deactivating a user must not delete their old comments/resolutions/events. Existing assignments remain visible with inactive label; admin/manager can reassign.
- Audit admin actions without storing reset tokens/passwords.
- Restrict report and export routes to the same visibility policy as page views.
