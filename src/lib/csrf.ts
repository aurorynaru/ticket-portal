import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Session-bound CSRF token. The token is an HMAC of the session token keyed by
 * the app secret, so it is only valid for the session that produced it and for
 * the lifetime of that session. This protects all application-owned POST
 * routes (Better Auth's own endpoints use their own origin/CSRF checks).
 */
export function csrfToken(secret: string, sessionToken: string): string {
  return createHmac('sha256', secret).update(`csrf:v1:${sessionToken}`).digest('base64url');
}

export function verifyCsrf(
  secret: string,
  sessionToken: string,
  candidate: string | null | undefined,
): boolean {
  if (!candidate) return false;
  const expected = Buffer.from(csrfToken(secret, sessionToken));
  const given = Buffer.from(candidate);
  return expected.length === given.length && timingSafeEqual(expected, given);
}