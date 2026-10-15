import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateId } from '@better-auth/core/utils/id';
import { buildApp, type AppContext } from '../src/app.js';
import type { AppConfig } from '../src/config/env.js';
import { createProfile, type AccessLevel } from '../src/auth/profiles.js';
import type { AuthUser } from '../src/auth/session.js';

export interface TestApp {
  ctx: AppContext;
  tmpDir: string;
  createUser: (opts: {
    email: string;
    name: string;
    role: 'admin' | 'user';
    accessLevel: AccessLevel;
  }) => Promise<AuthUser>;
  close: () => Promise<void>;
}

export function testConfig(databasePath: string, uploadDir: string): AppConfig {
  return {
    nodeEnv: 'test',
    isProduction: false,
    port: 0,
    databasePath,
    uploadDir,
    betterAuthUrl: 'http://localhost:3000',
    betterAuthSecret: 'test-secret-0123456789abcdef0123456789',
    sessionTrustedOrigin: 'http://localhost:3000',
    defaultTimezone: 'UTC',
    maxUploadBytes: 1024,
    notificationPollSeconds: 45,
    rateLimitMax: 300,
    rateLimitAuthMax: 60,
    logLevel: 'silent',
  };
}

export async function makeTestApp(): Promise<TestApp> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticketing-test-'));
  const uploadDir = path.join(tmpDir, 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const ctx = await buildApp(testConfig(path.join(tmpDir, 'app.db'), uploadDir));

  const createUser = async (opts: {
    email: string;
    name: string;
    role: 'admin' | 'user';
    accessLevel: AccessLevel;
  }): Promise<AuthUser> => {
    const db = ctx.db;
    const context = await ctx.auth.$context;
    const internal = context.internalAdapter;
    const userId = generateId(32);
    const hash = await context.password.hash('TestPass12345!');
    await internal.createUser(
      { id: userId, email: opts.email, name: opts.name, emailVerified: true, role: opts.role },
      'test',
    );
    await internal.createAccount({
      id: generateId(32),
      userId,
      providerId: 'credential',
      accountId: userId,
      password: hash,
    });
    createProfile(db, userId, opts.accessLevel, 'UTC');
    db.prepare('INSERT OR IGNORE INTO app_team_members (team_id, user_id) VALUES (?, ?)').run(
      'team-general',
      userId,
    );
    return {
      id: userId,
      email: opts.email,
      name: opts.name,
      authRole: opts.role,
      banned: false,
      role: opts.role === 'admin' ? 'admin' : opts.accessLevel,
      sessionToken: `test-token-${userId}`,
    };
  };

  return {
    ctx,
    tmpDir,
    createUser,
    close: async () => {
      await ctx.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}