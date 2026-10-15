import fs from 'node:fs';
import path from 'node:path';
import type { AppDatabase } from './connection.js';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const MIGRATION_FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export function loadMigrations(migrationsDir: string): Migration[] {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => MIGRATION_FILE.test(f))
    .sort();
  const migrations: Migration[] = [];
  for (const file of files) {
    const match = MIGRATION_FILE.exec(file);
    const version = match?.[1];
    const name = match?.[2];
    if (!match || version === undefined || name === undefined) continue;
    migrations.push({
      version: Number(version),
      name,
      sql: fs.readFileSync(path.join(migrationsDir, file), 'utf8'),
    });
  }
  const versions = migrations.map((m) => m.version);
  if (new Set(versions).size !== versions.length) {
    throw new Error('Duplicate migration versions detected');
  }
  return migrations;
}

export function ensureMigrationsTable(db: AppDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);
}

export function getSchemaVersion(db: AppDatabase): number {
  ensureMigrationsTable(db);
  const row = db.prepare('SELECT MAX(version) AS v FROM app_schema_migrations').get() as
    | { v: number | null }
    | undefined;
  return row?.v ?? 0;
}

export interface MigrationResult {
  applied: number[];
  version: number;
}

export function runMigrations(db: AppDatabase, migrationsDir: string): MigrationResult {
  ensureMigrationsTable(db);
  const current = getSchemaVersion(db);
  const pending = loadMigrations(migrationsDir).filter((m) => m.version > current);
  const applied: number[] = [];
  for (const migration of pending) {
    const apply = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO app_schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        Date.now(),
      );
    });
    apply();
    applied.push(migration.version);
  }
  return { applied, version: getSchemaVersion(db) };
}