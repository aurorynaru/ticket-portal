# 00 — Product scope and user stories

## Product intent

Small internal (single company / single tenant) ticket and task management application supporting **up to 100 simultaneously active employees**. Optimize cost/resource use without removing core features. **No customer portal or multi-tenant isolation in v1.**

## Personas

- **Admin:** manage account lifecycle, global settings, categories/teams, all tickets and audit.
- **Manager:** manage tickets and assignments across their own team(s), oversee SLAs/reports.
- **User:** create tickets, assign to other active users, work on tickets assigned to them, resolve with documented steps, and close tickets they created once resolved.
- **Viewer:** inspect permitted tickets and dashboards, no mutation privileges.

## Ticket fields

Human readable `TKT-000001` identifier, title, description, kind (`TASK`, `INCIDENT`, `REQUEST`, `BUG`), category, team, priority (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`), status, creator, assignee, due date, timestamps, issue/resolution history, optional attachments, discussion, watchers and audit events.

## P0/P1 core user stories

- As an admin, I can bootstrap my own account, create/deactivate another account, reset access and assign proper privileges.
- As a user, I can log in/out and see only tickets I am permitted to view.
- As a user, I can create a ticket for myself or assign it to any **active** employee; assignee is notified.
- As a user, I can see "Created by Me", "Assigned to Me", and "Team Tickets".
- As an assignee, I can start work, add context, mark blocked, add comments and upload evidence.
- As an assignee, I can resolve my assigned ticket **only after** entering issue summary, action(s) performed, and resolution/outcome.
- As a creator, I can close my ticket only after resolution; if I was also assigned, I may resolve and close it.
- As an admin/manager in scope, I can override or reopen with a reason and auditable actor.
- As a colleague, I can search relevant tickets and resolution history.
- As an admin, I can see who changed assignment, status or critical fields, and when.

## Feature coverage (do not cut for resource reasons)

| Group | Included in first production release | Later enhancement |
|---|---|---|
| Identity | login/logout, reset password, admin-created users, RBAC | SSO, passkeys |
| Core | create/edit/assign/reassign, due dates, priority, categories, states | custom workflows |
| Resolution | structured issue/actions/outcome, close/reopen | resolution templates |
| Collaboration | comments, internal notes, attachments, watchers | mentions, parent-child dependencies |
| Discovery | paging/filtering, FTS search, saved query via URL | saved named filters |
| Alerts | in-app notifications, unread badge, email outbox optional | real-time push |
| Dashboard | open/assigned/overdue/status counts, basic reports | trend analytics, SLA automation |
| Admin | account roles, teams, categories, operational audit | integration/webhook manager |
| Productivity | export CSV, duplicate-link field | recurring tasks, knowledge base, APIs |

**Priority sequencing:** implement all first-production items phase by phase. Do not equate "later" with impossible; defer until core is secure/tested.

## Constraints and acceptance

- Responsive, keyboard usable, accessible contrast, no major page layout shifts.
- All times stored UTC, displayed in the signed-in user's timezone (initial default Asia/Manila).
- No data loss on reload/redeploy, including attachments and password reset state.
- At 100 active users, app remains responsive under target workload in `10_TESTING_LOAD.md`.
- Never require a separate running database, queue or frontend service.

## Non-goals

Billing, external multi-company tenancy, public customer registration, mobile native app, chatbot, AI ticket automation, on-prem HA cluster, offline-first PWA. Add only with separate approval.
