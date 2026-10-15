import path from 'node:path';
import { loadConfig } from '../config/env.js';
import { createBackup } from './backup.js';

/**
 * Consistent online backup of the live database + uploads.
 *
 * Usage: node dist/db/cli-backup.js [backupRoot]
 *   backupRoot defaults to <database dir>/backups (on the same volume, so
 *   Railway volume backups also cover these snapshots).
 */
const config = loadConfig();
const backupRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(path.dirname(config.databasePath), 'backups');

const { dir, manifest } = await createBackup(config.databasePath, config.uploadDir, backupRoot);
console.log(
  JSON.stringify(
    {
      backupDir: dir,
      createdAt: manifest.createdAt,
      schemaVersion: manifest.schemaVersion,
      integrityCheck: manifest.integrityCheck,
      foreignKeyViolations: manifest.foreignKeyViolations,
      counts: manifest.counts,
      databaseBytes: manifest.database.bytes,
      uploadFiles: manifest.uploads.files,
      uploadBytes: manifest.uploads.bytes,
    },
    null,
    2,
  ),
);