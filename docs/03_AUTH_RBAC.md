# 03 — Authentication and authorization design

## Identity implementation

- Better Auth with `better-sqlite3` database adapter and **Admin plugin** for controlled account provisioning. Follow current [SQLite docs](https://better-auth.com/docs/adapters/sqlite), [Fastify guide](https://better-auth.com/docs/integrations/fastify) and [Admin plugin docs](https://better-auth.com/docs/plugins/admin).
- Email/password sign-in; **disable public signup** (`emailAndPassword.disableSignUp: true`); require strong passwords, secure session cookies, password reset flow and email verification if configured.
- Configure `BETTER_AUTH_SECRET` (high entropy) and `BETTER_AUTH_URL` (exact public HTTPS origin). Restrict trusted origins. Site is same-origin; **do not enable broad wildcard CORS**.
- Admin plugin: bootstrap the first administrator using the **current official CLI** after auth tables migrate. Other users are created by admin-only management UI or explicit admin-controlled invitations. Never expose self-service role changes.
- Better Auth `GET/POST /api/auth/*` mounted using the official Fastify request/response adapter, forwarding `Set-Cookie` headers correctly and preserving content-type/body semantics. Verify login/logout/reset with actual browser requests; do not assume a JSON-only adapter handles form-encoded POSTs.
- Use `auth.api.getSession({ headers: fromNodeHeaders(req.headers) })` on protected routes; cache per request, not globally. Don't treat an HTMX request or a cookie's presence alone as authenticated.

## Effective role source of truth

Better Auth Admin plugin provides a trusted `user.role` of `admin` or `user`. The application stores non-admin `access_level` of `manager`, `user`, or `viewer` in `app_user_profiles`.

- **Effective admin**: Better Auth `user.role` says admin AND profile is active. Only this role can use Better Auth admin account APIs.
- **Other effective roles**: auth user not admin; `app_user_profiles.access_level` is manager/user/viewer, and profile active.
- A missing, inactive or inconsistent profile **denies access** to application routes. Guard exposed Better Auth Admin plugin endpoints against disabled users as well: ban/revoke using the plugin when deactivating and verify its own endpoint enforcement with integration tests. Never promote via a client-supplied role field.
- Admin demotion: perform official Better Auth role change **first**, then update domain profile; revoke sessions and audit the operation. Promotion: require an already-authorized admin, update auth role with official API, revoke stale sessions and log. Document and test partial failure recovery. Do not implement a second independent admin flag.

## Ticket visibility rules

For non-admin users, a ticket is readable when at least one holds:

1. User is the creator or current assignee.
2. User is a watcher explicitly added by a permitted actor.
3. `visibility='TEAM'` and the user belongs to `ticket.team_id`.
4. User is a manager of the ticket's team.

`RESTRICTED` ignores normal team-member visibility; creator, assignee, explicit watcher, or admin can read (manager requires explicit assignment/participation unless admin). Non-participants get 404, not ticket metadata. Views must avoid leaking results via search, notifications, counters or download URLs.

## Core permission matrix

| Operation | Admin | Manager | User | Viewer |
|---|---|---|---|---|
| List/read | all | in visibility scope | in visibility scope | in visibility scope |
| Create ticket | yes | yes | yes | no |
| Assign on create | any active | any active | any active | no |
| Reassign existing | any | own team tickets / creator / assignee | creator or current assignee | no |
| Edit title/description/priority | any | own team tickets | creator (before CLOSED) | no |
| Start / block work | any | team tickets | current assignee | no |
| Add normal comment | any readable | any readable | any readable | no |
| Add internal note | any readable | any readable | readable and participant | no |
| Resolve | any | team tickets | current assignee | no |
| Close after resolution | any | team tickets | creator (including self-assigned) | no |
| Reopen with reason | any | team tickets | creator or current assignee | no |
| Create/edit categories and accounts | yes | no | no | no |
| View global audit / change roles | yes | no | no | no |

Where table says "own team tickets", require user belongs to that team **and** the team-manager policy resolves correctly; manager rights do not automatically grant access to unrelated RESTRICTED tickets.

## Cross-team assignment

A ticket creator may select any **active internal user** regardless of team. This grants the assignee participant access by identity. If reassigned, previous assignee loses participant access unless also creator, watcher or team member. Audit retains their historical name/id. UI clearly indicates the owning team and who will see the ticket.

## Guards and error semantics

- `401`: no valid session; redirect full-page requests to login, HTMX may use a controlled redirect response.
- `403`: authenticated but lacks permission for a known general action (e.g. creating as viewer).
- `404`: ticket unreadable, absent, or concealed; prevents enumeration.
- `409`: state/version conflict; offer reload and show current state.
- `422`: validated but invalid input/transition, retain submitted form values.

## Critical security tests

Test role × route × ticket visibility matrix, restricted ticket ID guessing, forged assignee/creator fields, session revocation after ban/demotion, CSRF on every POST, malformed JSON/form/HTMX requests, attachment path traversal, and user offboarding after authored tickets exist.
