# 04 — Ticket lifecycle and business rules

## State graph

```text
OPEN --assign--> ASSIGNED --start--> IN_PROGRESS --resolve--> RESOLVED --close--> CLOSED
  |                 |                | ^                  |
  +--self start----> IN_PROGRESS <--unblock-- BLOCKED <--block--+
                    ^                                         |
                    +------------ reopen from RESOLVED/CLOSED-+
```

The status constants are `OPEN`, `ASSIGNED`, `IN_PROGRESS`, `BLOCKED`, `RESOLVED`, `CLOSED`. `REOPENED` is an **audit event**, not a permanent status; it transitions to `ASSIGNED` if an assignee exists or `OPEN` otherwise (or optionally `IN_PROGRESS` if an assignee explicitly resumes; choose simple default `ASSIGNED`).

## Allowed transitions

| Command | From | To | Allowed actor | Required data |
|---|---|---|---|---|
| create | none | OPEN or ASSIGNED | admin/manager/user | title, description, type, team, assignee optional |
| assign/reassign | OPEN, ASSIGNED, IN_PROGRESS, BLOCKED | ASSIGNED if previously OPEN; otherwise preserve work status | per RBAC | active assignee, version |
| start | ASSIGNED, BLOCKED | IN_PROGRESS | assignee, manager/team, admin | version; optional note |
| block | ASSIGNED, IN_PROGRESS | BLOCKED | assignee, manager/team, admin | reason non-empty |
| unblock | BLOCKED | IN_PROGRESS | assignee, manager/team, admin | version |
| resolve | ASSIGNED, IN_PROGRESS, BLOCKED | RESOLVED | assignee, manager/team, admin | issue summary, actions taken, resolution |
| close | RESOLVED | CLOSED | creator, manager/team, admin | existing resolution + version |
| reopen | RESOLVED, CLOSED | ASSIGNED if assignee else OPEN | creator, assignee, manager/team, admin | mandatory reopen reason |

Do **not** permit `OPEN -> CLOSED`, `ASSIGNED -> CLOSED`, or arbitrary status updates. A user who is both creator and assignee may resolve then close, as separate audited actions; optionally provide a combined UI flow that performs both validated transitions in one DB transaction but still emits both events.

## Resolution payload

1. `issue_summary`: What failed or work was requested? (required, 10–5000 chars).
2. `actions_taken`: What exactly did the assignee investigate/change/test? (required, 10–10000 chars).
3. `resolution`: What is the outcome and how was success verified? (required, 10–5000 chars).
4. `root_cause`: optional, 0–5000 chars.

Create an **append-only resolution record** each time ticket is resolved. Reopen does not erase prior resolution records. Closing references the most recent successful resolution by chronological/latest ID; do not overwrite older revisions. Attachments/logs are not a substitute for a written resolution.

## Edit ownership rules

- Creator can change normal ticket details before `CLOSED`.
- Assigned worker can add comments, work notes and files; does not automatically own title/priority changes.
- Any assignment/status/edit command inserts an event (with actor, previous/new safe values) and possibly in-app notification in the same transaction.
- Closed ticket is read-only except comments allowed by policy? **Decision: no new comments on CLOSED**; reopen to continue discussion. Admin can add an audited correction record, not silently edit history.

## Audit examples

```json
{"type":"TICKET_CREATED","ticketId":"uuid","by":"user-id"}
{"type":"ASSIGNEE_CHANGED","before":"alice-id","after":"bob-id"}
{"type":"STATUS_CHANGED","from":"IN_PROGRESS","to":"RESOLVED"}
{"type":"RESOLUTION_ADDED","resolutionId":"uuid"}
{"type":"TICKET_REOPENED","reason":"Issue persists after retry"}
```

Store event type + metadata as valid JSON, but never password, auth token, raw secret, or unredacted confidential log contents. Timeline UI shows human-friendly redacted summaries.

## Ticket creation examples

- Employee creates ticket assigned to coworker -> `ASSIGNED`, coworker sees and gets notification.
- Employee creates unassigned ticket -> `OPEN`; creator may later assign.
- Employee creates a ticket for self -> `ASSIGNED` and can resolve; can close as creator after resolution.
- Assignee changes -> previous assignee loses privileged mutation rights immediately, including if they still have page open. Concurrent stale forms return 409.

## Acceptance tests

- Resolve without mandatory issue/actions/outcome -> 422 and no state change.
- Unassigned user resolves -> 403/404 and zero events.
- Creator closes a resolved ticket -> 200, timestamp and single event.
- Assignee who isn't creator tries to close -> denied.
- Two users submit conflicting versions -> one succeeds; second sees 409.
- Reopen closed ticket -> history retained; close requires **new** resolution after reopen.
- Manager override -> audit includes both effective role and actor.
