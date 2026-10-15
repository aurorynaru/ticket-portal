import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type AppContext } from '../src/app.js';
import type { AppConfig } from '../src/config/env.js';
import { getProfile } from '../src/auth/profiles.js';
import { bootstrapAdmin, BootstrapAdminError } from '../src/auth/cli-bootstrap-admin.js';

const SECRET = 'test-secret-0123456789abcdef0123456789';
const ORIGIN = 'http://localhost:3000';

let tmpDir: string;
let ctx: AppContext;
let config: AppConfig;

function testConfig(): AppConfig {
  return {
    nodeEnv: 'test',
    isProduction: false,
    port: 0,
    databasePath: path.join(tmpDir, 'bootstrap.db'),
    uploadDir: path.join(tmpDir, 'uploads'),
    betterAuthUrl: ORIGIN,
    betterAuthSecret: SECRET,
    sessionTrustedOrigin: ORIGIN,
    defaultTimezone: 'UTC',
    maxUploadBytes: 1024,
    notificationPollSeconds: 45,
    rateLimitMax: 300,
    rateLimitAuthMax: 60,
    logLevel: 'silent',
  };
}

function sessionCookie(res: { headers: Record<string, unknown> }): string | null {
  const cookies = res.headers['set-cookie'];
  if (!cookies) return null;
  const list = Array.isArray(cookies) ? cookies : [cookies];
  const match = list.find((c) => String(c).startsWith('better-auth.session_token='));
  return match ? String(match).split(';')[0] : null;
}

async function signIn(email: string, password: string) {
  const payload = new URLSearchParams({ email, password }).toString();
  return ctx.app.inject({
    method: 'POST',
    url: '/login',
    payload,
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN },
  });
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticketing-bootstrap-'));
  fs.mkdirSync(path.join(tmpDir, 'uploads'), { recursive: true });
  config = testConfig();
  ctx = await buildApp(config);
});

afterAll(async () => {
  await ctx.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('first-admin bootstrap', () => {
  it('creates an admin (role admin + manager profile) that can sign in', async () => {
    const result = await bootstrapAdmin(config, {
      email: 'First.Admin@Example.com',
      password: 'Sup3rSecret99!',
    });

    expect(result.email).toBe('first.admin@example.com');
    expect(result.name).toBe('Administrator');
    expect(result.role).toBe('admin');
    expect(result.accessLevel).toBe('manager');

    const user = ctx.db
      .prepare('SELECT role, emailVerified, banned FROM user WHERE id = ?')
      .get(result.userId) as { role: string; emailVerified: number; banned: number | null };
    expect(user.role).toBe('admin');
    expect(user.emailVerified).toBe(1);
    expect(user.banned ?? 0).toBe(0);

    const profile = getProfile(ctx.db, result.userId);
    expect(profile?.accessLevel).toBe('manager');
    expect(profile?.isActive).toBe(true);

    const account = ctx.db
      .prepare('SELECT providerId, accountId, password FROM account WHERE userId = ?')
      .get(result.userId) as { providerId: string; accountId: string; password: string };
    expect(account.providerId).toBe('credential');
    expect(account.accountId).toBe(result.userId);
    expect(account.password).not.toBe('Sup3rSecret99!');

    const res = await signIn('first.admin@example.com', 'Sup3rSecret99!');
    expect(res.statusCode).toBe(302);
    expect(sessionCookie(res)).toBeTruthy();
  });

  it('refuses to rerun for an existing email and leaves the account untouched', async () => {
    const userBefore = ctx.db
      .prepare('SELECT * FROM user WHERE email = ?')
      .get('first.admin@example.com');
    const accountId = ctx.db
      .prepare('SELECT id FROM account WHERE userId = ?')
      .get((userBefore as { id: string }).id) as { id: string };
    const accountBefore = ctx.db.prepare('SELECT * FROM account WHERE id = ?').get(accountId.id);
    const profileBefore = ctx.db
      .prepare('SELECT * FROM app_user_profiles WHERE user_id = ?')
      .get((userBefore as { id: string }).id);

    await expect(
      bootstrapAdmin(config, { email: 'FIRST.ADMIN@example.com', password: 'TotallyNew123!' }),
    ).rejects.toThrow(BootstrapAdminError);
    await expect(
      bootstrapAdmin(config, { email: 'first.admin@example.com', password: 'TotallyNew123!' }),
    ).rejects.toThrow(/already exists/);

    expect(ctx.db.prepare('SELECT * FROM user WHERE email = ?').get('first.admin@example.com')).toEqual(
      userBefore,
    );
    expect(ctx.db.prepare('SELECT * FROM account WHERE id = ?').get(accountId.id)).toEqual(accountBefore);
    expect(
      ctx.db.prepare('SELECT * FROM app_user_profiles WHERE user_id = ?').get((userBefore as { id: string }).id),
    ).toEqual(profileBefore);

    // The original password still works (no silent reset).
    const res = await signIn('first.admin@example.com', 'Sup3rSecret99!');
    expect(res.statusCode).toBe(302);
  });

  it('creates a second admin for a different email', async () => {
    const result = await bootstrapAdmin(config, {
      email: 'second@example.com',
      password: 'An0therSecret1!',
      name: 'Second Admin',
    });
    expect(result.name).toBe('Second Admin');
    expect(result.role).toBe('admin');
    expect(result.accessLevel).toBe('manager');
    const res = await signIn('second@example.com', 'An0therSecret1!');
    expect(res.statusCode).toBe(302);
  });

  it('rejects invalid input without creating anything', async () => {
    await expect(
      bootstrapAdmin(config, { email: 'not-an-email', password: 'LongEnough123!' }),
    ).rejects.toThrow(BootstrapAdminError);
    await expect(
      bootstrapAdmin(config, { email: 'ok@example.com', password: 'short' }),
    ).rejects.toThrow(/at least 10/);
    await expect(
      bootstrapAdmin(config, { email: 'ok@example.com', password: 'x'.repeat(129) }),
    ).rejects.toThrow(/at most 128/);
    const rows = ctx.db
      .prepare("SELECT COUNT(*) AS n FROM user WHERE email IN ('not-an-email', 'ok@example.com')")
      .get() as { n: number };
    expect(rows.n).toBe(0);
  });
});