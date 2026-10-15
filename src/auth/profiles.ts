import type { AppDatabase } from '../db/connection.js';

export type AccessLevel = 'manager' | 'user' | 'viewer';

export const ACCESS_LEVELS: readonly AccessLevel[] = ['manager', 'user', 'viewer'];

export interface UserProfile {
  userId: string;
  accessLevel: AccessLevel;
  isActive: boolean;
  timezone: string;
  createdAt: number;
  updatedAt: number;
}

interface ProfileRow {
  user_id: string;
  access_level: string;
  is_active: number;
  timezone: string;
  created_at: number;
  updated_at: number;
}

function toProfile(row: ProfileRow): UserProfile {
  return {
    userId: row.user_id,
    accessLevel: row.access_level as AccessLevel,
    isActive: row.is_active === 1,
    timezone: row.timezone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getProfile(db: AppDatabase, userId: string): UserProfile | null {
  const row = db
    .prepare(
      `SELECT user_id, access_level, is_active, timezone, created_at, updated_at
       FROM app_user_profiles WHERE user_id = ?`,
    )
    .get(userId) as ProfileRow | undefined;
  return row ? toProfile(row) : null;
}

export function createProfile(
  db: AppDatabase,
  userId: string,
  accessLevel: AccessLevel,
  timezone: string,
): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO app_user_profiles (user_id, access_level, is_active, timezone, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?, ?)`,
  ).run(userId, accessLevel, timezone, now, now);
}

export function setProfileActive(db: AppDatabase, userId: string, active: boolean): void {
  db.prepare(`UPDATE app_user_profiles SET is_active = ?, updated_at = ? WHERE user_id = ?`).run(
    active ? 1 : 0,
    Date.now(),
    userId,
  );
}

export function setProfileAccessLevel(db: AppDatabase, userId: string, accessLevel: AccessLevel): void {
  db.prepare(`UPDATE app_user_profiles SET access_level = ?, updated_at = ? WHERE user_id = ?`).run(
    accessLevel,
    Date.now(),
    userId,
  );
}

/**
 * Count users that are effectively active admins: Better Auth role is admin,
 * not banned, and their application profile is active. Used to protect the
 * last remaining administrator.
 */
export function countActiveAdmins(db: AppDatabase): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM user u
       JOIN app_user_profiles p ON p.user_id = u.id
       WHERE u.role = 'admin' AND (u.banned IS NULL OR u.banned = 0) AND p.is_active = 1`,
    )
    .get() as { n: number } | undefined;
  return row?.n ?? 0;
}

export function isActiveAdmin(db: AppDatabase, userId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS x FROM user u
       JOIN app_user_profiles p ON p.user_id = u.id
       WHERE u.id = ? AND u.role = 'admin' AND (u.banned IS NULL OR u.banned = 0) AND p.is_active = 1`,
    )
    .get(userId);
  return row !== undefined;
}