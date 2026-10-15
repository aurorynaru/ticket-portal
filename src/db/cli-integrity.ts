import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config/env.js';
import { openDatabase, closeDatabase } from './connection.js';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const config = loadConfig();
const db = openDatabase(config.databasePath);
try {
  const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
  const fkViolations = db.prepare('PRAGMA foreign_key_check').all() as unknown[];
  const versionRow = db
    .prepare('SELECT MAX(version) AS v FROM app_schema_migrations')
    .get() as { v: number | null };
  console.log(
    JSON.stringify(
      {
        database: config.databasePath,
        integrity_check: integrity.integrity_check,
        foreign_key_violations: fkViolations.length,
        schema_version: versionRow?.v ?? 0,
      },
      null,
      2,
    ),
  );
  if (integrity.integrity_check !== 'ok' || fkViolations.length > 0) {
    process.exitCode = 1;
  }
} finally {
  closeDatabase(db);
}