import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@better-auth/core/utils/id';
import { buildApp, type AppContext } from '../src/app.js';
import type { AppConfig } from '../src/config/env.js';
import { createProfile } from '../src/auth/profiles.js';
import { fromNodeHeaders } from '../src/auth/session.js';

const SECRET = 'test-secret-0123456789abcdef0123456789';
const ORIGIN = 'http://localhost:3000';
const POLL_SECONDS = 120; // non-default, to prove the value is wired through

let tmpDir: string;
let ctx: AppContext;

function testConfig(): AppConfig {
  return {
    nodeEnv: 'test',
    isProduction: false,
    port: 0,
    databasePath: path.join(tmpDir, 'p5.db'),
    uploadDir: path.join(tmpDir, 'uploads'),
    betterAuthUrl: ORIGIN,
    betterAuthSecret: SECRET,
    sessionTrustedOrigin: ORIGIN,
    defaultTimezone: 'UTC',
    maxUploadBytes: 1024,
    notificationPollSeconds: POLL_SECONDS,
    logLevel: 'silent',
  };
}

async function seedUser(email: string, name: string, password: string, role: 'admin' | 'user'): Promise<void> {
  const context = await ctx.auth.$context;
  const internal = context.internalAdapter;
  const userId = generateId(32);
  const hash = await context.password.hash(password);
  await internal.createUser(
    { id: userId, email, name, emailVerified: true, role },
    'test',
  );
  await internal.createAccount({
    id: generateId(32),
    userId,
    providerId: 'credential',
    accountId: userId,
    password: hash,
  });
  createProfile(ctx.db, userId, role === 'admin' ? 'manager' : 'user', 'UTC');
}

function sessionCookie(res: { headers: Record<string, unknown> }): string | null {
  const cookies = res.headers['set-cookie'];
  if (!cookies) return null;
  const list = Array.isArray(cookies) ? cookies : [cookies];
  const match = list.find((c) => String(c).startsWith('better-auth.session_token='));
  return match ? String(match).split(';')[0] : null;
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticketing-p5-'));
  ctx = await buildApp(testConfig());
  await seedUser('p5admin@test.local', 'P5 Admin', 'Admin12345!', 'admin');
});

afterAll(async () => {
  await ctx.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('P5 security hardening', () => {
  it('wires NOTIFICATION_POLL_SECONDS into the rendered nav (no hardcoded 45s)', async () => {
    const login = await signIn('p5admin@test.local', 'Admin12345!');
    const cookie = sessionCookie(login)!;
    const res = await ctx.app.inject({ method: 'GET', url: '/', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain(`data-poll-seconds="${POLL_SECONDS}"`);
    // The old hardcoded default must be gone from the rendered nav.
    expect(res.payload).not.toContain('data-poll-seconds="45"');
  });

  it('does not allow inline styles in the CSP (style-src has no unsafe-inline)', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/login' });
    expect(res.statusCode).toBe(200);
    const csp = String(res.headers['content-security-policy']);
    const styleSrc = csp.split(';').map((s) => s.trim()).find((d) => d.startsWith('style-src'));
    expect(styleSrc).toBeDefined();
    expect(styleSrc).not.toContain("'unsafe-inline'");
    expect(styleSrc).toContain("'self'");
  });

  it('keeps the session cookie httpOnly and same-site', async () => {
    const login = await signIn('p5admin@test.local', 'Admin12345!');
    const cookies = login.headers['set-cookie'];
    const list = Array.isArray(cookies) ? cookies : [cookies];
    const session = list.find((c) => String(c).startsWith('better-auth.session_token='));
    expect(session).toBeDefined();
    expect(String(session)).toContain('HttpOnly');
    expect(String(session)).toMatch(/SameSite=/i);
  });
});