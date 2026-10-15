import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from './helpers.js';
import * as svc from '../src/modules/tickets/service.js';
import * as repo from '../src/modules/tickets/repository.js';
import { fromNodeHeaders } from '../src/auth/session.js';
import { csrfToken } from '../src/lib/csrf.js';
import type { AuthUser } from '../src/auth/session.js';

const SECRET = 'test-secret-0123456789abcdef0123456789';

let app: TestApp;
let user: AuthUser;
let manager: AuthUser;
let viewer: AuthUser;
let worker: AuthUser;
let userCookie: string;
let viewerCookie: string;

beforeAll(async () => {
  app = await makeTestApp();
  user = await app.createUser({ email: 'user@test.local', name: 'User', role: 'user', accessLevel: 'user' });
  manager = await app.createUser({ email: 'manager@test.local', name: 'Manager', role: 'user', accessLevel: 'manager' });
  viewer = await app.createUser({ email: 'viewer@test.local', name: 'Viewer', role: 'user', accessLevel: 'viewer' });
  worker = await app.createUser({ email: 'worker@test.local', name: 'Worker', role: 'user', accessLevel: 'user' });
  userCookie = await signInCookie('user@test.local');
  viewerCookie = await signInCookie('viewer@test.local');
});

afterAll(async () => {
  await app.close();
});

function deps(actor: AuthUser) {
  return { db: app.ctx.db, actor };
}

function makeTicket(actor: AuthUser, over: Partial<svc.CreateTicketInput> = {}) {
  return svc.createTicket(deps(actor), {
    title: 'Notification ticket',
    description: 'A ticket used by the notification tests.',
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

async function signInCookie(email: string): Promise<string> {
  const res = await app.ctx.app.inject({
    method: 'POST',
    url: '/login',
    payload: new URLSearchParams({ email, password: 'TestPass12345!' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost:3000' },
  });
  const cookies = res.headers['set-cookie'];
  const list = Array.isArray(cookies) ? cookies : [cookies];
  const match = list.find((c) => String(c).startsWith('better-auth.session_token='));
  return String(match).split(';')[0];
}

async function csrfFor(cookie: string): Promise<string> {
  const session = await app.ctx.auth.api.getSession({ headers: fromNodeHeaders({ cookie }) });
  return csrfToken(SECRET, session!.session.token);
}

function postForm(cookie: string, url: string, csrf: string) {
  return app.ctx.app.inject({
    method: 'POST',
    url,
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost:3000' },
    payload: new URLSearchParams({ csrfToken: csrf }).toString(),
  });
}

function unreadFor(userId: string) {
  return app.ctx.db
    .prepare('SELECT COUNT(*) AS n FROM app_notifications WHERE recipient_id = ? AND read_at IS NULL')
    .get(userId) as { n: number };
}

describe('notification creation and dedup', () => {
  it('notifies the creator on assignment and does not duplicate on reassignment', () => {
    const { id } = makeTicket(user);
    svc.assignTicket(deps(manager), id, user.id, repo.getTicket(app.ctx.db, id)!.version);
    let rows = app.ctx.db
      .prepare('SELECT kind FROM app_notifications WHERE ticket_id = ? AND recipient_id = ?')
      .all(id, user.id) as { kind: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('ticket_assigned');

    svc.assignTicket(deps(manager), id, manager.id, repo.getTicket(app.ctx.db, id)!.version);
    rows = app.ctx.db
      .prepare('SELECT kind FROM app_notifications WHERE ticket_id = ? AND recipient_id = ?')
      .all(id, user.id) as { kind: string }[];
    expect(rows).toHaveLength(1);
  });

  it('creates a notification for each workflow event kind', () => {
    // The creator and the assignee are different people so that every
    // transition has at least one recipient other than the actor.
    const { id } = makeTicket(user);
    svc.assignTicket(deps(manager), id, worker.id, repo.getTicket(app.ctx.db, id)!.version);
    svc.startWork(deps(worker), id, repo.getTicket(app.ctx.db, id)!.version, 'digging');
    svc.blockTicket(deps(worker), id, repo.getTicket(app.ctx.db, id)!.version, 'waiting on vendor');
    svc.unblockTicket(deps(worker), id, repo.getTicket(app.ctx.db, id)!.version);
    svc.resolveTicket(deps(worker), id, repo.getTicket(app.ctx.db, id)!.version, {
      issueSummary: 'long enough summary',
      actionsTaken: 'long enough actions',
      resolution: 'long enough resolution',
    });
    svc.closeTicket(deps(user), id, repo.getTicket(app.ctx.db, id)!.version);
    svc.reopenTicket(deps(user), id, repo.getTicket(app.ctx.db, id)!.version, 'It broke again.');
    const kinds = (
      app.ctx.db.prepare('SELECT DISTINCT kind FROM app_notifications WHERE ticket_id = ?').all(id) as { kind: string }[]
    ).map((r) => r.kind);
    for (const k of [
      'ticket_assigned',
      'ticket_started',
      'ticket_blocked',
      'ticket_unblocked',
      'ticket_resolved',
      'ticket_closed',
      'ticket_reopened',
    ]) {
      expect(kinds).toContain(k);
    }
  });
});

describe('notifications routes', () => {
  it('lists notifications and reports unread count as JSON', async () => {
    const { id } = makeTicket(user, { title: 'Badge ticket' });
    svc.assignTicket(deps(manager), id, user.id, repo.getTicket(app.ctx.db, id)!.version);

    const page = await app.ctx.app.inject({ method: 'GET', url: '/notifications', headers: { cookie: userCookie } });
    expect(page.statusCode).toBe(200);
    expect(page.payload).toContain('Badge ticket');

    const json = await app.ctx.app.inject({ method: 'GET', url: '/notifications/unread', headers: { cookie: userCookie } });
    expect(json.statusCode).toBe(200);
    const data = JSON.parse(json.body) as { count: number; items: { title: string | null }[] };
    expect(data.count).toBeGreaterThanOrEqual(1);
    expect(data.items.some((i) => i.title === 'Badge ticket')).toBe(true);
  });

  it('marks a notification read with CSRF and enforces ownership', async () => {
    const { id } = makeTicket(user, { title: 'Read mark ticket' });
    svc.assignTicket(deps(manager), id, user.id, repo.getTicket(app.ctx.db, id)!.version);
    const row = app.ctx.db
      .prepare('SELECT id FROM app_notifications WHERE ticket_id = ? AND recipient_id = ?')
      .get(id, user.id) as { id: string };

    const foreign = await postForm(viewerCookie, `/notifications/${row.id}/read`, await csrfFor(viewerCookie));
    expect(foreign.statusCode).toBe(404);

    const ok = await postForm(userCookie, `/notifications/${row.id}/read`, await csrfFor(userCookie));
    expect(ok.statusCode).toBe(302);
    const after = app.ctx.db.prepare('SELECT read_at FROM app_notifications WHERE id = ?').get(row.id) as { read_at: number | null };
    expect(after.read_at).not.toBeNull();
  });

  it('redacts notifications for tickets the recipient can no longer read', async () => {
    // The creator assigns (a manager cannot even see a RESTRICTED ticket).
    const { id } = makeTicket(user, { title: 'Redaction ticket', visibility: 'RESTRICTED' });
    svc.assignTicket(deps(user), id, viewer.id, repo.getTicket(app.ctx.db, id)!.version);

    let json = await app.ctx.app.inject({ method: 'GET', url: '/notifications/unread', headers: { cookie: viewerCookie } });
    let data = JSON.parse(json.body) as { items: { title: string | null }[] };
    expect(data.items.some((i) => i.title === 'Redaction ticket')).toBe(true);

    // Reassign back to the creator: the viewer loses all access.
    svc.assignTicket(deps(user), id, user.id, repo.getTicket(app.ctx.db, id)!.version);
    json = await app.ctx.app.inject({ method: 'GET', url: '/notifications/unread', headers: { cookie: viewerCookie } });
    data = JSON.parse(json.body) as { items: { title: string | null }[] };
    expect(data.items.some((i) => i.title === null)).toBe(true);
  });

  it('marks all notifications read', async () => {
    const { id } = makeTicket(user, { title: 'Bulk read ticket' });
    svc.assignTicket(deps(manager), id, user.id, repo.getTicket(app.ctx.db, id)!.version);
    svc.startWork(deps(user), id, repo.getTicket(app.ctx.db, id)!.version, 'go');
    expect(unreadFor(user.id).n).toBeGreaterThanOrEqual(2);

    const res = await postForm(userCookie, '/notifications/read-all', await csrfFor(userCookie));
    expect(res.statusCode).toBe(302);
    expect(unreadFor(user.id).n).toBe(0);
  });
});