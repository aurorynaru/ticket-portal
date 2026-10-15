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
    databasePath: path.join(tmpDir, 'app.db'),
    uploadDir: path.join(tmpDir, 'uploads'),
    betterAuthUrl: 'http://localhost:3000',
    betterAuthSecret: 'test-secret-0123456789abcdef0123456789',
    sessionTrustedOrigin: 'http://localhost:3000',
    defaultTimezone: 'UTC',
    maxUploadBytes: 1024,
    notificationPollSeconds: 45,
    logLevel: 'silent',
  };
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticketing-app-'));
  ctx = await buildApp(testConfig());
});

afterAll(async () => {
  await ctx.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('P0 HTTP surface', () => {
  it('GET /health/live returns 200', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'live' });
  });

  it('GET /health/ready returns 200 with schema version after migrations', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; schemaVersion: number };
    expect(body.status).toBe('ready');
    expect(body.schemaVersion).toBeGreaterThanOrEqual(1);
  });

  it('GET / redirects unauthenticated users to /login', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain('/login');
  });

  it('GET /login renders the sign-in page with local assets', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/login' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.payload).toContain('/assets/app.css');
    expect(res.payload).toContain('/htmx.min.js');
    expect(res.payload).toContain('Sign in');
  });

  it('GET /admin/users requires authentication', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/admin/users' });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain('/login');
  });

  it('serves compiled CSS and vendored HTMX from /public', async () => {
    const css = await ctx.app.inject({ method: 'GET', url: '/assets/app.css' });
    expect(css.statusCode).toBe(200);
    expect(css.headers['content-type']).toContain('text/css');

    const htmx = await ctx.app.inject({ method: 'GET', url: '/htmx.min.js' });
    expect(htmx.statusCode).toBe(200);
    expect(htmx.headers['content-type']).toMatch(/javascript/);
  });

  it('adds security headers and a request id', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health/live' });
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('maps unknown routes to a JSON 404 with request id', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: string; requestId: string };
    expect(body.error).toBe('Not found');
    expect(body.requestId).toBeTruthy();
  });
});