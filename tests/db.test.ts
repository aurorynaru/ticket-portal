import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, closeDatabase, type AppDatabase } from '../src/db/connection.js';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticketing-db-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('sqlite connection', () => {
  it('enforces WAL, foreign keys and busy timeout', () => {
    const db = openDatabase(path.join(tmpDir, 'pragmas.db'));
    try {
      const journal = db.pragma('journal_mode', { simple: true }) as string;
      const fk = db.pragma('foreign_keys', { simple: true }) as number;
      const busy = db.pragma('busy_timeout', { simple: true }) as number;
      expect(journal).toBe('wal');
      expect(fk).toBe(1);
      expect(busy).toBe(5000);
    } finally {
      closeDatabase(db);
    }
  });

  it('persists data across close and reopen (restart simulation)', () => {
    const file = path.join(tmpDir, 'persist.db');
    const db1 = openDatabase(file);
    db1.exec('CREATE TABLE app_probe (id INTEGER PRIMARY KEY, note TEXT NOT NULL)');
    db1.prepare('INSERT INTO app_probe (note) VALUES (?)').run('survives-restart');
    closeDatabase(db1);

    const db2 = openDatabase(file);
    try {
      const row = db2.prepare('SELECT note FROM app_probe WHERE id = 1').get() as { note: string };
      expect(row.note).toBe('survives-restart');
    } finally {
      closeDatabase(db2);
    }
  });
});