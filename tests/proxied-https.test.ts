import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@better-auth/core/utils/id';
import { buildApp, type AppContext } from '../src/app.js';
import type { AppConfig } from '../src/config/env.js';
import { createProfile } from '../src/auth/profiles.js';
import { fromNodeHeaders } from '../src/auth/session.js';
import { csrfToken } from '../src/lib/csrf.js';

/**
 * Regression: production runs behind a TLS-terminating proxy (Railway). The
 * public origin is HTTPS, but the app's internal socket is plain HTTP. The
 * Fastify-to-Better Auth adapter must hand Better Auth a Request whose URL
 * carries the configured public HTTPS origin (BETTER_AUTH_URL), never a
 * fabricated `http://<host>` origin, or Better Auth's origin validation
 * rejects the sign-in with "Invalid origin: http://<public-host>".
 */
const SECRET = 'proxied-test-secret-0123456789abcdef0123';
const PUBLIC_ORIGIN = 'https://ticket-portal-production.up.railway.app';
const PUBLIC_HOST = 'ticket-portal-production.up.railway.app';

let tmpDir: string;
let ctx: AppContext;

function testConfig(): AppConfig {
  return {
    nodeEnv: 'test',
    isProduction: false,
    port: 0,
    databasePath: path.join(tmpDir, 'proxied.db'),
    uploadDir: path.join(tmpDir, 'uploads'),
    betterAuthUrl: PUBLIC_ORIGIN,
    betterAuthSecret: SECRET,
    sessionTrustedOrigin: PUBLIC_ORIGIN,
    defaultTimezone: 'UTC',
    maxUploadBytes: 1024,
    notificationPollSeconds: 45,
    logLevel: 'silent',
  };
}

async function seedAdmin(): Promise<void> {
  const context = await ctx.auth.$context;
  const internal = context.internalAdapter;
  const userId = generateId(32);
  const hash = await context.password.hash('Admin12345!');
  await internal.createUser(
    { id: userId, email: 'admin@prod.local', name: 'Prod Admin', emailVerified: true, role: 'admin' },
    'test',
  );
  await internal.createAccount({
    id: generateId(32),
    userId,
    providerId: 'credential',
    accountId: userId,
    password: hash,
  });
  createProfile(ctx.db, userId, 'manager', 'UTC');
}

/**
 * Headers of a browser form POST that arrived over the public HTTPS origin and
 * was forwarded over the internal plain-HTTP socket by the TLS proxy.
 */
function proxiedBrowserHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    host: PUBLIC_HOST,
    origin: PUBLIC_ORIGIN,
    referer: `${PUBLIC_ORIGIN}/login`,
    'content-type': 'application/x-www-form-urlencoded',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-dest': 'empty',
    ...extra,
  };
}

function sessionCookie(res: { headers: Record<string, unknown> }): string | null {
  const cookies = res.headers['set-cookie'];
  if (!cookies) return null;
  const list = Array.isArray(cookies) ? cookies : [cookies];
  const match = list.find((c) => String(c).includes('better-auth.session_token='));
  return match ? String(match).split(';')[0] : null;
}

async function rawSessionToken(cookie: string): Promise<string> {
  const session = await ctx.auth.api.getSession({ headers: fromNodeHeaders({ cookie }) });
  return session!.session.token;
}

async function signIn(email: string, password: string, extra: Record<string, string> = {}) {
  const payload = new URLSearchParams({ email, password }).toString();
  return ctx.app.inject({
    method: 'POST',
    url: '/login',
    payload,
    headers: proxiedBrowserHeaders(extra),
  });
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticketing-proxied-'));
  ctx = await buildApp(testConfig());
  await seedAdmin();
});

afterAll(async () => {
  await ctx.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('HTTPS origin proxied to an internal HTTP server (Railway topology)', () => {
  it('signs in with the public HTTPS origin and sets a Secure session cookie', async () => {
    const res = await signIn('admin@prod.local', 'Admin12345!');
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/');
    const cookie = sessionCookie(res);
    expect(cookie).toBeTruthy();
    // baseURL is https, so the cookie must be __Secure-prefixed and Secure.
    expect(cookie).toMatch(/^__Secure-better-auth\.session_token=/);
    const cookies = res.headers['set-cookie'];
    const list = Array.isArray(cookies) ? cookies : [cookies];
    const full = list.find((c) => String(c).includes('better-auth.session_token'))!;
    expect(full).toMatch(/;\s*Secure/i);
    expect(full).toMatch(/;\s*HttpOnly/i);
  });

  it('signs in when the browser sends Origin: null with Sec-Fetch-Site: same-origin', async () => {
    // Better Auth infers the origin from the request URL in this case; the
    // adapter's request URL must therefore carry the public HTTPS origin.
    const res = await signIn('admin@prod.local', 'Admin12345!', { origin: 'null' });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/');
    expect(sessionCookie(res)).toBeTruthy();
  });

  it('keeps the session usable on protected pages', async () => {
    const login = await signIn('admin@prod.local', 'Admin12345!');
    const cookie = sessionCookie(login)!;
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/',
      headers: { host: PUBLIC_HOST, cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('Welcome, Prod Admin');
  });

  it('still rejects a cross-origin sign-in (strict trusted-origin validation intact)', async () => {
    const res = await signIn('admin@prod.local', 'Admin12345!', {
      origin: 'https://evil.example.com',
      referer: 'https://evil.example.com/phish',
    });
    expect(res.statusCode).toBe(401);
    expect(sessionCookie(res)).toBeNull();
  });

  it('signs out with a valid CSRF token and clears the session', async () => {
    const login = await signIn('admin@prod.local', 'Admin12345!');
    const cookie = sessionCookie(login)!;
    const token = csrfToken(SECRET, await rawSessionToken(cookie));
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/logout',
      payload: new URLSearchParams({ csrfToken: token }).toString(),
      headers: proxiedBrowserHeaders({ cookie }),
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/login');
    const after = await ctx.app.inject({
      method: 'GET',
      url: '/',
      headers: { host: PUBLIC_HOST, cookie },
    });
    expect(after.statusCode).toBe(302);
  });
});

describe('/api/auth/* route under the proxied HTTPS origin', () => {
  it('accepts a JSON sign-in and sets the Secure session cookie', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: JSON.stringify({ email: 'admin@prod.local', password: 'Admin12345!' }),
      headers: proxiedBrowserHeaders({ 'content-type': 'application/json' }),
    });
    expect(res.statusCode).toBe(200);
    const cookie = sessionCookie(res);
    expect(cookie).toBeTruthy();
    expect(cookie).toMatch(/^__Secure-better-auth\.session_token=/);
  });

  it('resolves the session via get-session with the cookie', async () => {
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: JSON.stringify({ email: 'admin@prod.local', password: 'Admin12345!' }),
      headers: proxiedBrowserHeaders({ 'content-type': 'application/json' }),
    });
    const cookie = sessionCookie(login)!;
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/get-session',
      headers: { host: PUBLIC_HOST, cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe('admin@prod.local');
  });

  it('rejects an untrusted origin on the API route', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: JSON.stringify({ email: 'admin@prod.local', password: 'Admin12345!' }),
      headers: proxiedBrowserHeaders({
        origin: 'https://evil.example.com',
        referer: 'https://evil.example.com/phish',
        'content-type': 'application/json',
      }),
    });
    expect(res.statusCode).toBe(403);
  });
});