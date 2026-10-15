import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDatabase, closeDatabase, type AppDatabase } from './connection.js';

/**
 * Consistent SQLite backup/restore for the persistent volume.
 *
 * - Backups use the SQLite Online Backup API (`Database.backup`), which
 *   produces a consistent single-file snapshot even while the live database
 *   accepts writes. A plain file copy of a WAL database is NOT consistent
 *   (committed data may live in -wal/-shm files).
 * - Uploads are copied alongside the database snapshot with per-file SHA-256
 *   checksums recorded in a manifest. In-flight uploads at the backup instant
 *   are an accepted, documented edge case (docs/14): the manifest records
 *   exactly which files were captured.
 * - Restores are always written to an isolated target; the live database is
 *   never overwritten by the restore path itself.
 */

export interface BackupFileEntry {
  relPath: string;
  bytes: number;
  sha256: string;
}

export interface BackupManifest {
  createdAt: string;
  source: { database: string; uploadDir: string };
  schemaVersion: number;
  integrityCheck: string;
  foreignKeyViolations: number;
  counts: {
    users: number;
    tickets: number;
    comments: number;
    attachments: number;
  };
  database: { file: string; bytes: number; sha256: string };
  uploads: { files: number; bytes: number; entries: BackupFileEntry[] };
}

export interface BackupResult {
  dir: string;
  manifest: BackupManifest;
}

function sha256File(file: string): string {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024);
    let n: number;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function walkFiles(dir: string, base: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, base));
    } else if (entry.isFile()) {
      out.push(path.relative(base, full));
    }
  }
  return out;
}

function dbCounts(db: AppDatabase): BackupManifest['counts'] {
  const count = (table: string): number => {
    try {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      return row.n;
    } catch {
      return 0;
    }
  };
  return {
    users: count('user'),
    tickets: count('app_tickets'),
    comments: count('app_ticket_comments'),
    attachments: count('app_ticket_attachments'),
  };
}

function verifyDb(dbPath: string): {
  integrityCheck: string;
  foreignKeyViolations: number;
  schemaVersion: number;
  counts: BackupManifest['counts'];
} {
  const db = openDatabase(dbPath);
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    const fk = db.prepare('PRAGMA foreign_key_check').all() as unknown[];
    let schemaVersion = 0;
    try {
      const row = db.prepare('SELECT MAX(version) AS v FROM app_schema_migrations').get() as
        | { v: number | null }
        | undefined;
      schemaVersion = row?.v ?? 0;
    } catch {
      // No migrations table (pre-migration database); leave 0.
    }
    return {
      integrityCheck: integrity.integrity_check,
      foreignKeyViolations: fk.length,
      schemaVersion,
      counts: dbCounts(db),
    };
  } finally {
    closeDatabase(db);
  }
}

/**
 * Create a consistent backup of the live database and upload directory.
 *
 * @param sourceDbPath  live SQLite file (e.g. /data/tickets.db)
 * @param uploadDir     live attachments directory (e.g. /data/uploads)
 * @param backupRoot    directory that receives backup-<timestamp>/ subdirs
 */
export async function createBackup(
  sourceDbPath: string,
  uploadDir: string,
  backupRoot: string,
): Promise<BackupResult> {
  if (!fs.existsSync(sourceDbPath)) {
    throw new Error(`Source database not found: ${sourceDbPath}`);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(backupRoot, `backup-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });

  const destDb = path.join(dir, 'tickets.db');
  // Second connection to the live database; the Online Backup API keeps the
  // snapshot consistent with committed data while writers continue.
  // NOTE: Database.backup() is async (page transfer runs on setImmediate),
  // so the source connection must stay open until the promise settles.
  const src = openDatabase(sourceDbPath);
  try {
    await src.backup(destDb);
  } finally {
    closeDatabase(src);
  }

  const destUploads = path.join(dir, 'uploads');
  fs.mkdirSync(destUploads, { recursive: true });
  if (fs.existsSync(uploadDir)) {
    fs.cpSync(uploadDir, destUploads, { recursive: true });
  }

  const dbInfo = verifyDb(destDb);
  if (dbInfo.integrityCheck !== 'ok' || dbInfo.foreignKeyViolations > 0) {
    throw new Error(
      `Backup verification failed: integrity=${dbInfo.integrityCheck} ` +
        `fkViolations=${dbInfo.foreignKeyViolations}`,
    );
  }

  const uploadEntries: BackupFileEntry[] = walkFiles(destUploads, destUploads).map((rel) => {
    const full = path.join(destUploads, rel);
    const st = fs.statSync(full);
    return { relPath: rel, bytes: st.size, sha256: sha256File(full) };
  });
  const uploadBytes = uploadEntries.reduce((sum, e) => sum + e.bytes, 0);
  const dbStat = fs.statSync(destDb);

  const manifest: BackupManifest = {
    createdAt: new Date().toISOString(),
    source: { database: sourceDbPath, uploadDir },
    schemaVersion: dbInfo.schemaVersion,
    integrityCheck: dbInfo.integrityCheck,
    foreignKeyViolations: dbInfo.foreignKeyViolations,
    counts: dbInfo.counts,
    database: { file: 'tickets.db', bytes: dbStat.size, sha256: sha256File(destDb) },
    uploads: { files: uploadEntries.length, bytes: uploadBytes, entries: uploadEntries },
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { dir, manifest };
}

export interface RestoreResult {
  database: string;
  uploadDir: string;
  schemaVersion: number;
  counts: BackupManifest['counts'];
}

/**
 * Restore a backup into an isolated target location and verify it.
 * Refuses (throws) when the manifest is missing, checksums do not match, or
 * the restored database fails integrity checks.
 */
export function restoreBackup(
  backupDir: string,
  targetDbPath: string,
  targetUploadDir: string,
): RestoreResult {
  const manifestPath = path.join(backupDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Not a backup directory (missing manifest.json): ${backupDir}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest;

  const srcDb = path.join(backupDir, manifest.database.file);
  if (!fs.existsSync(srcDb)) {
    throw new Error(`Backup database file missing: ${srcDb}`);
  }
  const actualSha = sha256File(srcDb);
  if (actualSha !== manifest.database.sha256) {
    throw new Error(
      `Backup database checksum mismatch (manifest ${manifest.database.sha256}, actual ${actualSha})`,
    );
  }

  fs.mkdirSync(path.dirname(targetDbPath), { recursive: true });
  fs.mkdirSync(targetUploadDir, { recursive: true });
  fs.copyFileSync(srcDb, targetDbPath);
  // Remove WAL/SHM sidecars of the target so the restored file opens clean.
  for (const suffix of ['-wal', '-shm']) {
    fs.rmSync(targetDbPath + suffix, { force: true });
  }
  const srcUploads = path.join(backupDir, 'uploads');
  if (fs.existsSync(srcUploads)) {
    fs.cpSync(srcUploads, targetUploadDir, { recursive: true });
  }

  const info = verifyDb(targetDbPath);
  if (info.integrityCheck !== 'ok' || info.foreignKeyViolations > 0) {
    throw new Error(
      `Restored database failed verification: integrity=${info.integrityCheck} ` +
        `fkViolations=${info.foreignKeyViolations}`,
    );
  }
  return {
    database: targetDbPath,
    uploadDir: targetUploadDir,
    schemaVersion: info.schemaVersion,
    counts: info.counts,
  };
}