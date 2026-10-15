import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, closeDatabase, type AppDatabase } from '../src/db/connection.js';
import { getSchemaVersion, runMigrations } from '../src/db/migrations.js';

const repoRoot = path.resolve(import.meta.dirname, '..');
const realMigrationsDir = path.join(repoRoot, 'migrations');

// Derive expectations from the real migrations directory so the tests stay
// correct as new numbered migrations are added.
const realVersions = fs
  .readdirSync(realMigrationsDir)
  .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
  .map((f) => parseInt(f.slice(0, 4), 10))
  .sort((a, b) => a - b);
const latestVersion = realVersions[realVersions.length - 1];

let tmpDir: string;
let db: AppDatabase;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticketing-mig-'));
  db = openDatabase(path.join(tmpDir, 'test.db'));
});

afterAll(() => {
  closeDatabase(db);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('migration runner', () => {
  it('applies pending migrations and records schema version', () => {
    const result = runMigrations(db, realMigrationsDir);
    expect(result.applied).toEqual(realVersions);
    expect(result.version).toBe(latestVersion);
    expect(getSchemaVersion(db)).toBe(latestVersion);
  });

  it('is idempotent on re-run (no re-apply, no duplicate rows)', () => {
    const result = runMigrations(db, realMigrationsDir);
    expect(result.applied).toEqual([]);
    expect(result.version).toBe(latestVersion);
    const rows = db.prepare('SELECT COUNT(*) AS n FROM app_schema_migrations').get() as { n: number };
    expect(rows.n).toBe(realVersions.length);
  });

  it('applies new migrations on top of existing schema', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticketing-mig2-'));
    try {
      for (const f of fs.readdirSync(realMigrationsDir)) {
        fs.copyFileSync(path.join(realMigrationsDir, f), path.join(dir, f));
      }
      const next = latestVersion + 1;
      fs.writeFileSync(
        path.join(dir, `${String(next).padStart(4, '0')}_probe.sql`),
        'CREATE TABLE app_probe (id INTEGER PRIMARY KEY);',
      );
      const result = runMigrations(db, dir);
      expect(result.applied).toEqual([next]);
      expect(result.version).toBe(next);
      const hasProbe = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_probe'")
        .get();
      expect(hasProbe).toBeDefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails loudly on broken SQL and does not record the failed migration', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticketing-mig3-'));
    try {
      // Test 3 already applied version latestVersion+1, so use the next one.
      const next = latestVersion + 2;
      fs.writeFileSync(path.join(dir, `${String(next).padStart(4, '0')}_broken.sql`), 'CREATE TABLE app_broken (id INTEGER PRIMARY KEY;');
      expect(() => runMigrations(db, dir)).toThrow();
      expect(getSchemaVersion(db)).toBe(latestVersion + 1);
      const recorded = db
        .prepare('SELECT COUNT(*) AS n FROM app_schema_migrations WHERE version = ?')
        .get(next) as { n: number };
      expect(recorded.n).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});