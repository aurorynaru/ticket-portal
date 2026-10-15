// P6.3 mixed 100-user workload: reads + writes against the seeded load DB.
//
// Each VU signs in once as its own seeded user (real session cookie + CSRF
// token) and mixes reads with writes on tickets it can legitimately touch, so
// the run exercises the real authorization path and avoids 409 conflicts.
//
// k6 2.x notes: `exec` takes a single function name; per-VU state lives in
// module-level variables (each VU gets its own JS context).
//
// Run: k6 run --env TARGET=http://127.0.0.1:3199 load/k6/mixed.js
// (npm run load:mixed does this with the local target.)

import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

const TARGET = __ENV.TARGET || 'http://127.0.0.1:3199';
const manifest = JSON.parse(open('../seed-manifest.json'));
const users = new SharedArray('users', () => manifest.users);

export const options = {
  scenarios: {
    mixed: {
      executor: 'constant-vus',
      exec: 'work',
      vus: Number.parseInt(__ENV.VUS || '100', 10),
      duration: __ENV.DURATION || '5m',
    },
  },
  thresholds: {
    // Acceptance targets (docs/10): read p95 < 500 ms, ticket update p95 < 1 s.
    'http_req_duration{op:read}': ['p(95)<500'],
    'http_req_duration{op:write}': ['p(95)<1000'],
    // No 5xx; k6 tag filters are exact-match only.
    'http_req_failed{status:500}': ['rate<0.001'],
    'http_req_failed{status:502}': ['rate<0.001'],
    'http_req_failed{status:503}': ['rate<0.001'],
    'http_req_failed{status:504}': ['rate<0.001'],
    checks: ['rate>0.995'],
  },
};

const FORM = { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };

// Per-VU state (each VU has its own JS context).
let me = null;
let loggedIn = false;
let sessionCookie = null;

// k6 2.x resets the per-VU cookie jar between iterations, which silently drops
// the session cookie and makes the app redirect to /login. We therefore capture
// the session cookie value once at login and send it explicitly on every
// request, bypassing the jar entirely.
function H(extra = {}) {
  return { Cookie: `better-auth.session_token=${sessionCookie}`, ...extra };
}

function csrfOf(body) {
  const m = body.match(/name="csrfToken" value="([^"]+)"/);
  return m ? m[1] : null;
}

function field(body, name) {
  const m = body.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`));
  return m ? m[1] : '';
}

function selectedOption(body, name) {
  const sel = body.match(new RegExp(`<select name="${name}"[\\s\\S]*?</select>`));
  if (!sel) return '';
  const opt = sel[0].match(/<option value="([^"]*)" selected/);
  return opt ? opt[1] : '';
}

function textarea(body, name) {
  const m = body.match(new RegExp(`<textarea name="${name}"[^>]*>([\\s\\S]*?)</textarea>`));
  return m ? m[1] : '';
}

function login() {
  const user = users[__VU - 1];
  const res = http.post(
    `${TARGET}/api/auth/sign-in/email`,
    JSON.stringify({ email: user.email, password: user.password }),
    { headers: { 'Content-Type': 'application/json' }, tags: { op: 'auth' } },
  );
  check(res, {
    'login: 200': (r) => r.status === 200,
    'login: session cookie': (r) => r.cookies['better-auth.session_token'] !== undefined,
  });
  if (res.status !== 200) {
    throw new Error(`login failed for ${user.email}: ${res.status}`);
  }
  const c = res.cookies['better-auth.session_token'];
  const arr = Array.isArray(c) ? c : [c];
  sessionCookie = arr.length ? arr[0].value : null;
  if (!sessionCookie) throw new Error(`no session cookie for ${user.email}`);
  return user;
}

function fetchCsrf(url) {
  const res = http.get(url, { headers: H(), tags: { op: 'read' } });
  check(res, { 'page: 200': (r) => r.status === 200 });
  const token = csrfOf(res.body);
  if (!token) {
    throw new Error(`no CSRF token on ${url} (final=${res.url} status=${res.status})`);
  }
  return token;
}

function writeComment(ticketId) {
  const token = fetchCsrf(`${TARGET}/tickets/${ticketId}`);
  const res = http.post(
    `${TARGET}/tickets/${ticketId}/comments`,
    `csrfToken=${encodeURIComponent(token)}&content=${encodeURIComponent(`k6 load comment ${__ITER}`)}`,
    { ...FORM, headers: H(FORM.headers), tags: { op: 'write' }, redirects: { max: 0 } },
  );
  check(res, { 'comment: 302': (r) => r.status === 302 });
}

function writeEdit(ticketId) {
  const page = http.get(`${TARGET}/tickets/${ticketId}/edit`, { headers: H(), tags: { op: 'read' } });
  check(page, { 'edit page: 200': (r) => r.status === 200 });
  const token = csrfOf(page.body);
  if (!token) {
    throw new Error(`no CSRF token on edit page ${ticketId} (final=${page.url} status=${page.status})`);
  }
  const body = [
    `csrfToken=${encodeURIComponent(token)}`,
    `version=${encodeURIComponent(field(page.body, 'version'))}`,
    `title=${encodeURIComponent(field(page.body, 'title'))}`,
    `description=${encodeURIComponent(textarea(page.body, 'description'))}`,
    `priority=${encodeURIComponent(selectedOption(page.body, 'priority'))}`,
    `visibility=${encodeURIComponent(selectedOption(page.body, 'visibility'))}`,
    `categoryId=${encodeURIComponent(selectedOption(page.body, 'categoryId'))}`,
    `teamId=${encodeURIComponent(selectedOption(page.body, 'teamId'))}`,
    `dueAt=${encodeURIComponent(field(page.body, 'dueAt'))}`,
  ].join('&');
  const res = http.post(`${TARGET}/tickets/${ticketId}`, body, { ...FORM, headers: H(FORM.headers), tags: { op: 'write' }, redirects: { max: 0 } });
  check(res, { 'edit: 302': (r) => r.status === 302 });
}

export function work() {
  if (!loggedIn) {
    me = login();
    loggedIn = true;
  }
  const r = Math.random();
  if (r < 0.3) {
    // Ticket list (paginated, scoped queries).
    const res = http.get(`${TARGET}/tickets?page=1&pageSize=25`, { headers: H(), tags: { op: 'read' } });
    check(res, { 'list: 200': (x) => x.status === 200 });
  } else if (r < 0.5) {
    // Ticket detail (events, comments, attachments, users).
    const id = me.tickets[__ITER % me.tickets.length];
    const res = http.get(`${TARGET}/tickets/${id}`, { headers: H(), tags: { op: 'read' } });
    check(res, { 'detail: 200': (x) => x.status === 200 });
  } else if (r < 0.62) {
    // FTS5 search.
    const q = `load+ticket+${__ITER % 50}`;
    const res = http.get(`${TARGET}/search?q=${q}&page=1`, { headers: H(), tags: { op: 'read' } });
    check(res, { 'search: 200': (x) => x.status === 200 });
  } else if (r < 0.7) {
    // Dashboard aggregates.
    const res = http.get(`${TARGET}/dashboard`, { headers: H(), tags: { op: 'read' } });
    check(res, { 'dashboard: 200': (x) => x.status === 200 });
  } else if (r < 0.9) {
    // Write: comment on an open team ticket (closed tickets reject comments).
    writeComment(me.openTickets[__ITER % me.openTickets.length]);
  } else {
    // Write: edit one of the VU's own open tickets (closed are read-only).
    writeEdit(me.ownOpen[__ITER % me.ownOpen.length]);
  }
  sleep(0.2 + Math.random() * 0.8);
}