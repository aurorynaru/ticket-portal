-- P1: application-owned user profile.
-- Requires the Better Auth `user` table to exist (applied before this migration at startup).
-- access_level is the non-admin effective role; admin-ness comes from Better Auth user.role.
CREATE TABLE IF NOT EXISTS app_user_profiles (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL DEFAULT 'user'
    CHECK(access_level IN ('manager','user','viewer')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  timezone TEXT NOT NULL DEFAULT 'Asia/Manila',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);