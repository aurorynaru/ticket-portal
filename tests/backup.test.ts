import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, closeDatabase } from '../src/db/connection.js';
import { createBackup, restoreBackup } from '../src/db/backup.js';
import { makeTestApp, type TestApp } from './helpers.js';

describe('sqlite backup/restore', () => {
  let app: TestApp;
  let tmpDir: string;

  beforeAll(async () => {
    app = await makeTestApp();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticketing-backup-'));
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  let ticketSeq = 9000;
  function seedTicket(actorId: string, title: string): string {
    const db = app.ctx.db;
    const id = `t-${title}`;
    const now = Date.now();
    db.prepare(
      `INSERT INTO app_tickets (id, ticket_no, title, description, kind, category_id, team_id,
        visibility, priority, status, created_by, assigned_to, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'TASK', 'cat-general', 'team-general', 'TEAM', 'MEDIUM', 'OPEN', ?, ?, 1, ?, ?)`,
    ).run(id, ++ticketSeq, title, 'desc', actorId, actorId, now, now);
    db.prepare(
      `INSERT INTO app_ticket_comments (id, ticket_id, author_id, content, is_internal, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
    ).run(`c-${title}`, id, actorId, 'seed comment', now);
    return id;
  }

  it('creates a consistent snapshot while a write transaction is open', async () => {
    const db = app.ctx.db;
    await app.createUser({ email: 'bk-admin@example.com', name: 'Bk Admin', role: 'admin', accessLevel: 'manager' });
    const user = await app.createUser({ email: 'bk-user@example.com', name: 'Bk User', role: 'user', accessLevel: 'user' });
    seedTicket(user.id, 'alpha');
    seedTicket(user.id, 'beta');

    const before = (db.prepare('SELECT COUNT(*) AS n FROM app_ticket_comments').get() as { n: number }).n;

    // A second connection with an uncommitted write transaction.
    const writer = openDatabase(app.ctx.config.databasePath);
    writer.exec('BEGIN');
    for (let i = 0; i < 50; i++) {
      writer
        .prepare(
          `INSERT INTO app_ticket_comments (id, ticket_id, author_id, content, is_internal, created_at)
           VALUES (?, 't-alpha', ?, 'uncommitted', 0, ?)`,
        )
        .run(`wx-${i}`, user.id, Date.now());
    }

    try {
      const { dir, manifest } = await createBackup(
        app.ctx.config.databasePath,
        app.ctx.config.uploadDir,
        path.join(tmpDir, 'backups'),
      );
      expect(manifest.integrityCheck).toBe('ok');
      expect(manifest.foreignKeyViolations).toBe(0);
      expect(manifest.schemaVersion).toBeGreaterThanOrEqual(4);
      // The snapshot must NOT contain the uncommitted rows.
      expect(manifest.counts.comments).toBe(before);
      expect(fs.existsSync(path.join(dir, 'tickets.db'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(true);
    } finally {
      writer.exec('COMMIT');
      closeDatabase(writer);
    }

    const after = (db.prepare('SELECT COUNT(*) AS n FROM app_ticket_comments').get() as { n: number }).n;
    expect(after).toBe(before + 50);
  });

  it('restores into an isolated target and verifies data + uploads', async () => {
    const db = app.ctx.db;
    const user = await app.createUser({ email: 'bk-restore@example.com', name: 'Bk Restore', role: 'user', accessLevel: 'user' });
    seedTicket(user.id, 'gamma');

    // An upload file that must survive the round trip.
    const uploadFile = path.join(app.ctx.config.uploadDir, 'load-test.txt');
    fs.writeFileSync(uploadFile, 'attachment payload 123');

    const { dir, manifest } = await createBackup(
      app.ctx.config.databasePath,
      app.ctx.config.uploadDir,
      path.join(tmpDir, 'backups'),
    );
    expect(manifest.uploads.files).toBeGreaterThanOrEqual(1);
    const entry = manifest.uploads.entries.find((e) => e.relPath === 'load-test.txt');
    expect(entry).toBeDefined();

    const targetDb = path.join(tmpDir, 'restore', 'tickets.db');
    const targetUploads = path.join(tmpDir, 'restore', 'uploads');
    const result = restoreBackup(dir, targetDb, targetUploads);
    expect(result.schemaVersion).toBe(manifest.schemaVersion);
    expect(result.counts).toEqual(manifest.counts);

    // Restored data matches the snapshot, and uploads are byte-identical.
    const restored = openDatabase(targetDb);
    try {
      const n = (restored.prepare('SELECT COUNT(*) AS n FROM app_ticket_comments').get() as { n: number }).n;
      expect(n).toBe(manifest.counts.comments);
    } finally {
      closeDatabase(restored);
    }
    expect(fs.readFileSync(path.join(targetUploads, 'load-test.txt'), 'utf8')).toBe('attachment payload 123');
  });

  it('rejects a backup whose database checksum was tampered with', async () => {
    const { dir } = await createBackup(
      app.ctx.config.databasePath,
      app.ctx.config.uploadDir,
      path.join(tmpDir, 'backups'),
    );
    const dbFile = path.join(dir, 'tickets.db');
    const buf = fs.readFileSync(dbFile);
    buf[buf.length - 1] ^= 0xff;
    fs.writeFileSync(dbFile, buf);

    expect(() =>
      restoreBackup(dir, path.join(tmpDir, 'tampered.db'), path.join(tmpDir, 'tampered-uploads')),
    ).toThrow(/checksum mismatch/);
  });
});