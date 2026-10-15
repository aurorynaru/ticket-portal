import type { AppDatabase } from '../../db/connection.js';
import type { EffectiveRole } from '../../auth/session.js';
import type { TicketView } from '../tickets/repository.js';

export interface DashboardStats {
  assignedOpen: number;
  createdOpen: number;
  openTotal: number;
  overdue: number;
  resolved: number;
  closed: number;
}

export interface ActivityItem {
  created_at: number;
  event_type: string;
  actor_name: string | null;
  ticket_id: string;
  ticket_no: number;
  title: string;
}

const OPEN_STATUSES = "'OPEN','ASSIGNED','IN_PROGRESS','BLOCKED'";

function visibilityWhere(actor: { id: string; role: EffectiveRole }): { sql: string; params: Record<string, unknown> } {
  if (actor.role === 'admin') return { sql: '', params: {} };
  return {
    sql: `
      AND (
        t.created_by = @me
        OR t.assigned_to = @me
        OR EXISTS (SELECT 1 FROM app_ticket_watchers w WHERE w.ticket_id = t.id AND w.user_id = @me)
        OR (t.visibility = 'TEAM' AND t.team_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM app_team_members m WHERE m.team_id = t.team_id AND m.user_id = @me))
      )`,
    params: { me: actor.id },
  };
}

export function dashboardStats(db: AppDatabase, actor: { id: string; role: EffectiveRole }): DashboardStats {
  const { sql, params } = visibilityWhere(actor);
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN t.assigned_to = @me AND t.status IN (${OPEN_STATUSES}) THEN 1 ELSE 0 END), 0) AS assigned_open,
         COALESCE(SUM(CASE WHEN t.created_by = @me AND t.status IN (${OPEN_STATUSES}) THEN 1 ELSE 0 END), 0) AS created_open,
         COALESCE(SUM(CASE WHEN t.status IN (${OPEN_STATUSES}) THEN 1 ELSE 0 END), 0) AS open_total,
         COALESCE(SUM(CASE WHEN t.due_at IS NOT NULL AND t.due_at < @now AND t.status IN (${OPEN_STATUSES}) THEN 1 ELSE 0 END), 0) AS overdue,
         COALESCE(SUM(CASE WHEN t.status = 'RESOLVED' THEN 1 ELSE 0 END), 0) AS resolved,
         COALESCE(SUM(CASE WHEN t.status = 'CLOSED' THEN 1 ELSE 0 END), 0) AS closed
       FROM app_tickets t
       WHERE 1 = 1 ${sql}`,
    )
    .get({ ...params, me: actor.id, now: Date.now() }) as {
    assigned_open: number;
    created_open: number;
    open_total: number;
    overdue: number;
    resolved: number;
    closed: number;
  };
  return {
    assignedOpen: row.assigned_open,
    createdOpen: row.created_open,
    openTotal: row.open_total,
    overdue: row.overdue,
    resolved: row.resolved,
    closed: row.closed,
  };
}

export function recentActivity(db: AppDatabase, actor: { id: string; role: EffectiveRole }, limit = 10): ActivityItem[] {
  const { sql, params } = visibilityWhere(actor);
  return db
    .prepare(
      `SELECT e.created_at, e.event_type, u.name AS actor_name, t.id AS ticket_id, t.ticket_no, t.title
       FROM app_ticket_events e
       JOIN app_tickets t ON t.id = e.ticket_id
       LEFT JOIN user u ON u.id = e.actor_id
       WHERE 1 = 1 ${sql}
       ORDER BY e.created_at DESC, e.rowid DESC
       LIMIT @limit`,
    )
    .all({ ...params, me: actor.id, limit }) as ActivityItem[];
}

/** All tickets the actor can read, for CSV export (capped). */
export function exportableTickets(db: AppDatabase, actor: { id: string; role: EffectiveRole }, limit = 5000): TicketView[] {
  const { sql, params } = visibilityWhere(actor);
  return db
    .prepare(
      `SELECT t.*,
              cu.name AS creator_name,
              au.name AS assignee_name,
              tm.name AS team_name
       FROM app_tickets t
       LEFT JOIN user cu ON cu.id = t.created_by
       LEFT JOIN user au ON au.id = t.assigned_to
       LEFT JOIN app_teams tm ON tm.id = t.team_id
       WHERE 1 = 1 ${sql}
       ORDER BY t.updated_at DESC, t.ticket_no DESC
       LIMIT @limit`,
    )
    .all({ ...params, me: actor.id, limit }) as TicketView[];
}