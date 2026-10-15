# 02 — SQLite schema, indexes, and migrations

## Ownership boundary

**Better Auth owns** tables `user`, `session`, `account`, `verification` and fields/tables introduced by its Admin plugin. Generate/migrate them with the installed Better Auth CLI at a controlled step. Do **not** manually recreate or modify these tables. Application migrations below assume `user(id TEXT PRIMARY KEY)` exists and use `REFERENCES user(id)` accordingly. Confirm the generated schema and SQLite foreign-key compatibility before applying migrations.

Use application table names prefixed `app_` and never assume the auth system's columns beyond those documented. Use text UUID/ULID identifiers for domain records, `INTEGER` for UTC epoch milliseconds (or ISO-8601 text consistently—**choose epoch milliseconds for this implementation**).

## Proposed application migration SQL (adapt syntax if verified Better Auth version differs)

```sql
CREATE TABLE app_user_profiles (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL DEFAULT 'user'
    CHECK(access_level IN ('manager','user','viewer')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  timezone TEXT NOT NULL DEFAULT 'Asia/Manila',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE app_teams (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE app_team_members (
  team_id TEXT NOT NULL REFERENCES app_teams(id),
  user_id TEXT NOT NULL REFERENCES user(id),
  PRIMARY KEY (team_id,user_id)
);
CREATE TABLE app_categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE app_tickets (
  id TEXT PRIMARY KEY,
  ticket_no INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 200),
  description TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('TASK','INCIDENT','REQUEST','BUG')),
  category_id TEXT REFERENCES app_categories(id),
  team_id TEXT REFERENCES app_teams(id),
  visibility TEXT NOT NULL DEFAULT 'TEAM' CHECK(visibility IN ('TEAM','RESTRICTED')),
  priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK(priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ASSIGNED','IN_PROGRESS','BLOCKED','RESOLVED','CLOSED')),
  created_by TEXT NOT NULL REFERENCES user(id),
  assigned_to TEXT REFERENCES user(id),
  due_at INTEGER,
  resolved_at INTEGER, closed_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE app_ticket_resolutions (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES app_tickets(id),
  issue_summary TEXT NOT NULL,
  actions_taken TEXT NOT NULL,
  resolution TEXT NOT NULL,
  root_cause TEXT,
  resolved_by TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL
);
CREATE TABLE app_ticket_comments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES app_tickets(id),
  author_id TEXT NOT NULL REFERENCES user(id),
  content TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0 CHECK(is_internal IN (0,1)),
  created_at INTEGER NOT NULL, edited_at INTEGER
);
CREATE TABLE app_ticket_watchers (
  ticket_id TEXT NOT NULL REFERENCES app_tickets(id),
  user_id TEXT NOT NULL REFERENCES user(id),
  PRIMARY KEY(ticket_id,user_id)
);
CREATE TABLE app_ticket_attachments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES app_tickets(id),
  comment_id TEXT REFERENCES app_ticket_comments(id),
  uploaded_by TEXT NOT NULL REFERENCES user(id),
  original_name TEXT NOT NULL, disk_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL,
  sha256 TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE app_ticket_events (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES app_tickets(id),
  actor_id TEXT REFERENCES user(id),
  event_type TEXT NOT NULL,
  metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
  created_at INTEGER NOT NULL
);
CREATE TABLE app_notifications (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES user(id),
  ticket_id TEXT REFERENCES app_tickets(id),
  kind TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  read_at INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE app_email_outbox (
  id TEXT PRIMARY KEY, recipient_email TEXT NOT NULL,
  template_key TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL,
  sent_at INTEGER, last_error TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE app_schema_migrations (
  version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL
);
```

### Identifier generation

- Domain record IDs: `crypto.randomUUID()`; user IDs are provided by Better Auth.
- `ticket_no`: monotonically increasing SQLite `INTEGER` allocated in the **same ticket-creation transaction** using `CREATE TABLE app_ticket_number_seq (id INTEGER PRIMARY KEY AUTOINCREMENT);` then `INSERT INTO app_ticket_number_seq DEFAULT VALUES;` and `db.prepare("SELECT last_insert_rowid() AS id").get()` on the **same connection**, before inserting `app_tickets`. Do not use `MAX(ticket_no)+1` outside a serialized transaction. Add the sequence table in the first application migration. Display as `TKT-000001` (padding is presentational).
- Store status changes and history in `app_ticket_events` within the same DB transaction. Append-only; do not allow normal-user edits/deletes.

## Required indexes

```sql
CREATE INDEX idx_ticket_assignee_status_updated ON app_tickets(assigned_to,status,updated_at DESC);
CREATE INDEX idx_ticket_creator_updated ON app_tickets(created_by,updated_at DESC);
CREATE INDEX idx_ticket_team_status_updated ON app_tickets(team_id,status,updated_at DESC);
CREATE INDEX idx_ticket_due_open ON app_tickets(due_at,status);
CREATE INDEX idx_comment_ticket_created ON app_ticket_comments(ticket_id,created_at);
CREATE INDEX idx_event_ticket_created ON app_ticket_events(ticket_id,created_at);
CREATE INDEX idx_notification_recipient_read ON app_notifications(recipient_id,read_at,created_at DESC);
CREATE INDEX idx_email_pending ON app_email_outbox(sent_at,next_attempt_at);
```

## FTS5

```sql
CREATE VIRTUAL TABLE app_ticket_fts USING fts5(
  title, description, content='app_tickets', content_rowid='rowid',
  tokenize='unicode61'
);
```

Create **INSERT / UPDATE / DELETE triggers** that keep FTS5 synchronized with `app_tickets`. Include backfill (`INSERT INTO app_ticket_fts(app_ticket_fts) VALUES('rebuild')`) in initial deployment after table creation. Use `MATCH` with sanitized bounded terms and join on `rowid`; **apply visibility filters in the actual search query**. A search match never grants access. For resolution/comment search, either add separate carefully secured FTS tables or defer cross-field search until those modules land; do not falsely claim full-text coverage before implemented.

## Atomicity and concurrency

- Create/edit/assign/resolve/reopen/close: `BEGIN IMMEDIATE` (or `better-sqlite3` immediate transaction) + validate current status and `version` + update + event + notification in **one transaction**.
- Optimistic update `WHERE id=? AND version=?`, increment version; zero affected rows returns HTTP 409 with conflict UI, not silent overwrite.
- A resolver must not depend on a DB commit that is still pending. Store resolution + status change atomically.
- Validate `assignee` is active before updating.
- Use `ON DELETE RESTRICT`/retain users where possible for audit; deactivate instead of deleting accounts.

## Migrations and recovery

- Separate Better Auth generated migrations and application migrations. Apply auth schema first.
- Migrations numbered, idempotent only when deliberately written so; apply once transactionally, record success, exit nonzero on failure, never startup with mismatched schema.
- Provide `db:integrity` using `PRAGMA integrity_check` and `foreign_key_check`; run on restored copies.
- SQLite WAL backup must use SQLite backup API or `VACUUM INTO` on a consistent connection, not blind copy of only `.db` while writes are active.
