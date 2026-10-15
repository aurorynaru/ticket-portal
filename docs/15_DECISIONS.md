# 15 — Decisions, assumptions and change control

## Fixed decisions (owner-selected)

| Area | Choice | Reason |
|---|---|---|
| Capacity | up to 100 concurrent users | small internal app |
| Deployment | Railway **Dockerfile-based** one application service + volume | reproducible build; cost / operations |
| App language/runtime | TypeScript / Node.js 24 LTS | user preferred JS ecosystem |
| Framework | Fastify | low overhead |
| UI | EJS HTML + HTMX | no SPA runtime |
| Styles | compiled Tailwind | static CSS in production |
| DB | SQLite / better-sqlite3 / FTS5 | no DB service |
| Auth | Better Auth | avoid building auth subsystem |
| Authorization | custom server-side RBAC | ticket ownership/visibility |
| Notifications | SQLite + periodic polling | avoid Redis/WebSockets |
| Storage | Railway volume | persist DB and uploads |
| Design references | Kage MCP | user selected design source |

## Implementation defaults (change only with written decision)

- Single tenant, internal employees only; no public self-registration.
- Roles: admin, manager, user, viewer.
- Any active user can receive an assigned new ticket. Existing reassign requires creator/current assignee/manager/admin per scope.
- Visibility: TEAM by default, RESTRICTED available; creator, assignee and explicitly permitted watcher retain access.
- Assignee resolves; creator closes after resolved; manager/admin can override where in scope; creator-assignee may do both.
- Three required resolution fields: issue, actions taken, outcome. Reopen requires reason and another resolution before closure.
- Date storage UTC epoch milliseconds; display timezone from profile (default Asia/Manila).
- Default attachment max 10 MB; type allowlist and private authenticated downloads.
- In-app notification polling 45 seconds with jitter/visibility pause.
- Initial limit: 1 vCPU, **512 MB** (not 256 MB until benchmark evidence); one replica.
- Basic email/password reset needs a configured email provider to send recovery links; admin-assisted alternative if disabled.
- Include all P0–P7 release features from scope; later enhancements require separate change requests.

## Decisions to validate while implementing (not blockers to P0)

| Question | Initial safe default | When to revisit |
|---|---|---|
| Team visibility vs company-wide | TEAM, explicit RESTRICTED | if staff should see all company tickets |
| Managers on RESTRICTED ticket | only if also participant; admin always | if managers need all confidential team tickets |
| Email provider | optional for in-app only; configure for self-service password reset | P1 / production setup |
| File storage growth | 10MB/file, monitor quota | after actual usage measured |
| Password session length | Better Auth documented defaults, require secure cookies | security review P5 |
| Status modifications after closed | immutable except reopen/admin correction | owner workflow feedback |
| CSV/report visibility | identical to ticket read policy | P4 verification |
| Default categories | task, bug, incident, request | admin configuration |

## Change request template

```text
Decision ID/date:
Requested difference:
User impact / rationale:
Resource impact (RAM/CPU/storage):
Security/data impact:
Migration/rollback plan:
Approved by:
Files and tests updated:
```

Do not insert a new service, SPA, ORM, data store or new third-party platform merely for convenience without approval.
