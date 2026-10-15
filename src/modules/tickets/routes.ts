import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth, type GuardDeps } from '../../auth/guard.js';
import type { AuthUser } from '../../auth/session.js';
import { verifyCsrf } from '../../lib/csrf.js';
import { HttpError } from '../../lib/errors.js';
import * as repo from './repository.js';
import * as svc from './service.js';
import * as attachments from '../attachments/repository.js';
import {
  canAssign,
  canCloseTicket,
  canComment,
  canCreateTicket,
  canEditDetails,
  canInternalNote,
  canReadTicket,
  canReopenTicket,
  canTransition,
  canWorkOnTicket,
  type AccessInput,
} from './policy.js';
import {
  TICKET_KINDS,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TICKET_VISIBILITIES,
  formatTicketNo,
  isTicketStatus,
} from './types.js';

export function registerTicketRoutes(app: FastifyInstance, deps: GuardDeps): void {
  app.register(async (scope) => {
    requireAuth(scope, deps);

    function actor(req: FastifyRequest): AuthUser {
      const u = req.authUser;
      if (!u) throw new HttpError(401, 'Not authenticated');
      return u;
    }

    function checkCsrf(req: FastifyRequest): void {
      const u = actor(req);
      const token = (req.body as { csrfToken?: string })?.csrfToken;
      if (!verifyCsrf(deps.config.betterAuthSecret ?? '', u.sessionToken, token)) {
        throw new HttpError(403, 'Invalid CSRF token');
      }
    }

    function fmtTime(ms: number | null): string {
      if (ms === null) return '—';
      return `${new Date(ms).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
    }

    function statusClass(status: string): string {
      switch (status) {
        case 'OPEN':
          return 'bg-slate-100 text-slate-700';
        case 'ASSIGNED':
          return 'bg-sky-50 text-sky-700';
        case 'IN_PROGRESS':
          return 'bg-indigo-50 text-indigo-700';
        case 'BLOCKED':
          return 'bg-amber-50 text-amber-700';
        case 'RESOLVED':
          return 'bg-emerald-50 text-emerald-700';
        case 'CLOSED':
          return 'bg-slate-200 text-slate-600';
        default:
          return 'bg-slate-100 text-slate-700';
      }
    }

    function baseViewData(req: FastifyRequest): Record<string, unknown> {
      const u = actor(req);
      return {
        csrfToken: req.csrfToken ?? '',
        role: u.role,
        user: { name: u.name, email: u.email, role: u.role },
        fmtTime,
        statusClass,
      };
    }

    function loadReadable(req: FastifyRequest, ticketId: string) {
      const t = repo.getTicketView(deps.db, ticketId);
      if (!t) throw new HttpError(404, 'Ticket not found');
      const a = actor(req);
      const access: AccessInput = {
        actor: { id: a.id, role: a.role },
        ticket: t,
        teamMember: t.team_id !== null && repo.isTeamMember(deps.db, t.team_id, a.id),
        watcher: repo.isWatcher(deps.db, t.id, a.id),
      };
      if (!canReadTicket(access)) throw new HttpError(404, 'Ticket not found');
      return { ticket: t, access };
    }

    function showFor(access: AccessInput, t: repo.TicketRow): Record<string, boolean> {
      const st = t.status;
      return {
        assign: canAssign(access) && canTransition('assign', st),
        start: canWorkOnTicket(access) && canTransition('start', st),
        block: canWorkOnTicket(access) && canTransition('block', st),
        unblock: canWorkOnTicket(access) && canTransition('unblock', st),
        resolve: canWorkOnTicket(access) && canTransition('resolve', st),
        close: canCloseTicket(access) && canTransition('close', st),
        reopen: canReopenTicket(access) && canTransition('reopen', st),
        edit: canEditDetails(access) && st !== 'CLOSED',
      };
    }

    /** Full ticket detail page (also used to re-render after a 422). */
    function renderDetail(
      req: FastifyRequest,
      reply: FastifyReply,
      ticketId: string,
      extra: { conflict?: boolean; formError?: string } = {},
      status = 200,
    ): FastifyReply {
      const { ticket, access } = loadReadable(req, ticketId);
      const events = repo
        .listEvents(deps.db, ticketId)
        .map((e) => ({ ...e, meta: JSON.parse(e.metadata_json) as Record<string, unknown> }));
      return reply.status(status).view('ticket.ejs', {
        title: `${formatTicketNo(ticket.ticket_no)} · Ticketing`,
        ...baseViewData(req),
        current: 'ticket',
        inShell: true,
        ticket,
        ticketNo: formatTicketNo(ticket.ticket_no),
        conflict: extra.conflict === true,
        formError: extra.formError ?? '',
        show: showFor(access, ticket),
        canComment: canComment(access),
        canInternalNote: canInternalNote(access),
        isWatcher: access.watcher,
        resolutions: repo.listResolutions(deps.db, ticketId),
        comments: repo.listComments(deps.db, ticketId),
        events,
        users: repo.listActiveUsers(deps.db),
        userNames: repo.userNames(deps.db),
        attachments: attachments.listAttachments(deps.db, ticketId).map((a) => ({
          ...a,
          canDelete:
            a.uploaded_by === access.actor.id ||
            ticket.created_by === access.actor.id ||
            access.actor.role === 'admin' ||
            access.actor.role === 'manager',
        })),
        canUpload: canComment(access) && ticket.status !== 'CLOSED',
        maxUploadBytes: deps.config.maxUploadBytes,
      });
    }

    /**
     * Run a mutating service call. 409 -> reload hint on the detail page;
     * 422 -> re-render the detail page with the validation error; anything
     * else propagates to the global error handler.
     */
    function afterMutation(
      req: FastifyRequest,
      reply: FastifyReply,
      ticketId: string,
      fn: () => void,
    ): FastifyReply {
      try {
        fn();
      } catch (err) {
        if (err instanceof HttpError && err.statusCode === 409) {
          return reply.redirect(`/tickets/${ticketId}?conflict=1`, 302);
        }
        if (err instanceof HttpError && err.statusCode === 422) {
          return renderDetail(req, reply, ticketId, { formError: err.message }, 422);
        }
        throw err;
      }
      return reply.redirect(`/tickets/${ticketId}`, 302);
    }

    scope.get('/tickets', async (req, reply) => {
      const a = actor(req);
      const q = req.query as Record<string, string | undefined>;
      const status = isTicketStatus(q.status) ? q.status : undefined;
      const listScope = q.scope === 'assigned' || q.scope === 'created' ? q.scope : 'all';
      const page = Math.max(1, Number.parseInt(q.page ?? '1', 10) || 1);
      const pageSize = Math.min(100, Math.max(1, Number.parseInt(q.pageSize ?? '25', 10) || 25));
      const { rows, total } = repo.listTickets(deps.db, a, { status, scope: listScope }, page, pageSize);
      const pages = Math.max(1, Math.ceil(total / pageSize));
      return reply.view('tickets.ejs', {
        title: 'Tickets · Ticketing',
        ...baseViewData(req),
        current: 'tickets',
        inShell: true,
        canCreate: canCreateTicket(a.role),
        rows,
        total,
        page,
        pages,
        statusFilter: status ?? '',
        scopeFilter: listScope,
        statuses: TICKET_STATUSES,
      });
    });

    scope.get('/tickets/new', async (req, reply) => {
      const a = actor(req);
      if (!canCreateTicket(a.role)) throw new HttpError(403, 'You cannot create tickets.');
      return reply.view('ticket-new.ejs', {
        title: 'New ticket · Ticketing',
        ...baseViewData(req),
        current: 'new',
        inShell: true,
        errors: [] as string[],
        values: {} as Record<string, string>,
        teams: repo.listTeams(deps.db),
        categories: repo.listCategories(deps.db, true),
        users: repo.listActiveUsers(deps.db),
        kinds: TICKET_KINDS,
        priorities: TICKET_PRIORITIES,
        visibilities: TICKET_VISIBILITIES,
      });
    });

    scope.post('/tickets', async (req, reply) => {
      checkCsrf(req);
      const a = actor(req);
      if (!canCreateTicket(a.role)) throw new HttpError(403, 'You cannot create tickets.');
      const body = req.body as Record<string, string | undefined>;
      const values: svc.CreateTicketInput = {
        title: body.title ?? '',
        description: body.description ?? '',
        kind: body.kind ?? 'TASK',
        categoryId: body.categoryId ?? '',
        teamId: body.teamId ?? '',
        visibility: body.visibility ?? 'TEAM',
        priority: body.priority ?? 'MEDIUM',
        assigneeId: body.assigneeId ?? '',
        dueAt: body.dueAt ?? '',
      };
      try {
        const created = svc.createTicket({ db: deps.db, actor: a }, values);
        return reply.redirect(`/tickets/${created.id}`, 302);
      } catch (err) {
        if (err instanceof HttpError && err.statusCode === 422) {
          return reply.status(422).view('ticket-new.ejs', {
            title: 'New ticket · Ticketing',
            ...baseViewData(req),
            current: 'new',
            inShell: true,
            errors: [err.message],
            values,
            teams: repo.listTeams(deps.db),
            categories: repo.listCategories(deps.db, true),
            users: repo.listActiveUsers(deps.db),
            kinds: TICKET_KINDS,
            priorities: TICKET_PRIORITIES,
            visibilities: TICKET_VISIBILITIES,
          });
        }
        throw err;
      }
    });

    scope.get('/tickets/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const conflict = (req.query as Record<string, string>).conflict === '1';
      return renderDetail(req, reply, id, { conflict });
    });

    scope.get('/tickets/:id/edit', async (req, reply) => {
      const { id } = req.params as { id: string };
      const { ticket, access } = loadReadable(req, id);
      if (!canEditDetails(access)) throw new HttpError(403, 'You cannot edit this ticket.');
      if (ticket.status === 'CLOSED') throw new HttpError(422, 'Closed tickets are read-only. Reopen to edit.');
      return reply.view('ticket-edit.ejs', {
        title: `Edit ${formatTicketNo(ticket.ticket_no)} · Ticketing`,
        ...baseViewData(req),
        current: 'edit',
        inShell: true,
        ticket,
        ticketNo: formatTicketNo(ticket.ticket_no),
        errors: [] as string[],
        teams: repo.listTeams(deps.db),
        categories: repo.listCategories(deps.db, true),
        priorities: TICKET_PRIORITIES,
        visibilities: TICKET_VISIBILITIES,
      });
    });

    scope.post('/tickets/:id', async (req, reply) => {
      checkCsrf(req);
      const { id } = req.params as { id: string };
      const a = actor(req);
      const body = req.body as Record<string, string | undefined>;
      const input = {
        title: body.title ?? '',
        description: body.description ?? '',
        priority: body.priority ?? '',
        visibility: body.visibility ?? '',
        categoryId: body.categoryId ?? '',
        teamId: body.teamId ?? '',
        dueAt: body.dueAt ?? '',
      };
      const render422 = (message: string) => {
        const t = repo.getTicket(deps.db, id);
        if (!t) throw new HttpError(404, 'Ticket not found');
        return reply.status(422).view('ticket-edit.ejs', {
          title: `Edit ${formatTicketNo(t.ticket_no)} · Ticketing`,
          ...baseViewData(req),
          current: 'edit',
          inShell: true,
          ticket: t,
          ticketNo: formatTicketNo(t.ticket_no),
          errors: [message],
          teams: repo.listTeams(deps.db),
          categories: repo.listCategories(deps.db, true),
          priorities: TICKET_PRIORITIES,
          visibilities: TICKET_VISIBILITIES,
        });
      };
      try {
        svc.editTicket({ db: deps.db, actor: a }, id, body.version, input);
      } catch (err) {
        if (err instanceof HttpError && err.statusCode === 409) {
          return reply.redirect(`/tickets/${id}?conflict=1`, 302);
        }
        if (err instanceof HttpError && err.statusCode === 422) {
          return render422(err.message);
        }
        throw err;
      }
      return reply.redirect(`/tickets/${id}`, 302);
    });

    scope.post('/tickets/:id/assign', async (req, reply) => {
      checkCsrf(req);
      const { id } = req.params as { id: string };
      const a = actor(req);
      const body = req.body as Record<string, string | undefined>;
      return afterMutation(req, reply, id, () => {
        svc.assignTicket({ db: deps.db, actor: a }, id, body.assigneeId ?? '', body.version);
      });
    });

    scope.post('/tickets/:id/start', async (req, reply) => {
      checkCsrf(req);
      const { id } = req.params as { id: string };
      const a = actor(req);
      const body = req.body as Record<string, string | undefined>;
      return afterMutation(req, reply, id, () => {
        svc.startWork({ db: deps.db, actor: a }, id, body.version, body.note ?? '');
      });
    });

    scope.post('/tickets/:id/block', async (req, reply) => {
      checkCsrf(req);
      const { id } = req.params as { id: string };
      const a = actor(req);
      const body = req.body as Record<string, string | undefined>;
      return afterMutation(req, reply, id, () => {
        svc.blockTicket({ db: deps.db, actor: a }, id, body.version, body.reason ?? '');
      });
    });

    scope.post('/tickets/:id/unblock', async (req, reply) => {
      checkCsrf(req);
      const { id } = req.params as { id: string };
      const a = actor(req);
      const body = req.body as Record<string, string | undefined>;
      return afterMutation(req, reply, id, () => {
        svc.unblockTicket({ db: deps.db, actor: a }, id, body.version);
      });
    });

    scope.post('/tickets/:id/resolve', async (req, reply) => {
      checkCsrf(req);
      const { id } = req.params as { id: string };
      const a = actor(req);
      const body = req.body as Record<string, string | undefined>;
      return afterMutation(req, reply, id, () => {
        svc.resolveTicket(
          { db: deps.db, actor: a },
          id,
          body.version,
          {
            issueSummary: body.issueSummary ?? '',
            actionsTaken: body.actionsTaken ?? '',
            resolution: body.resolution ?? '',
            rootCause: body.rootCause ?? '',
          },
        );
      });
    });

    scope.post('/tickets/:id/close', async (req, reply) => {
      checkCsrf(req);
      const { id } = req.params as { id: string };
      const a = actor(req);
      const body = req.body as Record<string, string | undefined>;
      return afterMutation(req, reply, id, () => {
        svc.closeTicket({ db: deps.db, actor: a }, id, body.version);
      });
    });

    scope.post('/tickets/:id/reopen', async (req, reply) => {
      checkCsrf(req);
      const { id } = req.params as { id: string };
      const a = actor(req);
      const body = req.body as Record<string, string | undefined>;
      return afterMutation(req, reply, id, () => {
        svc.reopenTicket({ db: deps.db, actor: a }, id, body.version, body.reason ?? '');
      });
    });

    scope.post('/tickets/:id/comments', async (req, reply) => {
      checkCsrf(req);
      const { id } = req.params as { id: string };
      const a = actor(req);
      const body = req.body as Record<string, string | undefined>;
      return afterMutation(req, reply, id, () => {
        svc.addComment({ db: deps.db, actor: a }, id, body.content ?? '', body.internal === '1');
      });
    });

    scope.post('/tickets/:id/watch', async (req, reply) => {
      checkCsrf(req);
      const { id } = req.params as { id: string };
      const a = actor(req);
      const body = req.body as Record<string, string | undefined>;
      return afterMutation(req, reply, id, () => {
        svc.setWatcher({ db: deps.db, actor: a }, id, body.userId ?? a.id, body.watch === '1');
      });
    });
  });
}