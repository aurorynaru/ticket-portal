import type { FastifyInstance } from 'fastify';
import { requireAuth, type GuardDeps } from '../../auth/guard.js';
import type { AuthUser } from '../../auth/session.js';
import { HttpError } from '../../lib/errors.js';
import { formatTicketNo } from '../tickets/types.js';
import * as repo from './repository.js';

const EVENT_LABELS: Record<string, string> = {
  created: 'created',
  assigned: 'assigned',
  started: 'started work on',
  blocked: 'blocked',
  unblocked: 'unblocked',
  resolved: 'resolved',
  closed: 'closed',
  reopened: 'reopened',
  commented: 'commented on',
};

export function dashboardViewData(deps: GuardDeps, user: AuthUser) {
  const stats = repo.dashboardStats(deps.db, user);
  const activity = repo.recentActivity(deps.db, user, 10).map((a) => ({
    ...a,
    label: EVENT_LABELS[a.event_type] ?? a.event_type,
  }));
  return { stats, activity };
}

function csvField(value: string | number | null): string {
  const s = value === null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function iso(ms: number | null): string {
  return ms === null ? '' : new Date(ms).toISOString();
}

export function registerDashboardRoutes(app: FastifyInstance, deps: GuardDeps): void {
  app.register(async (scope) => {
    requireAuth(scope, deps);

    function actor(req: { authUser?: AuthUser }): AuthUser {
      const u = req.authUser;
      if (!u) throw new HttpError(401, 'Not authenticated');
      return u;
    }

    scope.get('/dashboard', async (req, reply) => {
      const u = actor(req);
      const { stats, activity } = dashboardViewData(deps, u);
      return reply.view('home.ejs', {
        title: 'Dashboard · Ticketing',
        csrfToken: req.csrfToken ?? '',
        role: u.role,
        user: { name: u.name, email: u.email, role: u.role },
        current: 'dashboard',
        inShell: true,
        stats,
        activity,
        fmtTime: (ms: number) => `${new Date(ms).toISOString().replace('T', ' ').slice(0, 16)} UTC`,
      });
    });

    scope.get('/dashboard/export.csv', async (req, reply) => {
      const u = actor(req);
      const rows = repo.exportableTickets(deps.db, u, 5000);
      const header = [
        'ticket_no',
        'title',
        'status',
        'priority',
        'kind',
        'category',
        'team',
        'visibility',
        'assignee',
        'creator',
        'created_at',
        'updated_at',
        'due_at',
      ];
      const lines = [header.join(',')];
      for (const t of rows) {
        lines.push(
          [
            formatTicketNo(t.ticket_no),
            t.title,
            t.status,
            t.priority,
            t.kind,
            t.category_name,
            t.team_name,
            t.visibility,
            t.assignee_name,
            t.creator_name,
            iso(t.created_at),
            iso(t.updated_at),
            iso(t.due_at),
          ]
            .map(csvField)
            .join(','),
        );
      }
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', 'attachment; filename="tickets.csv"');
      return reply.send(lines.join('\n') + '\n');
    });
  });
}