import type { FastifyInstance } from 'fastify';
import { requireAuth, type GuardDeps } from '../../auth/guard.js';
import type { AuthUser } from '../../auth/session.js';
import { HttpError } from '../../lib/errors.js';
import { parseSearchQuery, searchTickets } from './repository.js';
import { formatTicketNo } from '../tickets/types.js';

const PAGE_SIZE = 25;

const STATUS_CLASS: Record<string, string> = {
  OPEN: 'bg-slate-100 text-slate-700',
  ASSIGNED: 'bg-sky-50 text-sky-700',
  IN_PROGRESS: 'bg-indigo-50 text-indigo-700',
  BLOCKED: 'bg-amber-50 text-amber-700',
  RESOLVED: 'bg-emerald-50 text-emerald-700',
  CLOSED: 'bg-slate-200 text-slate-600',
};

export function registerSearchRoutes(app: FastifyInstance, deps: GuardDeps): void {
  app.register(async (scope) => {
    requireAuth(scope, deps);

    scope.get('/search', async (req, reply) => {
      const u = req.authUser;
      if (!u) throw new HttpError(401, 'Not authenticated');
      const q = req.query as Record<string, string | undefined>;
      const raw = typeof q.q === 'string' ? q.q : '';
      const pageParam = Number(q.page ?? '1');
      const page = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1;

      const parsed = parseSearchQuery(raw);
      const { rows, total } = searchTickets(deps.db, {
        actor: { id: u.id, role: u.role },
        query: raw,
        page,
        pageSize: PAGE_SIZE,
      });
      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

      return reply.view('search.ejs', {
        title: 'Search · Ticketing',
        csrfToken: req.csrfToken ?? '',
        role: u.role,
        user: { name: u.name, email: u.email, role: u.role },
        current: 'search',
        inShell: true,
        q: raw,
        rows: rows.map((t) => ({ ...t, ticketNo: formatTicketNo(t.ticket_no), statusClass: STATUS_CLASS[t.status] ?? '' })),
        page,
        totalPages,
        total,
        hasQuery: parsed.fts !== null || parsed.ticketNo !== null,
      });
    });
  });
}