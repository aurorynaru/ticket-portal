import { APIError } from '@better-auth/core/error';
import { HttpError } from '../lib/errors.js';
import type { AppAuth } from './auth.js';
import type { AppDatabase } from '../db/connection.js';
import type { AuthUser } from './session.js';
import { canManageUsers } from './policy.js';
import {
  createProfile,
  getProfile,
  setProfileActive,
  setProfileAccessLevel,
  countActiveAdmins,
  isActiveAdmin,
  type AccessLevel,
} from './profiles.js';

export interface ProvisioningDeps {
  auth: AppAuth;
  db: AppDatabase;
  /** Effective role of the calling admin (already resolved + authenticated). */
  actor: AuthUser;
  /** The calling admin's real request headers (carries the signed session cookie). */
  actorHeaders: Headers;
}

async function callAdmin<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof APIError) {
      const status = typeof err.statusCode === 'number' && err.statusCode >= 400 ? err.statusCode : 500;
      throw new HttpError(status, err.message);
    }
    throw err;
  }
}

function requireAdmin(deps: ProvisioningDeps): void {
  if (!canManageUsers(deps.actor.role)) {
    throw new HttpError(403, 'Forbidden');
  }
}

interface TargetUser {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  banned: boolean;
}

function getTargetUser(db: AppDatabase, userId: string): TargetUser | null {
  const row = db
    .prepare('SELECT id, email, name, role, banned FROM user WHERE id = ?')
    .get(userId) as
    | { id: string; email: string; name: string | null; role: string | null; banned: number | null }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    banned: row.banned === 1,
  };
}

function assertTargetExists(deps: ProvisioningDeps, userId: string): TargetUser {
  const target = getTargetUser(deps.db, userId);
  if (!target) throw new HttpError(404, 'User not found');
  return target;
}

function assertNotSelf(deps: ProvisioningDeps, userId: string): void {
  if (userId === deps.actor.id) throw new HttpError(409, 'You cannot modify your own account here');
}

function assertNotLastAdmin(deps: ProvisioningDeps, userId: string): void {
  if (isActiveAdmin(deps.db, userId) && countActiveAdmins(deps.db) <= 1) {
    throw new HttpError(409, 'Cannot remove the last active administrator');
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ProvisionInput {
  email: string;
  name: string;
  password: string;
  accessLevel: AccessLevel;
}

export async function provisionUser(deps: ProvisioningDeps, input: ProvisionInput): Promise<void> {
  requireAdmin(deps);
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!EMAIL_RE.test(email)) throw new HttpError(422, 'Invalid email address');
  if (name.length < 1 || name.length > 200) throw new HttpError(422, 'Invalid name');
  if (input.password.length < 10) throw new HttpError(422, 'Password must be at least 10 characters');

  await callAdmin(() =>
    deps.auth.api.createUser({
      headers: deps.actorHeaders,
      body: { email, password: input.password, name, role: 'user' },
    }),
  );
  const createdId = await getCreatedUserId(deps.db, email);
  if (!createdId) throw new HttpError(500, 'User created but profile lookup failed');
  createProfile(deps.db, createdId, input.accessLevel, 'Asia/Manila');
}

async function getCreatedUserId(db: AppDatabase, email: string): Promise<string | null> {
  const row = db.prepare('SELECT id FROM user WHERE email = ?').get(email) as { id: string } | undefined;
  return row?.id ?? null;
}

export async function deactivateUser(deps: ProvisioningDeps, userId: string): Promise<void> {
  requireAdmin(deps);
  assertTargetExists(deps, userId);
  assertNotSelf(deps, userId);
  assertNotLastAdmin(deps, userId);
  setProfileActive(deps.db, userId, false);
  await callAdmin(() =>
    deps.auth.api.banUser({
      headers: deps.actorHeaders,
      body: { userId, banReason: 'Deactivated by administrator' },
    }),
  );
  await revokeAll(deps, userId);
}

export async function activateUser(deps: ProvisioningDeps, userId: string): Promise<void> {
  requireAdmin(deps);
  assertTargetExists(deps, userId);
  setProfileActive(deps.db, userId, true);
  await callAdmin(() =>
    deps.auth.api.unbanUser({ headers: deps.actorHeaders, body: { userId } }),
  );
}

export async function setAccessLevel(
  deps: ProvisioningDeps,
  userId: string,
  level: AccessLevel,
): Promise<void> {
  requireAdmin(deps);
  const target = assertTargetExists(deps, userId);
  assertNotSelf(deps, userId);
  if (target.role === 'admin') throw new HttpError(409, 'Use promote/demote for administrators');
  setProfileAccessLevel(deps.db, userId, level);
  await revokeAll(deps, userId);
}

export async function promoteToAdmin(deps: ProvisioningDeps, userId: string): Promise<void> {
  requireAdmin(deps);
  const target = assertTargetExists(deps, userId);
  assertNotSelf(deps, userId);
  if (target.role === 'admin') return;
  const profile = getProfile(deps.db, userId);
  if (!profile || !profile.isActive) setProfileActive(deps.db, userId, true);
  await callAdmin(() =>
    deps.auth.api.setRole({ headers: deps.actorHeaders, body: { userId, role: 'admin' } }),
  );
  await revokeAll(deps, userId);
}

export async function demoteFromAdmin(
  deps: ProvisioningDeps,
  userId: string,
  level: AccessLevel,
): Promise<void> {
  requireAdmin(deps);
  const target = assertTargetExists(deps, userId);
  assertNotSelf(deps, userId);
  if (target.role !== 'admin') throw new HttpError(409, 'User is not an administrator');
  assertNotLastAdmin(deps, userId);
  // Official Better Auth role change first, then the domain profile.
  await callAdmin(() =>
    deps.auth.api.setRole({ headers: deps.actorHeaders, body: { userId, role: 'user' } }),
  );
  setProfileAccessLevel(deps.db, userId, level);
  await revokeAll(deps, userId);
}

export async function resetPassword(deps: ProvisioningDeps, userId: string, newPassword: string): Promise<void> {
  requireAdmin(deps);
  assertTargetExists(deps, userId);
  if (newPassword.length < 10) throw new HttpError(422, 'Password must be at least 10 characters');
  await callAdmin(() =>
    deps.auth.api.setUserPassword({ headers: deps.actorHeaders, body: { userId, newPassword } }),
  );
  await revokeAll(deps, userId);
}

async function revokeAll(deps: ProvisioningDeps, userId: string): Promise<void> {
  try {
    await callAdmin(() =>
      deps.auth.api.revokeUserSessions({ headers: deps.actorHeaders, body: { userId } }),
    );
  } catch (err) {
    // Revocation is best-effort after the authoritative change has committed.
    if (err instanceof HttpError && err.statusCode >= 500) {
      // Surface 5xx so the caller knows state may be inconsistent.
      throw err;
    }
  }
}