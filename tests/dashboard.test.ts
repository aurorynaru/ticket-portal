import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from './helpers.js';
import * as svc from '../src/modules/tickets/service.js';
import * as dash from '../src/modules/dashboard/repository.js';
import { formatTicketNo } from '../src/modules/tickets/types.js';
import type { AuthUser } from '../src/auth/session.js';

let app: TestApp;
let admin: AuthUser;
let user: AuthUser;
let manager: AuthUser;
let viewer: AuthUser;
let userCookie: string;
let viewerCookie: string;

let noA = 0;
let noD = 0;

beforeAll(async () => {
  app = await makeTestApp();
  admin = await app.createUser({ email: 'admin@test.local', name: 'Admin', role: 'admin', accessLevel: 'manager' });
  user = await app.createUser({ email: 'user@test.local', name: 'User', role: 'user', accessLevel: 'user' });
  manager = await app.createUser({ email: 'manager@test.local', name: 'Manager', role: 'user', accessLevel: 'manager' });
  viewer = await app.createUser({ email: 'viewer@test.local', name: 'Viewer', role: 'user', accessLevel: 'viewer' });
  userCookie = await signInCookie('user@test.local');
  viewerCookie = await signInCookie('viewer@test.local');

  // A: user, TEAM, unassigned, OPEN
  noA = makeTicket(user, { title: 'Dash ticket A' }).ticketNo;
  // B: user, TEAM, assigned to user, ASSIGNED
  makeTicket(user, { title: 'Dash ticket B', assigneeId: user.id });
  // C: manager, TEAM, assigned to user, ASSIGNED
  makeTicket(manager, { title: 'Dash ticket C', assigneeId: user.id });
  // D: user, RESTRICTED, unassigned, OPEN
  noD = makeTicket(user, { title: 'Dash ticket D', visibility: 'RESTRICTED' }).ticketNo;
  // E: user, TEAM, assigned to user, overdue, ASSIGNED
  makeTicket(user, { title: 'Dash ticket E', assigneeId: user.id, dueAt: '2020-01-01' });
});

afterAll(async () => {
  await app.close();
});

function deps(actor: AuthUser) {
  return { db: app.ctx.db, actor };
}

function makeTicket(actor: AuthUser, over: Partial<svc.CreateTicketInput> = {}) {
  return svc.createTicket(deps(actor), {
    title: 'Dashboard ticket',
    description: 'A ticket used by the dashboard tests.',
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

describe('dashboard stats', () => {
  it('counts open tickets with visibility scoping', () => {
    const s = dash.dashboardStats(app.ctx.db, user);
    expect(s.assignedOpen).toBe(3);
    expect(s.createdOpen).toBe(4);
    expect(s.openTotal).toBe(5);
    expect(s.overdue).toBe(1);
    expect(s.resolved).toBe(0);
    expect(s.closed).toBe(0);

    const v = dash.dashboardStats(app.ctx.db, viewer);
    expect(v.openTotal).toBe(4);
    expect(v.assignedOpen).toBe(0);
    expect(v.createdOpen).toBe(0);
    expect(v.overdue).toBe(1);

    const a = dash.dashboardStats(app.ctx.db, admin);
    expect(a.openTotal).toBe(5);
  });

  it('lists recent activity scoped to visible tickets', () => {
    const items = dash.recentActivity(app.ctx.db, user, 10);
    expect(items.length).toBeGreaterThan(0);
    const vItems = dash.recentActivity(app.ctx.db, viewer, 10);
    expect(vItems.some((i) => i.title === 'Dash ticket D')).toBe(false);
    expect(items.some((i) => i.title === 'Dash ticket D')).toBe(true);
  });
});

describe('dashboard routes', () => {
  it('renders the dashboard at /dashboard and /', async () => {
    const res = await app.ctx.app.inject({ method: 'GET', url: '/dashboard', headers: { cookie: userCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('Dashboard');
    expect(res.payload).toContain('Overdue');

    const home = await app.ctx.app.inject({ method: 'GET', url: '/', headers: { cookie: userCookie } });
    expect(home.statusCode).toBe(200);
    expect(home.payload).toContain('Dashboard');
  });

  it('exports CSV of only visible tickets', async () => {
    const res = await app.ctx.app.inject({ method: 'GET', url: '/dashboard/export.csv', headers: { cookie: userCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.body.split('\n');
    expect(lines[0]).toBe('ticket_no,title,status,priority,kind,category,team,visibility,assignee,creator,created_at,updated_at,due_at');
    expect(res.body).toContain(formatTicketNo(noA));
    // The creator can see their own RESTRICTED ticket, so it is exported.
    expect(res.body).toContain(formatTicketNo(noD));

    const vRes = await app.ctx.app.inject({ method: 'GET', url: '/dashboard/export.csv', headers: { cookie: viewerCookie } });
    expect(vRes.statusCode).toBe(200);
    expect(vRes.body).not.toContain(formatTicketNo(noD));
  });

  it('quotes CSV fields containing commas or quotes', async () => {
    makeTicket(user, { title: 'CSV, "quoted" ticket' });
    const res = await app.ctx.app.inject({ method: 'GET', url: '/dashboard/export.csv', headers: { cookie: userCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"CSV, ""quoted"" ticket"');
  });
});