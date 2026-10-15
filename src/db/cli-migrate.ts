import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config/env.js';
import { openDatabase, closeDatabase } from './connection.js';
import { runMigrations } from './migrations.js';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const config = loadConfig();
const db = openDatabase(config.databasePath);
try {
  const result = runMigrations(db, path.join(appRoot, 'migrations'));
  console.log(
    `Migrations applied: [${result.applied.join(', ')}]; schema version: ${result.version}; db: ${config.databasePath}`,
  );
} finally {
  closeDatabase(db);
}