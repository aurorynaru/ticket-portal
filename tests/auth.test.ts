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

const SECRET = 'test-secret-0123456789abcdef0123456789';
const ORIGIN = 'http://localhost:3000';

let tmpDir: string;
let ctx: AppContext;

function testConfig(): AppConfig {
  return {
    nodeEnv: 'test',
    isProduction: false,
    port: 0,
    databasePath: path.join(tmpDir, 'auth.db'),
    uploadDir: path.join(tmpDir, 'uploads'),
    betterAuthUrl: ORIGIN,
    betterAuthSecret: SECRET,
    sessionTrustedOrigin: ORIGIN,
    defaultTimezone: 'UTC',
    maxUploadBytes: 1024,
    notificationPollSeconds: 45,
    logLevel: 'silent',
  };
}

interface SeedUser {
  email: string;
  name: string;
  password: string;
  role: 'admin' | 'user';
  accessLevel: 'manager' | 'user' | 'viewer';
}

async function seedUser(user: SeedUser): Promise<void> {
  const context = await ctx.auth.$context;
  const internal = context.internalAdapter;
  const userId = generateId(32);
  const hash = await context.password.hash(user.password);
  await internal.createUser(
    { id: userId, email: user.email, name: user.name, emailVerified: true, role: user.role },
    'test',
  );
  await internal.createAccount({
    id: generateId(32),
    userId,
    providerId: 'credential',
    accountId: userId,
    password: hash,
  });
  createProfile(ctx.db, userId, user.accessLevel, 'UTC');
}

function sessionCookie(res: { headers: Record<string, unknown> }): string | null {
  const cookies = res.headers['set-cookie'];
  if (!cookies) return null;
  const list = Array.isArray(cookies) ? cookies : [cookies];
  const match = list.find((c) => String(c).startsWith('better-auth.session_token='));
  return match ? String(match).split(';')[0] : null;
}

async function rawSessionToken(cookie: string): Promise<string> {
  const session = await ctx.auth.api.getSession({ headers: fromNodeHeaders({ cookie }) });
  return session!.session.token;
}

function form(payload: Record<string, string>): { payload: string; headers: Record<string, string> } {
  return {
    payload: new URLSearchParams(payload).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN },
  };
}

async function signIn(email: string, password: string) {
  const { payload, headers } = form({ email, password });
  return ctx.app.inject({ method: 'POST', url: '/login', payload, headers });
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticketing-auth-'));
  ctx = await buildApp(testConfig());
  await seedUser({ email: 'admin@test.local', name: 'Admin', password: 'Admin12345!', role: 'admin', accessLevel: 'manager' });
  await seedUser({ email: 'member@test.local', name: 'Member', password: 'Member12345!', role: 'user', accessLevel: 'user' });
});

afterAll(async () => {
  await ctx.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('P1 authentication', () => {
  it('signs in with valid credentials and sets a session cookie', async () => {
    const res = await signIn('admin@test.local', 'Admin12345!');
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/');
    expect(sessionCookie(res)).toBeTruthy();
  });

  it('rejects invalid credentials and re-renders the login page', async () => {
    const res = await signIn('admin@test.local', 'wrong-password');
    expect(res.statusCode).toBe(401);
    expect(res.payload).toContain('Invalid email or password');
  });

  it('serves the authenticated home page with a session cookie', async () => {
    const login = await signIn('admin@test.local', 'Admin12345!');
    const cookie = sessionCookie(login);
    expect(cookie).toBeTruthy();
    const res = await ctx.app.inject({ method: 'GET', url: '/', headers: { cookie: cookie! } });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('Welcome, Admin');
  });

  it('redirects anonymous requests to /login', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain('/login');
  });
});

describe('P1 RBAC', () => {
  it('lets an admin view the user management page', async () => {
    const login = await signIn('admin@test.local', 'Admin12345!');
    const cookie = sessionCookie(login)!;
    const res = await ctx.app.inject({ method: 'GET', url: '/admin/users', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('admin@test.local');
  });

  it('forbids a non-admin from the user management page', async () => {
    const login = await signIn('member@test.local', 'Member12345!');
    const cookie = sessionCookie(login)!;
    const res = await ctx.app.inject({ method: 'GET', url: '/admin/users', headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });
});

describe('P1 admin provisioning', () => {
  it('creates a user with a valid CSRF token', async () => {
    const login = await signIn('admin@test.local', 'Admin12345!');
    const cookie = sessionCookie(login)!;
    const token = csrfToken(SECRET, await rawSessionToken(cookie));
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { cookie, ...form({}).headers },
      payload: form({
        email: 'newbie@test.local',
        name: 'Newbie',
        password: 'Newbie12345!',
        accessLevel: 'viewer',
        csrfToken: token,
      }).payload,
    });
    expect(res.statusCode).toBe(302);
    const row = ctx.db.prepare('SELECT access_level FROM app_user_profiles p JOIN user u ON u.id=p.user_id WHERE u.email=?').get('newbie@test.local') as
      | { access_level: string }
      | undefined;
    expect(row?.access_level).toBe('viewer');
  });

  it('rejects a provisioning request without a valid CSRF token', async () => {
    const login = await signIn('admin@test.local', 'Admin12345!');
    const cookie = sessionCookie(login)!;
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { cookie, ...form({}).headers },
      payload: form({
        email: 'x@test.local',
        name: 'X',
        password: 'Xx12345678!',
        accessLevel: 'user',
        csrfToken: 'bogus',
      }).payload,
    });
    expect(res.statusCode).toBe(403);
  });

  it('signs out with a valid CSRF token', async () => {
    const login = await signIn('admin@test.local', 'Admin12345!');
    const cookie = sessionCookie(login)!;
    const token = csrfToken(SECRET, await rawSessionToken(cookie));
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/logout',
      headers: { cookie, ...form({}).headers },
      payload: form({ csrfToken: token }).payload,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/login');
  });
});