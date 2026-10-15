# 13 — Definition of done (release gate)

A task is "done" when code, tests and evidence exist. The project is production-ready only when **all critical items below are verified**; merely implementing visible buttons is insufficient.

## Core function

- [ ] Active staff login/logout, correct authorization scope, disabled accounts blocked.
- [ ] Admin can provision/deactivate users, manage teams/roles and bootstrap admin safely.
- [ ] New ticket can assign to another active employee; assignment notification generated.
- [ ] User can view created/assigned/team tickets, filter, paginate, search.
- [ ] Assignee can start/block/resume and resolve with **all three required texts**.
- [ ] Creator can close resolved ticket, not unresolved ticket; creator-assignee self-close works.
- [ ] Manager/admin override permission behaves exactly as documented.
- [ ] Reopen stores reason, retains history, requires new resolution before closing again.
- [ ] Comments, internal notes, watchers and attached files render only to authorized users.
- [ ] Audit event and notification exist for each critical transition.
- [ ] Dashboard, overdue counts and export do not reveal restricted tickets.

## Safety and integrity

- [ ] Session/CSRF enforced across normal forms, HTMX and API calls.
- [ ] Authorization tests cover every endpoint and role; forged IDs/fields cannot escalate access.
- [ ] Script injections escaped, file traversal rejected, XSS/SQL injection tests pass.
- [ ] SQLite FK, FTS5 synchronization, transaction rollback and version conflict tests pass.
- [ ] No secrets or production content committed; error logs redact sensitive data.
- [ ] No database/attachment files served as public static assets.

## Visual and usability

- [ ] Actual Kage reference responses captured, or explicit owner-approved alternative (no fabricated calls).
- [ ] Original design guide and desktop/mobile screenshots available.
- [ ] Functional responsive view at 390px and 1440px; keyboard/focus/form validation checked.
- [ ] Loading/empty/error/permission/conflict states have coherent UX.
- [ ] Critical forms support non-JS path or clearly documented verified equivalent.

## Reliability / performance

- [ ] Production container builds with pinned packages and Node 24.
- [ ] Railway uses only one app service and one persistent volume at `/data`.
- [ ] Real SQLite file and uploads persist through **redeploy**.
- [ ] Railway scheduled volume backups enabled; independent SQLite consistent backup and restore rehearsed.
- [ ] Target 100-user realistic load and burst tests run, metrics recorded (not guessed).
- [ ] No OOM, unexpected 5xx or SQLite lock errors under the agreed workload.
- [ ] Migration failure is detected; documented recovery procedure exercised on test copy.

## Release records

- [ ] `STATUS.md` contains final test report, limits, architecture/deployment version, open issues.
- [ ] `docs/15_DECISIONS.md` records deviations and owner sign-off.
- [ ] Admin/operational runbook has verified restore and offboarding steps.
- [ ] Release explicitly approved by owner.
