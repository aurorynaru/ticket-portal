import { fromNodeHeaders } from 'better-auth/node';
import type { AppAuth } from './auth.js';
import type { AppDatabase } from '../db/connection.js';
import { getProfile, type AccessLevel } from './profiles.js';

export type EffectiveRole = 'admin' | AccessLevel;

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  /** Trusted role from the Better Auth Admin plugin. */
  authRole: string | null;
  banned: boolean;
  /** Effective application role (denied -> null). */
  role: EffectiveRole;
  sessionToken: string;
}

/**
 * Resolve the effective application role from the trusted Better Auth role and
 * the application profile. A missing, inactive, or inconsistent profile denies
 * access (returns null). Admin-ness requires BOTH the auth role and an active
 * profile.
 */
export function resolveEffectiveRole(
  authRole: string | null | undefined,
  profile: { accessLevel: AccessLevel; isActive: boolean } | null,
): EffectiveRole | null {
  if (!profile || !profile.isActive) return null;
  if (authRole === 'admin') return 'admin';
  if (profile.accessLevel === 'manager' || profile.accessLevel === 'user' || profile.accessLevel === 'viewer') {
    return profile.accessLevel;
  }
  return null;
}

/**
 * Resolve the authenticated user for a request, per request (never cached
 * globally). Returns null when there is no valid session, the user is banned,
 * or the effective role cannot be resolved (fail closed).
 */
export async function resolveSession(
  auth: AppAuth,
  db: AppDatabase,
  headers: Headers,
): Promise<AuthUser | null> {
  const session = await auth.api.getSession({ headers });
  if (!session?.session || !session.user) return null;

  const user = session.user as {
    id: string;
    email: string;
    name?: string | null;
    role?: string | null;
    banned?: boolean | null;
  };
  if (user.banned) return null;

  const profile = getProfile(db, user.id);
  const role = resolveEffectiveRole(user.role ?? null, profile);
  if (!role) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    authRole: user.role ?? null,
    banned: false,
    role,
    sessionToken: session.session.token,
  };
}

export { fromNodeHeaders };