import type { FastifyInstance } from 'fastify';
import { requireAuth, type GuardDeps } from '../../auth/guard.js';
import type { AuthUser } from '../../auth/session.js';
import { verifyCsrf } from '../../lib/csrf.js';
import { HttpError } from '../../lib/errors.js';
import * as repo from './repository.js';
import { userNames } from '../tickets/repository.js';

const KIND_LABELS: Record<string, string> = {
  ticket_assigned: 'was assigned',
  ticket_started: 'work started on',
  ticket_blocked: 'was blocked',
  ticket_unblocked: 'was unblocked',
  ticket_resolved: 'was resolved',
  ticket_closed: 'was closed',
  ticket_reopened: 'was reopened',
};

export function registerNotificationRoutes(app: FastifyInstance, deps: GuardDeps): void {
  app.register(async (scope) => {
    requireAuth(scope, deps);

    function actor(req: { authUser?: AuthUser }): AuthUser {
      const u = req.authUser;
      if (!u) throw new HttpError(401, 'Not authenticated');
      return u;
    }

    function checkCsrf(req: { body?: unknown; authUser?: AuthUser }): void {
      const u = actor(req);
      const token = (req.body as { csrfToken?: string } | undefined)?.csrfToken;
      if (!verifyCsrf(deps.config.betterAuthSecret ?? '', u.sessionToken, token)) {
        throw new HttpError(403, 'Invalid CSRF token');
      }
    }

    function fmtTime(ms: number | null): string {
      if (ms === null) return '—';
      return `${new Date(ms).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
    }

    function decorate(rows: repo.NotificationRow[]) {
      const names = userNames(deps.db);
      return rows.map((n) => {
        let actorName = 'Someone';
        try {
          const payload = JSON.parse(n.payload_json) as { actorId?: string };
          if (payload.actorId) actorName = names[payload.actorId] ?? 'Someone';
        } catch {
          // Malformed payload: keep the generic label.
        }
        return {
          ...n,
          label: KIND_LABELS[n.kind] ?? 'updated',
          actorName,
          redacted: !n.readable,
        };
      });
    }

    scope.get('/notifications', async (req, reply) => {
      const u = actor(req);
      const rows = decorate(repo.listNotifications(deps.db, u, 50));
      return reply.view('notifications.ejs', {
        title: 'Notifications · Ticketing',
        csrfToken: req.csrfToken ?? '',
        role: u.role,
        user: { name: u.name, email: u.email, role: u.role },
        current: 'notifications',
        inShell: true,
        rows,
        fmtTime,
      });
    });

    // Polling endpoint used by the nav badge (vanilla JS, ~45s cadence).
    scope.get('/notifications/unread', async (req, reply) => {
      const u = actor(req);
      const { count, items } = repo.unreadNotifications(deps.db, u, 5);
      return reply.type('application/json').send({
        count,
        items: items.map((n) => ({
          id: n.id,
          kind: n.kind,
          ticketId: n.ticket_id,
          ticketNo: n.ticket_no,
          title: n.readable ? n.ticket_title : null,
          createdAt: n.created_at,
        })),
      });
    });

    scope.post('/notifications/:id/read', async (req, reply) => {
      checkCsrf(req);
      const u = actor(req);
      const { id } = req.params as { id: string };
      if (!repo.markRead(deps.db, id, u.id)) throw new HttpError(404, 'Notification not found');
      const back = req.headers['referer']?.startsWith('/') ? (req.headers['referer'] as string) : '/notifications';
      return reply.redirect(back, 302);
    });

    scope.post('/notifications/read-all', async (req, reply) => {
      checkCsrf(req);
      const u = actor(req);
      repo.markAllRead(deps.db, u.id);
      return reply.redirect('/notifications', 302);
    });
  });
}