// P6.3 write burst: 100 VUs each fire a rapid sequence of comment writes
// starting at t=0 (k6 starts all VUs simultaneously), to probe SQLite WAL
// writer serialization and busy-timeout behavior under contention.
//
// k6 2.x notes: `exec` takes a single function name; per-VU state lives in
// module-level variables (each VU gets its own JS context).
//
// Run: k6 run --env TARGET=http://127.0.0.1:3199 load/k6/burst.js

import http from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';

const TARGET = __ENV.TARGET || 'http://127.0.0.1:3199';
const manifest = JSON.parse(open('../seed-manifest.json'));
const users = new SharedArray('users', () => manifest.users);
const BURST_WRITES = Number.parseInt(__ENV.BURST_WRITES || '10', 10);

export const options = {
  scenarios: {
    burst: {
      executor: 'constant-vus',
      exec: 'burst',
      vus: Number.parseInt(__ENV.VUS || '100', 10),
      iterations: 1,
    },
  },
  thresholds: {
    // A burst is allowed to be slower than steady state, but must not fail:
    // no 5xx, no 429 (rate limit), no 409 (each VU writes its own tickets).
    'http_req_duration{op:write}': ['p(95)<3000'],
    'http_req_failed{status:500}': ['rate<0.001'],
    'http_req_failed{status:502}': ['rate<0.001'],
    'http_req_failed{status:503}': ['rate<0.001'],
    'http_req_failed{status:504}': ['rate<0.001'],
    checks: ['rate>0.995'],
  },
};

const FORM = { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };

let me = null;
let loggedIn = false;

function csrfOf(body) {
  const m = body.match(/name="csrfToken" value="([^"]+)"/);
  return m ? m[1] : null;
}

function login() {
  const user = users[__VU - 1];
  const res = http.post(
    `${TARGET}/api/auth/sign-in/email`,
    JSON.stringify({ email: user.email, password: user.password }),
    { headers: { 'Content-Type': 'application/json' }, tags: { op: 'auth' } },
  );
  check(res, { 'login: 200': (r) => r.status === 200 });
  if (res.status !== 200) throw new Error(`login failed for ${user.email}: ${res.status}`);
  return user;
}

export function burst() {
  if (!loggedIn) {
    me = login();
    loggedIn = true;
  }
  for (let i = 0; i < BURST_WRITES; i++) {
    const ticketId = me.tickets[i % me.tickets.length];
    const page = http.get(`${TARGET}/tickets/${ticketId}`, { tags: { op: 'read' } });
    const token = csrfOf(page.body);
    if (!token) throw new Error(`no CSRF token for ${ticketId}`);
    const res = http.post(
      `${TARGET}/tickets/${ticketId}/comments`,
      `csrfToken=${encodeURIComponent(token)}&content=${encodeURIComponent(`burst ${__VU} ${i}`)}`,
      { ...FORM, tags: { op: 'write' } },
    );
    check(res, { 'burst comment: 302': (r) => r.status === 302 });
  }
}