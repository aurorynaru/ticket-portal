-- P0: application-owned schema bootstrap.
-- Better Auth owns user/session/account/verification tables (applied in P1 via official tooling).
-- Ticket number sequence: allocated in the same transaction as ticket creation (see docs/02).
CREATE TABLE IF NOT EXISTS app_ticket_number_seq (
  id INTEGER PRIMARY KEY AUTOINCREMENT
);