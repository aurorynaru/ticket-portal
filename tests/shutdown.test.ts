import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type AppContext } from '../src/app.js';
import type { AppConfig } from '../src/config/env.js';

let tmpDir: string;
let ctx: AppContext;

function testConfig(): AppConfig {
  return {
    nodeEnv: 'test',
    isProduction: false,
    port: 0,
    databasePath: path.join(tmpDir, 'shutdown.db'),
    uploadDir: path.join(tmpDir, 'uploads'),
    defaultTimezone: 'UTC',
    maxUploadBytes: 1024,
    notificationPollSeconds: 45,
    logLevel: 'silent',
  };
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticketing-shutdown-'));
  ctx = await buildApp(testConfig());
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('graceful shutdown sequence (SIGTERM handler body)', () => {
  it('serves, then closes server and database cleanly', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);

    // This mirrors what src/server.ts does in its SIGTERM handler after
    // logging: stop accepting requests, finish in-flight work, close DB.
    await ctx.close();

    expect(ctx.db.open).toBe(false);

    // Closing again must be a safe no-op (idempotent shutdown).
    await expect(ctx.close()).resolves.toBeUndefined();
  });
});