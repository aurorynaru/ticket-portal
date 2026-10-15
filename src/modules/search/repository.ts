import type { AppDatabase } from '../../db/connection.js';
import type { EffectiveRole } from '../../auth/session.js';
import type { TicketView } from '../tickets/repository.js';

export interface SearchFilter {
  actor: { id: string; role: EffectiveRole };
  query: string;
  page: number;
  pageSize: number;
}

export interface SearchResult {
  rows: TicketView[];
  total: number;
}

const MAX_TERMS = 10;
const MAX_QUERY_LENGTH = 200;

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

/**
 * Parse a raw user query into a sanitized FTS5 expression plus an optional
 * exact ticket number. Every term is double-quoted so FTS operators
 * (AND/OR/NOT/*, parentheses) can never be injected; at most MAX_TERMS terms
 * survive. A query of only FTS syntax therefore matches nothing.
 */
export function parseSearchQuery(raw: string): { fts: string | null; ticketNo: number | null } {
  const text = raw.trim().slice(0, MAX_QUERY_LENGTH);
  let ticketNo: number | null = null;
  const noMatch = /^TKT-(\d{1,6})$/i.exec(text);
  if (noMatch) {
    const digits = noMatch[1];
    if (digits) ticketNo = Number.parseInt(digits, 10);
    return { fts: null, ticketNo };
  }
  const terms = text
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .slice(0, MAX_TERMS)
    .map((t) => `"${t.replaceAll('"', '""')}"`);
  if (terms.length === 0) return { fts: null, ticketNo: null };
  return { fts: terms.join(' '), ticketNo: null };
}

/**
 * Visibility predicate identical to the ticket list: a search match never
 * grants access. Admins see everything; everyone else only tickets they can
 * read (creator / assignee / watcher / TEAM member).
 */
function visibilityWhere(actor: { id: string; role: EffectiveRole }): { sql: string; params: Record<string, unknown> } {
  if (actor.role === 'admin') return { sql: '', params: {} };
  return {
    sql: `(t.created_by = @me
       OR t.assigned_to = @me
       OR EXISTS (SELECT 1 FROM app_ticket_watchers w WHERE w.ticket_id = t.id AND w.user_id = @me)
       OR (t.visibility = 'TEAM' AND t.team_id IS NOT NULL
           AND EXISTS (SELECT 1 FROM app_team_members m WHERE m.team_id = t.team_id AND m.user_id = @me)))`,
    params: { me: actor.id },
  };
}

function ticketIdsFromFts(db: AppDatabase, fts: string): Set<string> {
  const ids = new Set<string>();
  const ticketRows = db
    .prepare(
      `SELECT t.id AS id FROM app_ticket_fts f
       JOIN app_tickets t ON t.rowid = f.rowid
       WHERE app_ticket_fts MATCH ?`,
    )
    .all(fts) as { id: string }[];
  for (const r of ticketRows) ids.add(r.id);
  const resolutionRows = db
    .prepare(
      `SELECT r.ticket_id AS id FROM app_ticket_resolution_fts f
       JOIN app_ticket_resolutions r ON r.rowid = f.rowid
       WHERE app_ticket_resolution_fts MATCH ?`,
    )
    .all(fts) as { id: string }[];
  for (const r of resolutionRows) ids.add(r.id);
  return ids;
}

/**
 * Full-text search over ticket numbers, titles, descriptions and resolution
 * text. Results are visibility-scoped in SQL and paginated.
 */
export function searchTickets(db: AppDatabase, filter: SearchFilter): SearchResult {
  const { fts, ticketNo } = parseSearchQuery(filter.query);
  if (!fts && ticketNo === null) return { rows: [], total: 0 };

  const ids = new Set<string>();
  if (fts) {
    for (const id of ticketIdsFromFts(db, fts)) ids.add(id);
  }
  if (ticketNo !== null) {
    const row = db.prepare('SELECT id FROM app_tickets WHERE ticket_no = ?').get(ticketNo) as
      | { id: string }
      | undefined;
    if (row) ids.add(row.id);
  }
  if (ids.size === 0) return { rows: [], total: 0 };

  const vis = visibilityWhere(filter.actor);
  const idList = [...ids];
  const placeholders = idList.map((_, i) => `@id${i}`).join(', ');
  const params: Record<string, unknown> = { ...vis.params };
  idList.forEach((id, i) => {
    params[`id${i}`] = id;
  });

  const where = `WHERE t.id IN (${placeholders})${vis.sql ? ` AND ${vis.sql}` : ''}`;
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM app_tickets t ${where}`)
    .get(params) as { n: number };

  const rows = db
    .prepare(
      `${VIEW_SELECT} ${where}
       ORDER BY t.updated_at DESC, t.ticket_no DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: filter.pageSize, offset: (filter.page - 1) * filter.pageSize }) as TicketView[];

  return { rows, total: totalRow.n };
}