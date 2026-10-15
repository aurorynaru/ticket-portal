-- P2: ticket domain schema per docs/02_DATABASE.md and docs/04_TICKET_WORKFLOWS.md.
-- Timestamps are UTC epoch milliseconds. app_ticket_number_seq already exists (0001).
-- Attachments (P4.2), FTS5 (P4.1) and the email outbox (P4.3) are intentionally not here.

CREATE TABLE IF NOT EXISTS app_teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_team_members (
  team_id TEXT NOT NULL REFERENCES app_teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS app_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1))
);

CREATE TABLE IF NOT EXISTS app_tickets (
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
  resolved_at INTEGER,
  closed_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_ticket_resolutions (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES app_tickets(id) ON DELETE CASCADE,
  issue_summary TEXT NOT NULL,
  actions_taken TEXT NOT NULL,
  resolution TEXT NOT NULL,
  root_cause TEXT,
  resolved_by TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_ticket_comments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES app_tickets(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES user(id),
  content TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0 CHECK(is_internal IN (0,1)),
  created_at INTEGER NOT NULL,
  edited_at INTEGER
);

CREATE TABLE IF NOT EXISTS app_ticket_watchers (
  ticket_id TEXT NOT NULL REFERENCES app_tickets(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  PRIMARY KEY (ticket_id, user_id)
);

-- Append-only audit trail. No UPDATE/DELETE paths exist in the application.
CREATE TABLE IF NOT EXISTS app_ticket_events (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES app_tickets(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES user(id),
  event_type TEXT NOT NULL,
  metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_notifications (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  ticket_id TEXT REFERENCES app_tickets(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  read_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ticket_assignee_status_updated ON app_tickets(assigned_to, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_creator_updated ON app_tickets(created_by, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_team_status_updated ON app_tickets(team_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_due_open ON app_tickets(due_at, status);
CREATE INDEX IF NOT EXISTS idx_comment_ticket_created ON app_ticket_comments(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_event_ticket_created ON app_ticket_events(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notification_recipient_read ON app_notifications(recipient_id, read_at, created_at DESC);

-- Baseline teams and categories (admin-managed later in P4.5).
INSERT OR IGNORE INTO app_teams (id, name, created_at)
VALUES ('team-general', 'General', strftime('%s','now') * 1000);

INSERT OR IGNORE INTO app_categories (id, name, is_active) VALUES
  ('cat-general', 'General', 1),
  ('cat-it-support', 'IT Support', 1),
  ('cat-infrastructure', 'Infrastructure', 1),
  ('cat-security', 'Security', 1),
  ('cat-other', 'Other', 1);