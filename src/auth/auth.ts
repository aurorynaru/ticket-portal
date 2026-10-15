import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';
import type { AppDatabase } from '../db/connection.js';
import type { AppConfig } from '../config/env.js';

/**
 * Build the Better Auth instance for a shared better-sqlite3 handle.
 *
 * - Public sign-up is disabled; accounts are provisioned by admins only.
 * - The Admin plugin supplies the trusted `user.role` (admin | user).
 * - Sessions use secure, httpOnly cookies scoped to the trusted origin.
 */
// Dev/test fallback. Production enforces BETTER_AUTH_SECRET in env.ts.
const DEV_SECRET = 'dev-only-insecure-secret-0123456789abcdef';

export function createAuth(db: AppDatabase, config: AppConfig) {
  const trustedOrigins = [config.betterAuthUrl, config.sessionTrustedOrigin].filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );

  return betterAuth({
    baseURL: config.betterAuthUrl,
    secret: config.betterAuthSecret ?? DEV_SECRET,
    database: db,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 10,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    trustedOrigins: trustedOrigins.length > 0 ? trustedOrigins : undefined,
    advanced: {
      // Better Auth silently skips origin/CSRF validation when NODE_ENV=test.
      // Keep it enabled in tests so the suite enforces the same trusted-origin
      // rules as production (a regression was found via this gap).
      disableOriginCheck: false,
    },
    plugins: [admin()],
  });
}

export type AppAuth = ReturnType<typeof createAuth>;

/**
 * Base URL for the Web Request handed to Better Auth.
 *
 * Better Auth derives its origin validation (including the `Origin: null`
 * inference) from the request URL, so that URL must carry the configured
 * public origin (BETTER_AUTH_URL). Behind a TLS-terminating proxy the internal
 * socket is always plain HTTP, so deriving the scheme from the socket would
 * fabricate an `http://` origin that fails the trusted-origin check. Falls
 * back to the request host only when BETTER_AUTH_URL is not configured
 * (local development).
 */
export function publicRequestBase(config: AppConfig, host?: string): string {
  return config.betterAuthUrl ?? `http://${host ?? 'localhost'}`;
}