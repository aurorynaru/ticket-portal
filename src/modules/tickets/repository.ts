import type { AppDatabase } from '../../db/connection.js';
import type { EffectiveRole } from '../../auth/session.js';
import type { TicketKind, TicketPriority, TicketStatus, TicketVisibility } from './types.js';

export interface TicketRow {
  id: string;
  ticket_no: number;
  title: string;
  description: string;
  kind: TicketKind;
  category_id: string | null;
  team_id: string | null;
  visibility: TicketVisibility;
  priority: TicketPriority;
  status: TicketStatus;
  created_by: string;
  assigned_to: string | null;
  due_at: number | null;
  resolved_at: number | null;
  closed_at: number | null;
  version: number;
  created_at: number;
  updated_at: number;
}

export interface TicketView extends TicketRow {
  creator_name: string | null;
  assignee_name: string | null;
  category_name: string | null;
  team_name: string | null;
}

export interface EventRow {
  id: string;
  ticket_id: string;
  actor_id: string | null;
  actor_name: string | null;
  event_type: string;
  metadata_json: string;
  created_at: number;
}

export interface CommentRow {
  id: string;
  ticket_id: string;
  author_id: string;
  author_name: string | null;
  content: string;
  is_internal: number;
  created_at: number;
  edited_at: number | null;
}

export interface ResolutionRow {
  id: string;
  ticket_id: string;
  issue_summary: string;
  actions_taken: string;
  resolution: string;
  root_cause: string | null;
  resolved_by: string;
  resolver_name: string | null;
  created_at: number;
}

const VIEW_SELECT = `
  SELECT t.*,
         cu.name AS creator_name,
         au.name AS assignee_name,
         c.name  AS category_name,
         tm.name AS team_name
  FROM app_tickets t
  LEFT JOIN user cu ON cu.id = t.created_by
  LEFT JOIN user au ON au.id = t.assigned_to
  LEFT JOIN app_categories c ON c.id = t.category_id
  LEFT JOIN app_teams tm ON tm.id = t.team_id`;

export function getTicket(db: AppDatabase, id: string): TicketRow | null {
  const row = db.prepare('SELECT * FROM app_tickets WHERE id = ?').get(id) as TicketRow | undefined;
  return row ?? null;
}

export function getTicketView(db: AppDatabase, id: string): TicketView | null {
  const row = db.prepare(`${VIEW_SELECT} WHERE t.id = ?`).get(id) as TicketView | undefined;
  return row ?? null;
}

/** Allocate the next ticket number from the sequence (call inside the creation transaction). */
export function nextTicketNo(db: AppDatabase): number {
  db.prepare('INSERT INTO app_ticket_number_seq DEFAULT VALUES').run();
  const row = db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number };
  return row.id;
}

export interface NewTicket {
  id: string;
  ticketNo: number;
  title: string;
  description: string;
  kind: TicketKind;
  categoryId: string | null;
  teamId: string | null;
  visibility: TicketVisibility;
  priority: TicketPriority;
  status: TicketStatus;
  createdBy: string;
  assignedTo: string | null;
  dueAt: number | null;
  createdAt: number;
}

export function insertTicket(db: AppDatabase, t: NewTicket): void {
  db.prepare(
    `INSERT INTO app_tickets
       (id, ticket_no, title, description, kind, category_id, team_id, visibility, priority,
        status, created_by, assigned_to, due_at, resolved_at, closed_at, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 1, ?, ?)`,
  ).run(
    t.id,
    t.ticketNo,
    t.title,
    t.description,
    t.kind,
    t.categoryId,
    t.teamId,
    t.visibility,
    t.priority,
    t.status,
    t.createdBy,
    t.assignedTo,
    t.dueAt,
    t.createdAt,
    t.createdAt,
  );
}

/**
 * Optimistic update: only applies when the row is still at `version`.
 * Returns the number of affected rows (0 = conflict).
 */
export function updateTicketVersioned(
  db: AppDatabase,
  id: string,
  version: number,
  fields: Record<string, unknown>,
): number {
  const keys = Object.keys(fields);
  if (keys.length === 0) return 0;
  const sets = keys.map((k) => `${k} = @${k}`).join(', ');
  const params: Record<string, unknown> = { id, version, ...fields };
  const row = db
    .prepare(`UPDATE app_tickets SET ${sets}, version = version + 1, updated_at = @now WHERE id = @id AND version = @version`)
    .run({ ...params, now: Date.now() });
  return row.changes;
}

export function appendEvent(
  db: AppDatabase,
  e: { ticketId: string; actorId: string | null; type: string; metadata: Record<string, unknown> },
): void {
  db.prepare(
    `INSERT INTO app_ticket_events (id, ticket_id, actor_id, event_type, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), e.ticketId, e.actorId, e.type, JSON.stringify(e.metadata), Date.now());
}

export function listEvents(db: AppDatabase, ticketId: string): EventRow[] {
  return db
    .prepare(
      `SELECT e.id, e.ticket_id, e.actor_id, u.name AS actor_name, e.event_type, e.metadata_json, e.created_at
       FROM app_ticket_events e
       LEFT JOIN user u ON u.id = e.actor_id
       WHERE e.ticket_id = ?
       ORDER BY e.created_at ASC, e.rowid ASC`,
    )
    .all(ticketId) as EventRow[];
}

export function countEvents(db: AppDatabase, ticketId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM app_ticket_events WHERE ticket_id = ?').get(ticketId) as { n: number };
  return row.n;
}

export function insertResolution(
  db: AppDatabase,
  r: {
    id: string;
    ticketId: string;
    issueSummary: string;
    actionsTaken: string;
    resolution: string;
    rootCause: string | null;
    resolvedBy: string;
  },
): void {
  db.prepare(
    `INSERT INTO app_ticket_resolutions
       (id, ticket_id, issue_summary, actions_taken, resolution, root_cause, resolved_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(r.id, r.ticketId, r.issueSummary, r.actionsTaken, r.resolution, r.rootCause, r.resolvedBy, Date.now());
}

export function listResolutions(db: AppDatabase, ticketId: string): ResolutionRow[] {
  return db
    .prepare(
      `SELECT r.id, r.ticket_id, r.issue_summary, r.actions_taken, r.resolution, r.root_cause,
              r.resolved_by, u.name AS resolver_name, r.created_at
       FROM app_ticket_resolutions r
       LEFT JOIN user u ON u.id = r.resolved_by
       WHERE r.ticket_id = ?
       ORDER BY r.created_at ASC, r.rowid ASC`,
    )
    .all(ticketId) as ResolutionRow[];
}

export function latestResolution(db: AppDatabase, ticketId: string): ResolutionRow | null {
  const all = listResolutions(db, ticketId);
  return all.length > 0 ? all[all.length - 1]! : null;
}

export function insertComment(
  db: AppDatabase,
  c: { id: string; ticketId: string; authorId: string; content: string; isInternal: boolean },
): void {
  db.prepare(
    `INSERT INTO app_ticket_comments (id, ticket_id, author_id, content, is_internal, created_at, edited_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
  ).run(c.id, c.ticketId, c.authorId, c.content, c.isInternal ? 1 : 0, Date.now());
}

export function listComments(db: AppDatabase, ticketId: string): CommentRow[] {
  return db
    .prepare(
      `SELECT c.id, c.ticket_id, c.author_id, u.name AS author_name, c.content, c.is_internal, c.created_at, c.edited_at
       FROM app_ticket_comments c
       LEFT JOIN user u ON u.id = c.author_id
       WHERE c.ticket_id = ?
       ORDER BY c.created_at ASC, c.rowid ASC`,
    )
    .all(ticketId) as CommentRow[];
}

export function isWatcher(db: AppDatabase, ticketId: string, userId: string): boolean {
  const row = db
    .prepare('SELECT 1 AS x FROM app_ticket_watchers WHERE ticket_id = ? AND user_id = ?')
    .get(ticketId, userId);
  return row !== undefined;
}

export function addWatcher(db: AppDatabase, ticketId: string, userId: string): void {
  db.prepare('INSERT OR IGNORE INTO app_ticket_watchers (ticket_id, user_id) VALUES (?, ?)').run(ticketId, userId);
}

export function removeWatcher(db: AppDatabase, ticketId: string, userId: string): void {
  db.prepare('DELETE FROM app_ticket_watchers WHERE ticket_id = ? AND user_id = ?').run(ticketId, userId);
}

export function isTeamMember(db: AppDatabase, teamId: string, userId: string): boolean {
  const row = db
    .prepare('SELECT 1 AS x FROM app_team_members WHERE team_id = ? AND user_id = ?')
    .get(teamId, userId);
  return row !== undefined;
}

export function listTeams(db: AppDatabase): { id: string; name: string }[] {
  return db.prepare('SELECT id, name FROM app_teams ORDER BY name COLLATE NOCASE').all() as {
    id: string;
    name: string;
  }[];
}

export function getTeam(db: AppDatabase, id: string): { id: string; name: string } | null {
  const row = db.prepare('SELECT id, name FROM app_teams WHERE id = ?').get(id) as
    | { id: string; name: string }
    | undefined;
  return row ?? null;
}

export function listCategories(db: AppDatabase, activeOnly: boolean): { id: string; name: string; is_active: number }[] {
  const sql = activeOnly
    ? 'SELECT id, name, is_active FROM app_categories WHERE is_active = 1 ORDER BY name COLLATE NOCASE'
    : 'SELECT id, name, is_active FROM app_categories ORDER BY name COLLATE NOCASE';
  return db.prepare(sql).all() as { id: string; name: string; is_active: number }[];
}

export function getCategory(db: AppDatabase, id: string): { id: string; name: string; is_active: number } | null {
  const row = db
    .prepare('SELECT id, name, is_active FROM app_categories WHERE id = ?')
    .get(id) as { id: string; name: string; is_active: number } | undefined;
  return row ?? null;
}

/** Active = profile active, not banned. Used to validate assignees/watchers. */
export function isUserActive(db: AppDatabase, userId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS x FROM user u
       JOIN app_user_profiles p ON p.user_id = u.id
       WHERE u.id = ? AND p.is_active = 1 AND (u.banned IS NULL OR u.banned = 0)`,
    )
    .get(userId);
  return row !== undefined;
}

export function listActiveUsers(db: AppDatabase): { id: string; name: string | null; email: string }[] {
  return db
    .prepare(
      `SELECT u.id, u.name, u.email FROM user u
       JOIN app_user_profiles p ON p.user_id = u.id
       WHERE p.is_active = 1 AND (u.banned IS NULL OR u.banned = 0)
       ORDER BY u.name COLLATE NOCASE`,
    )
    .all() as { id: string; name: string | null; email: string }[];
}

/** Name lookup for the audit timeline (includes deactivated users for history). */
export function userNames(db: AppDatabase): Record<string, string> {
  const rows = db.prepare('SELECT id, name FROM user').all() as { id: string; name: string | null }[];
  const map: Record<string, string> = {};
  for (const r of rows) map[r.id] = r.name ?? r.id;
  return map;
}

/**
 * Inserts a notification unless the recipient already has an UNREAD one for the
 * same (ticket, kind) — retries of the same logical action never stack
 * duplicates (docs/08 P4.3).
 */
export function insertNotification(
  db: AppDatabase,
  n: { recipientId: string; ticketId: string; kind: string; payload: Record<string, unknown> },
): void {
  db.prepare(
    `INSERT INTO app_notifications (id, recipient_id, ticket_id, kind, payload_json, read_at, created_at)
     SELECT @id, @recipientId, @ticketId, @kind, @payload, NULL, @now
     WHERE NOT EXISTS (
       SELECT 1 FROM app_notifications
       WHERE recipient_id = @recipientId AND ticket_id = @ticketId AND kind = @kind AND read_at IS NULL
     )`,
  ).run({
    id: randomUUID(),
    recipientId: n.recipientId,
    ticketId: n.ticketId,
    kind: n.kind,
    payload: JSON.stringify(n.payload),
    now: Date.now(),
  });
}

export interface ListFilter {
  status?: TicketStatus;
  scope: 'all' | 'assigned' | 'created';
}

export interface ListResult {
  rows: TicketView[];
  total: number;
}

/**
 * Visibility-scoped ticket list. Non-admins only ever see tickets they can read
 * (creator / assignee / watcher / TEAM member); admins see everything.
 */
export function listTickets(
  db: AppDatabase,
  actor: { id: string; role: EffectiveRole },
  filter: ListFilter,
  page: number,
  pageSize: number,
): ListResult {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (actor.role !== 'admin') {
    clauses.push(
      `(t.created_by = @me
        OR t.assigned_to = @me
        OR EXISTS (SELECT 1 FROM app_ticket_watchers w WHERE w.ticket_id = t.id AND w.user_id = @me)
        OR (t.visibility = 'TEAM' AND t.team_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM app_team_members m WHERE m.team_id = t.team_id AND m.user_id = @me)))`,
    );
    params.me = actor.id;
  }
  if (filter.status) {
    clauses.push('t.status = @status');
    params.status = filter.status;
  }
  if (filter.scope === 'assigned') {
    clauses.push('t.assigned_to = @meScope');
    params.meScope = actor.id;
  } else if (filter.scope === 'created') {
    clauses.push('t.created_by = @meScope');
    params.meScope = actor.id;
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM app_tickets t ${where}`)
    .get(params) as { n: number };

  const rows = db
    .prepare(
      `${VIEW_SELECT} ${where}
       ORDER BY t.updated_at DESC, t.ticket_no DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as TicketView[];

  return { rows, total: totalRow.n };
}

function randomUUID(): string {
  return crypto.randomUUID();
}