import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().min(1),
  UPLOAD_DIR: z.string().min(1),
  BETTER_AUTH_URL: z.url().optional(),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  SESSION_TRUSTED_ORIGIN: z.url().optional(),
  DEFAULT_TIMEZONE: z.string().min(1).default('Asia/Manila'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  NOTIFICATION_POLL_SECONDS: z.coerce.number().int().min(5).max(300).default(45),
  // Per-IP anti-abuse limits. Defaults are the production values; a load
  // generator that represents many distinct users from one IP may raise them
  // for a documented test window (see docs/10_TESTING_LOAD.md).
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(60),
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  databasePath: string;
  uploadDir: string;
  betterAuthUrl?: string;
  betterAuthSecret?: string;
  sessionTrustedOrigin?: string;
  defaultTimezone: string;
  maxUploadBytes: number;
  notificationPollSeconds: number;
  rateLimitMax: number;
  rateLimitAuthMax: number;
  logLevel: 'silent' | 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';
  const databasePath = path.resolve(e.DATABASE_PATH);
  const uploadDir = path.resolve(e.UPLOAD_DIR);

  if (isProduction) {
    const issues: string[] = [];
    const dataRoot = path.resolve('/data');
    if (path.dirname(databasePath) !== dataRoot && !databasePath.startsWith(dataRoot + path.sep)) {
      issues.push('DATABASE_PATH must live under /data in production');
    }
    if (!e.BETTER_AUTH_SECRET) issues.push('BETTER_AUTH_SECRET is required in production');
    if (!e.BETTER_AUTH_URL) issues.push('BETTER_AUTH_URL is required in production');
    if (!e.SESSION_TRUSTED_ORIGIN) issues.push('SESSION_TRUSTED_ORIGIN is required in production');
    if (issues.length > 0) {
      throw new Error(`Production environment validation failed: ${issues.join('; ')}`);
    }
    // In production the /data volume must already exist and be writable.
    // Never silently create a production database in an ephemeral location.
    if (!uploadDir.startsWith(dataRoot + path.sep)) {
      throw new Error('UPLOAD_DIR must live under /data in production');
    }
    if (!fs.existsSync(path.dirname(databasePath))) {
      throw new Error(`Production data directory missing: ${path.dirname(databasePath)}`);
    }
    // The upload subdirectory is created on first boot (the mounted volume
    // starts empty); the database directory itself must already exist.
    fs.mkdirSync(uploadDir, { recursive: true });
    const probe = path.join(path.dirname(databasePath), `.write-probe-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe);
  } else {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  return {
    nodeEnv: e.NODE_ENV,
    isProduction,
    port: e.PORT,
    databasePath,
    uploadDir,
    betterAuthUrl: e.BETTER_AUTH_URL,
    betterAuthSecret: e.BETTER_AUTH_SECRET,
    sessionTrustedOrigin: e.SESSION_TRUSTED_ORIGIN,
    defaultTimezone: e.DEFAULT_TIMEZONE,
    maxUploadBytes: e.MAX_UPLOAD_BYTES,
    notificationPollSeconds: e.NOTIFICATION_POLL_SECONDS,
    rateLimitMax: e.RATE_LIMIT_MAX,
    rateLimitAuthMax: e.RATE_LIMIT_AUTH_MAX,
    logLevel: e.LOG_LEVEL,
  };
}