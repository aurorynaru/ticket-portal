import type { AppDatabase } from '../../db/connection.js';
import type { EffectiveRole } from '../../auth/session.js';

export interface NotificationRow {
  id: string;
  ticket_id: string | null;
  kind: string;
  payload_json: string;
  read_at: number | null;
  created_at: number;
  ticket_no: number | null;
  ticket_title: string | null;
  /** False when the recipient can no longer read the linked ticket (redact). */
  readable: boolean;
}

/**
 * Single-query visibility check: a notification's ticket details are only
 * exposed while the recipient can still read the ticket (docs/08 P4.3).
 */
const READABLE_CASE = `
  CASE
    WHEN @isAdmin = 1 THEN 1
    WHEN t.id IS NULL THEN 1
    WHEN t.created_by = @me
      OR t.assigned_to = @me
      OR EXISTS (SELECT 1 FROM app_ticket_watchers w WHERE w.ticket_id = t.id AND w.user_id = @me)
      OR (t.visibility = 'TEAM' AND t.team_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM app_team_members m WHERE m.team_id = t.team_id AND m.user_id = @me))
    THEN 1
    ELSE 0
  END`;

const LIST_SELECT = `
  SELECT n.id, n.ticket_id, n.kind, n.payload_json, n.read_at, n.created_at,
         t.ticket_no, t.title AS ticket_title,
         ${READABLE_CASE} AS readable
  FROM app_notifications n
  LEFT JOIN app_tickets t ON t.id = n.ticket_id
  WHERE n.recipient_id = @me`;

function baseParams(actor: { id: string; role: EffectiveRole }): Record<string, unknown> {
  return { me: actor.id, isAdmin: actor.role === 'admin' ? 1 : 0 };
}

export function unreadCount(db: AppDatabase, userId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM app_notifications WHERE recipient_id = ? AND read_at IS NULL')
    .get(userId) as { n: number };
  return row.n;
}

export function listNotifications(
  db: AppDatabase,
  actor: { id: string; role: EffectiveRole },
  limit: number,
): NotificationRow[] {
  return db
    .prepare(`${LIST_SELECT} ORDER BY n.created_at DESC, n.rowid DESC LIMIT @limit`)
    .all({ ...baseParams(actor), limit }) as NotificationRow[];
}

export function unreadNotifications(
  db: AppDatabase,
  actor: { id: string; role: EffectiveRole },
  limit: number,
): { count: number; items: NotificationRow[] } {
  const items = db
    .prepare(`${LIST_SELECT} AND n.read_at IS NULL ORDER BY n.created_at DESC, n.rowid DESC LIMIT @limit`)
    .all({ ...baseParams(actor), limit }) as NotificationRow[];
  return { count: unreadCount(db, actor.id), items };
}

/** Marks one notification read. Returns false when it is not the caller's or already read. */
export function markRead(db: AppDatabase, notificationId: string, userId: string): boolean {
  const result = db
    .prepare(
      `UPDATE app_notifications SET read_at = @now
       WHERE id = @id AND recipient_id = @me AND read_at IS NULL`,
    )
    .run({ id: notificationId, me: userId, now: Date.now() });
  return result.changes > 0;
}

export function markAllRead(db: AppDatabase, userId: string): number {
  const result = db
    .prepare('UPDATE app_notifications SET read_at = @now WHERE recipient_id = @me AND read_at IS NULL')
    .run({ me: userId, now: Date.now() });
  return result.changes;
}