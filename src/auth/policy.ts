import type { EffectiveRole } from './session.js';

/**
 * Server-side authorization policy. These are the single source of truth for
 * what each effective role may do in P1 (identity & admin user management).
 * UI visibility is never authorization; every route re-checks these.
 */

export function canManageUsers(role: EffectiveRole): boolean {
  return role === 'admin';
}

export function canViewAdminPanel(role: EffectiveRole): boolean {
  return role === 'admin';
}

export function canAccessApp(role: EffectiveRole | null): boolean {
  return role !== null;
}

/** Roles that may be assigned to a non-admin account. */
export const ASSIGNABLE_LEVELS = ['manager', 'user', 'viewer'] as const;
export type AssignableLevel = (typeof ASSIGNABLE_LEVELS)[number];

export function isAssignableLevel(value: unknown): value is AssignableLevel {
  return typeof value === 'string' && (ASSIGNABLE_LEVELS as readonly string[]).includes(value);
}