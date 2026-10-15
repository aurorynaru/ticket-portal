# 05 — Page, action, and HTMX route contracts

## UI architecture

Use EJS templates with escaped interpolation `<%= value %>` by default. `@fastify/view` renders a complete page for normal browser requests and a small HTML fragment for valid HTMX requests (`HX-Request: true`). The HX header only selects rendering mode; it is **not** an authentication or authorization factor.

- `GET` never mutates state.
- State changes use `POST` with a CSRF token; standard HTML forms work without JS.
- Use a valid PRG (POST/Redirect/GET) pattern for normal form submissions; return fragment or `HX-Redirect`/`HX-Trigger` as appropriate for HTMX.
- Require `Content-Type` validation and server-side parsed schema validation. Reject unknown sensitive fields (creator, role, arbitrary status, etc.).
- EJS templates are private server-rendered content and require `Cache-Control: private, no-store` where personal data is present.

## Auth routes

| Method | Path | Behavior |
|---|---|---|
| GET | `/login` | anonymous login view |
| GET | `/forgot-password` | request reset form |
| GET | `/reset-password` | verified reset form |
| GET/POST | `/api/auth/*` | Better Auth official handler; browser client routes |
| POST | `/logout` | Better Auth sign out then redirect; CSRF-protected if app-owned |

For password auth forms, use the official Better Auth client API through a **small client-side JavaScript file** (one page script is acceptable), or a secure server adapter carefully forwarding all Better Auth response cookies and errors. Do not try to make HTMX magically replace Better Auth's body/cookie protocol without verifying it.

## Screen routes

| Method | Path | Content / access |
|---|---|---|
| GET | `/` | Redirect dashboard/login |
| GET | `/dashboard` | status counters, my assigned, overdue; auth |
| GET | `/tickets` | paginated list, GET filters; auth |
| GET | `/tickets/new` | create form; allowed creators |
| GET | `/tickets/:id` | full detail + worklog/timeline; canRead |
| GET | `/tickets/:id/edit` | edit form; canEdit |
| GET | `/my/created` | filtered tickets by creator |
| GET | `/my/assigned` | filtered tickets by assignee |
| GET | `/teams/:id/tickets` | scoped team tickets |
| GET | `/notifications` | user's notifications only |
| GET | `/search` | FTS + filters, scoped results |
| GET | `/reports` | permitted summary counts and exports |
| GET | `/admin/users` | admin-only user list |
| GET | `/admin/teams` | admin-only team/category config |

## Mutation routes

| Method | Path | Authorized command |
|---|---|---|
| POST | `/tickets` | create optional assignment |
| POST | `/tickets/:id/edit` | editable properties, optimistic version |
| POST | `/tickets/:id/assign` | assign/reassign |
| POST | `/tickets/:id/start` | state transition |
| POST | `/tickets/:id/block` | work blocked with reason |
| POST | `/tickets/:id/unblock` | resume |
| POST | `/tickets/:id/resolve` | structured issue/actions/resolution |
| POST | `/tickets/:id/close` | creator/manager/admin only after resolve |
| POST | `/tickets/:id/reopen` | reason required, per policy |
| POST | `/tickets/:id/comments` | comment or internal note |
| POST | `/tickets/:id/watch` | add/remove self or manager-managed watchers |
| POST | `/tickets/:id/attachments` | multipart attachment upload |
| GET | `/attachments/:attachmentId/download` | secure, authorized streaming |
| POST | `/notifications/:id/read` | mark own notification read |
| POST | `/admin/users` | admin provisions a user through supported Better Auth APIs |
| POST | `/admin/users/:id/access` | admin change active/role, revoke as required |

No unconstrained PATCH/PUT `status` endpoint. Every state change goes through its named command to prevent skipping mandatory resolution. Ticket number is human-facing; route `id` can be UUID. UI can expose `/t/TKT-000123` lookup that maps to an authorized internal ID.

## HTMX interaction patterns

- List filters: `<form hx-get="/tickets" hx-target="#ticket-results" hx-push-url="true">` and a normal `action`/`method="get"` fallback.
- Assignment dialog: HTMX GET renders form from authorized context, POST validates and returns assignment row/timeline fragments.
- Add comment: form submit -> append comment, event row and count badge; ensure errors preserve data.
- Notification polling: `hx-get="/notifications/unread" hx-trigger="every 45s"` activated only while document is visible (small JS visibility controller); server verifies current user and returns a tiny fragment.
- Mark resolve: normal form request + HTMX error partial; CSRF token included.

## Common HTTP and error contract

| Condition | Response |
|---|---|
| Missing session | 401 to API, login redirect or `HX-Redirect` to HTMX |
| Not permitted to see ticket | 404 to prevent existence leakage |
| Known forbidden action | 403 |
| Duplicate/stale `version` | 409 + safe reload instruction |
| Bad form/body / invalid transition | 422 + inline validation errors |
| Rate limited | 429 + `Retry-After` |
| Unexpected DB/I/O error | 500 + non-sensitive request ID, server error log |

## Minimum form validation

Title 3–200 chars, description 1–20,000, comment 1–10,000, assignment to active user, allowed enumerations only, valid date/time and supported timezone, attachment MIME/size verified, no editable `created_by` from client. Trim normalized fields before database use. Validate routes as well as service functions; never bypass service guards from admin/CLI jobs.
