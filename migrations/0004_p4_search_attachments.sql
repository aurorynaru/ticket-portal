-- P4: ticket attachments (P4.2) and FTS5 search indexes (P4.1) per
-- docs/02_DATABASE.md and docs/08_FEATURE_SERVICES.md.
-- Timestamps are UTC epoch milliseconds.

CREATE TABLE IF NOT EXISTS app_ticket_attachments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES app_tickets(id) ON DELETE CASCADE,
  comment_id TEXT REFERENCES app_ticket_comments(id) ON DELETE SET NULL,
  uploaded_by TEXT NOT NULL REFERENCES user(id),
  original_name TEXT NOT NULL,
  disk_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
  sha256 TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachment_ticket ON app_ticket_attachments(ticket_id, created_at);

-- FTS5 over ticket title/description. External content table: the index
-- mirrors app_tickets and is kept in sync by triggers below.
CREATE VIRTUAL TABLE IF NOT EXISTS app_ticket_fts USING fts5(
  title, description,
  content='app_tickets', content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS app_ticket_fts_ai AFTER INSERT ON app_tickets BEGIN
  INSERT INTO app_ticket_fts(rowid, title, description)
  VALUES (new.rowid, new.title, new.description);
END;

CREATE TRIGGER IF NOT EXISTS app_ticket_fts_ad AFTER DELETE ON app_tickets BEGIN
  INSERT INTO app_ticket_fts(app_ticket_fts, rowid, title, description)
  VALUES ('delete', old.rowid, old.title, old.description);
END;

CREATE TRIGGER IF NOT EXISTS app_ticket_fts_au AFTER UPDATE OF title, description ON app_tickets BEGIN
  INSERT INTO app_ticket_fts(app_ticket_fts, rowid, title, description)
  VALUES ('delete', old.rowid, old.title, old.description);
  INSERT INTO app_ticket_fts(rowid, title, description)
  VALUES (new.rowid, new.title, new.description);
END;

-- Separate secured FTS index for resolution text (docs/02: cross-field search
-- only with its own index).
CREATE VIRTUAL TABLE IF NOT EXISTS app_ticket_resolution_fts USING fts5(
  issue_summary, actions_taken, resolution, root_cause,
  content='app_ticket_resolutions', content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS app_ticket_resolution_fts_ai AFTER INSERT ON app_ticket_resolutions BEGIN
  INSERT INTO app_ticket_resolution_fts(rowid, issue_summary, actions_taken, resolution, root_cause)
  VALUES (new.rowid, new.issue_summary, new.actions_taken, new.resolution, new.root_cause);
END;

CREATE TRIGGER IF NOT EXISTS app_ticket_resolution_fts_ad AFTER DELETE ON app_ticket_resolutions BEGIN
  INSERT INTO app_ticket_resolution_fts(app_ticket_resolution_fts, rowid, issue_summary, actions_taken, resolution, root_cause)
  VALUES ('delete', old.rowid, old.issue_summary, old.actions_taken, old.resolution, old.root_cause);
END;

CREATE TRIGGER IF NOT EXISTS app_ticket_resolution_fts_au AFTER UPDATE ON app_ticket_resolutions BEGIN
  INSERT INTO app_ticket_resolution_fts(app_ticket_resolution_fts, rowid, issue_summary, actions_taken, resolution, root_cause)
  VALUES ('delete', old.rowid, old.issue_summary, old.actions_taken, old.resolution, old.root_cause);
  INSERT INTO app_ticket_resolution_fts(rowid, issue_summary, actions_taken, resolution, root_cause)
  VALUES (new.rowid, new.issue_summary, new.actions_taken, new.resolution, new.root_cause);
END;

-- Backfill both indexes from the content tables (idempotent: rebuild
-- re-derives the full index, so it is safe on fresh and existing databases).
INSERT INTO app_ticket_fts(app_ticket_fts) VALUES ('rebuild');
INSERT INTO app_ticket_resolution_fts(app_ticket_resolution_fts) VALUES ('rebuild');