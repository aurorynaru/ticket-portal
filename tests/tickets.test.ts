import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpError } from '../src/lib/errors.js';
import * as repo from '../src/modules/tickets/repository.js';
import * as svc from '../src/modules/tickets/service.js';
import { makeTestApp, type TestApp } from './helpers.js';
import type { AuthUser } from '../src/auth/session.js';

let app: TestApp;
let admin: AuthUser;
let manager: AuthUser;
let user: AuthUser;
let viewer: AuthUser;

beforeAll(async () => {
  app = await makeTestApp();
  admin = await app.createUser({ email: 'admin@test.local', name: 'Admin', role: 'admin', accessLevel: 'manager' });
  manager = await app.createUser({ email: 'manager@test.local', name: 'Manager', role: 'user', accessLevel: 'manager' });
  user = await app.createUser({ email: 'user@test.local', name: 'User', role: 'user', accessLevel: 'user' });
  viewer = await app.createUser({ email: 'viewer@test.local', name: 'Viewer', role: 'user', accessLevel: 'viewer' });
});

afterAll(async () => {
  await app.close();
});

function deps(actor: AuthUser) {
  return { db: app.ctx.db, actor };
}

/** Run fn, expect an HttpError with the given status code. */
function expectHttpError(fn: () => void, statusCode: number): void {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(HttpError);
  expect((err as HttpError).statusCode).toBe(statusCode);
}

function makeTicket(actor: AuthUser, over: Partial<svc.CreateTicketInput> = {}) {
  return svc.createTicket(deps(actor), {
    title: 'Integration ticket',
    description: 'A ticket used by the integration tests.',
    kind: 'TASK',
    categoryId: '',
    teamId: 'team-general',
    visibility: 'TEAM',
    priority: 'MEDIUM',
    assigneeId: '',
    dueAt: '',
    ...over,
  });
}

describe('createTicket', () => {
  it('assigns a sequential ticket number and records a CREATED event', () => {
    const { id, ticketNo } = makeTicket(user);
    expect(ticketNo).toBeGreaterThanOrEqual(1);
    const t = repo.getTicket(app.ctx.db, id)!;
    expect(t.status).toBe('OPEN');
    expect(t.created_by).toBe(user.id);
    expect(t.version).toBe(1);
    const events = repo.listEvents(app.ctx.db, id);
    expect(events.map((e) => e.event_type)).toContain('TICKET_CREATED');
  });

  it('rejects short titles and descriptions', () => {
    expect(() => makeTicket(user, { title: 'ab' })).toThrow(HttpError);
    expect(() => makeTicket(user, { description: 'short' })).toThrow(HttpError);
  });

  it('rejects unknown enum values', () => {
    expect(() => makeTicket(user, { kind: 'NOPE' })).toThrow(HttpError);
    expect(() => makeTicket(user, { priority: 'URGENT' })).toThrow(HttpError);
    expect(() => makeTicket(user, { visibility: 'SECRET' })).toThrow(HttpError);
  });

  it('viewers cannot create tickets', () => {
    expect(() => makeTicket(viewer)).toThrow(HttpError);
  });
});

describe('due date parsing', () => {
  it('accepts the datetime-local format the edit/new forms submit', () => {
    const { id } = makeTicket(user, { dueAt: '2026-09-29T03:38' });
    const t = repo.getTicket(app.ctx.db, id)!;
    expect(t.due_at).not.toBeNull();
  });

  it('accepts a bare YYYY-MM-DD date', () => {
    const { id } = makeTicket(user, { dueAt: '2026-09-29' });
    expect(repo.getTicket(app.ctx.db, id)!.due_at).not.toBeNull();
  });

  it('rejects an unparseable due date', () => {
    expect(() => makeTicket(user, { dueAt: 'not-a-date' })).toThrow(HttpError);
  });

  it('applies a datetime-local due date on edit', () => {
    const { id } = makeTicket(user);
    const v = repo.getTicket(app.ctx.db, id)!.version;
    svc.editTicket(deps(manager), id, v, {
      title: 'Edited title',
      description: 'A brand new description body.',
      priority: 'MEDIUM',
      visibility: 'TEAM',
      categoryId: '',
      teamId: 'team-general',
      dueAt: '2026-10-01T09:30',
    });
    expect(repo.getTicket(app.ctx.db, id)!.due_at).not.toBeNull();
  });
});

describe('lifecycle', () => {
  it('runs the full happy path: assign -> start -> block -> unblock -> resolve -> close -> reopen', () => {
    const { id } = makeTicket(user);
    const t0 = repo.getTicket(app.ctx.db, id)!;

    svc.assignTicket(deps(manager), id, user.id, t0.version);
    expect(repo.getTicket(app.ctx.db, id)!.status).toBe('ASSIGNED');

    svc.startWork(deps(user), id, repo.getTicket(app.ctx.db, id)!.version, 'digging in');
    expect(repo.getTicket(app.ctx.db, id)!.status).toBe('IN_PROGRESS');

    svc.blockTicket(deps(user), id, repo.getTicket(app.ctx.db, id)!.version, 'waiting on vendor');
    expect(repo.getTicket(app.ctx.db, id)!.status).toBe('BLOCKED');

    svc.unblockTicket(deps(user), id, repo.getTicket(app.ctx.db, id)!.version);
    expect(repo.getTicket(app.ctx.db, id)!.status).toBe('IN_PROGRESS');

    svc.resolveTicket(deps(user), id, repo.getTicket(app.ctx.db, id)!.version, {
      issueSummary: 'Printer jammed repeatedly.',
      actionsTaken: 'Replaced the pickup roller.',
      resolution: 'Printer works again.',
      rootCause: 'Worn roller.',
    });
    const resolved = repo.getTicket(app.ctx.db, id)!;
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolved_at).not.toBeNull();
    expect(repo.latestResolution(app.ctx.db, id)).not.toBeNull();

    svc.closeTicket(deps(user), id, resolved.version);
    expect(repo.getTicket(app.ctx.db, id)!.status).toBe('CLOSED');

    svc.reopenTicket(deps(user), id, repo.getTicket(app.ctx.db, id)!.version, 'It jammed again.');
    const reopened = repo.getTicket(app.ctx.db, id)!;
    expect(reopened.status).toBe('ASSIGNED');
    expect(reopened.resolved_at).toBeNull();
    expect(repo.listEvents(app.ctx.db, id).some((e) => e.event_type === 'TICKET_REOPENED')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    const { id } = makeTicket(user);
    const v = repo.getTicket(app.ctx.db, id)!.version;
    expect(() => svc.startWork(deps(user), id, v, 'x')).toThrow(HttpError);
    expect(() => svc.resolveTicket(deps(user), id, v, {
      issueSummary: 'long enough summary',
      actionsTaken: 'long enough actions',
      resolution: 'long enough resolution',
    })).toThrow(HttpError);
    expect(() => svc.closeTicket(deps(user), id, v)).toThrow(HttpError);
  });

  it('requires resolution documentation before resolving', () => {
    const { id } = makeTicket(user);
    svc.assignTicket(deps(manager), id, user.id, repo.getTicket(app.ctx.db, id)!.version);
    const v = repo.getTicket(app.ctx.db, id)!.version;
    expect(() => svc.resolveTicket(deps(user), id, v, {
      issueSummary: 'too short',
      actionsTaken: 'long enough actions',
      resolution: 'long enough resolution',
    })).toThrow(HttpError);
  });

  it('requires a non-empty reason to block', () => {
    const { id } = makeTicket(user);
    svc.assignTicket(deps(manager), id, user.id, repo.getTicket(app.ctx.db, id)!.version);
    svc.startWork(deps(user), id, repo.getTicket(app.ctx.db, id)!.version, 'go');
    expect(() => svc.blockTicket(deps(user), id, repo.getTicket(app.ctx.db, id)!.version, '   ')).toThrow(HttpError);
  });
});

describe('authorization', () => {
  it('a viewer cannot work on, assign, or comment on a ticket', () => {
    const { id } = makeTicket(user);
    const v = repo.getTicket(app.ctx.db, id)!.version;
    expect(() => svc.assignTicket(deps(viewer), id, user.id, v)).toThrow(HttpError);
    expect(() => svc.startWork(deps(viewer), id, v, 'x')).toThrow(HttpError);
    expect(() => svc.addComment(deps(viewer), id, 'hello there')).toThrow(HttpError);
  });

  it('a manager can resolve a ticket on their own team', () => {
    const { id } = makeTicket(user);
    svc.assignTicket(deps(manager), id, user.id, repo.getTicket(app.ctx.db, id)!.version);
    const v = repo.getTicket(app.ctx.db, id)!.version;
    expect(() => svc.resolveTicket(deps(manager), id, v, {
      issueSummary: 'long enough summary',
      actionsTaken: 'long enough actions',
      resolution: 'long enough resolution',
    })).not.toThrow();
  });

  it('RESTRICTED tickets hide from non-participants (404)', () => {
    const { id } = makeTicket(user, { visibility: 'RESTRICTED' });
    // viewer is a team member, but RESTRICTED ignores team membership
    expectHttpError(() => svc.addComment(deps(viewer), id, 'can you see this?'), 404);
  });
});

describe('optimistic locking', () => {
  it('rejects a stale version with 409', () => {
    const { id } = makeTicket(user);
    const stale = repo.getTicket(app.ctx.db, id)!.version;
    svc.assignTicket(deps(manager), id, user.id, stale);
    expectHttpError(() => svc.assignTicket(deps(manager), id, manager.id, stale), 409);
  });
});

describe('audit log', () => {
  it('is append-only and grows with every mutation', () => {
    const { id } = makeTicket(user);
    const before = repo.countEvents(app.ctx.db, id);
    svc.assignTicket(deps(manager), id, user.id, repo.getTicket(app.ctx.db, id)!.version);
    svc.startWork(deps(user), id, repo.getTicket(app.ctx.db, id)!.version, 'x');
    const after = repo.countEvents(app.ctx.db, id);
    expect(after).toBe(before + 2);
    const events = repo.listEvents(app.ctx.db, id);
    expect(events.every((e) => e.actor_id)).toBe(true);
  });

  it('records who changed what on edits', () => {
    const { id } = makeTicket(user);
    const v = repo.getTicket(app.ctx.db, id)!.version;
    svc.editTicket(deps(manager), id, v, {
      title: 'Edited title',
      description: 'A brand new description body.',
      priority: 'HIGH',
      visibility: 'TEAM',
      categoryId: '',
      teamId: 'team-general',
      dueAt: '',
    });
    const ev = repo.listEvents(app.ctx.db, id).find((e) => e.event_type === 'TICKET_EDITED');
    expect(ev).toBeDefined();
    const meta = JSON.parse(ev!.metadata_json) as { fields: string[] };
    expect(meta.fields).toContain('title');
    expect(meta.fields).toContain('priority');
  });
});

describe('comments and notifications', () => {
  it('stores comments and flags internal notes', () => {
    const { id } = makeTicket(user);
    svc.addComment(deps(user), id, 'public note');
    svc.addComment(deps(manager), id, 'internal note', true);
    const comments = repo.listComments(app.ctx.db, id);
    expect(comments).toHaveLength(2);
    expect(comments.some((c) => c.is_internal === 1)).toBe(true);
  });

  it('notifies the creator when someone else acts on the ticket', () => {
    const { id } = makeTicket(user);
    svc.assignTicket(deps(manager), id, user.id, repo.getTicket(app.ctx.db, id)!.version);
    const rows = app.ctx.db
      .prepare('SELECT recipient_id, ticket_id FROM app_notifications WHERE ticket_id = ?')
      .all(id) as { recipient_id: string; ticket_id: string }[];
    expect(rows.some((r) => r.recipient_id === user.id)).toBe(true);
  });
});