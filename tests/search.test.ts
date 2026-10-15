import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from './helpers.js';
import * as svc from '../src/modules/tickets/service.js';
import * as repo from '../src/modules/tickets/repository.js';
import { parseSearchQuery, searchTickets } from '../src/modules/search/repository.js';
import type { AuthUser } from '../src/auth/session.js';

let app: TestApp;
let user: AuthUser;
let viewer: AuthUser;

beforeAll(async () => {
  app = await makeTestApp();
  user = await app.createUser({ email: 'user@test.local', name: 'User', role: 'user', accessLevel: 'user' });
  viewer = await app.createUser({ email: 'viewer@test.local', name: 'Viewer', role: 'user', accessLevel: 'viewer' });
});

afterAll(async () => {
  await app.close();
});

function deps(actor: AuthUser) {
  return { db: app.ctx.db, actor };
}

function makeTicket(actor: AuthUser, over: Partial<svc.CreateTicketInput> = {}) {
  return svc.createTicket(deps(actor), {
    title: 'Search ticket',
    description: 'A ticket used by the search tests.',
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

describe('parseSearchQuery', () => {
  it('detects exact ticket numbers', () => {
    expect(parseSearchQuery('TKT-000007')).toEqual({ fts: null, ticketNo: 7 });
    expect(parseSearchQuery('TKT-7')).toEqual({ fts: null, ticketNo: 7 });
    // 7 digits is not a valid ticket number, so it degrades to a text search.
    expect(parseSearchQuery('TKT-9999999')).toEqual({ fts: '"TKT-9999999"', ticketNo: null });
  });

  it('neutralizes FTS operator injection', () => {
    const { fts } = parseSearchQuery('a OR b AND NOT c');
    expect(fts).toBeTruthy();
    // Every token is a double-quoted literal, so FTS operators cannot be injected.
    for (const token of fts!.split(' ')) {
      expect(token.startsWith('"') && token.endsWith('"')).toBe(true);
    }
  });

  it('caps the number of terms at 10', () => {
    const { fts } = parseSearchQuery('a b c d e f g h i j k l');
    const terms = fts!.split('"').filter((t) => t.trim().length > 0);
    expect(terms.length).toBe(10);
  });

  it('returns nulls for empty input', () => {
    expect(parseSearchQuery('')).toEqual({ fts: null, ticketNo: null });
    expect(parseSearchQuery('   ')).toEqual({ fts: null, ticketNo: null });
  });
});

describe('searchTickets visibility', () => {
  it('hides RESTRICTED tickets from non-participants', () => {
    makeTicket(user, { title: 'Printer jam alpha', description: 'The printer keeps jamming alpha.' });
    const restricted = makeTicket(user, {
      title: 'Secret budget beta',
      description: 'Restricted budget discussion beta.',
      visibility: 'RESTRICTED',
    });

    const asViewer = searchTickets(app.ctx.db, { actor: viewer, query: 'beta', page: 1, pageSize: 25 });
    expect(asViewer.rows.map((r) => r.id)).not.toContain(restricted.id);

    const asUser = searchTickets(app.ctx.db, { actor: user, query: 'beta', page: 1, pageSize: 25 });
    expect(asUser.rows.map((r) => r.id)).toContain(restricted.id);
    expect(asUser.total).toBe(1);
  });

  it('matches exact ticket numbers', () => {
    const { ticketNo } = makeTicket(user, { title: 'Exact number ticket', description: 'Find me by number.' });
    const res = searchTickets(app.ctx.db, { actor: user, query: `TKT-${ticketNo}`, page: 1, pageSize: 25 });
    expect(res.total).toBe(1);
    expect(res.rows[0]!.ticket_no).toBe(ticketNo);
  });

  it('matches resolution text', () => {
    const { id } = makeTicket(user, { title: 'Resolution search ticket', description: 'Will be resolved with a unique word.' });
    svc.assignTicket(deps(user), id, user.id, repo.getTicket(app.ctx.db, id)!.version);
    svc.startWork(deps(user), id, repo.getTicket(app.ctx.db, id)!.version, 'digging');
    svc.resolveTicket(deps(user), id, repo.getTicket(app.ctx.db, id)!.version, {
      issueSummary: 'zebrafinch issue summary',
      actionsTaken: 'long enough actions',
      resolution: 'The zebrafinch was fixed.',
    });
    const res = searchTickets(app.ctx.db, { actor: user, query: 'zebrafinch', page: 1, pageSize: 25 });
    expect(res.rows.map((r) => r.id)).toContain(id);
  });

  it('paginates results', () => {
    for (let i = 0; i < 6; i++) {
      makeTicket(user, { title: `Paging ticket ${i}`, description: `Paging description number ${i}.` });
    }
    const page1 = searchTickets(app.ctx.db, { actor: user, query: 'paging', page: 1, pageSize: 4 });
    const page2 = searchTickets(app.ctx.db, { actor: user, query: 'paging', page: 2, pageSize: 4 });
    expect(page1.rows).toHaveLength(4);
    expect(page2.rows.length).toBeLessThanOrEqual(4);
    expect(page1.rows.length + page2.rows.length).toBe(page1.total);
  });
});

describe('GET /search', () => {
  it('renders only visible tickets', async () => {
    makeTicket(user, { title: 'Visible search ticket', description: 'A team ticket for search.' });
    makeTicket(user, { title: 'Hidden search ticket', description: 'A restricted ticket for search.', visibility: 'RESTRICTED' });
    const cookie = await signInCookie('viewer@test.local');
    const res = await app.ctx.app.inject({ method: 'GET', url: '/search?q=search', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('Visible search ticket');
    expect(res.payload).not.toContain('Hidden search ticket');
  });

  it('redirects anonymous visitors to login', async () => {
    const res = await app.ctx.app.inject({ method: 'GET', url: '/search?q=x' });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain('/login');
  });
});