import path from 'node:path';
import { loadConfig } from '../config/env.js';
import { restoreBackup } from './backup.js';

/**
 * Restore a backup into an ISOLATED target location and verify it.
 *
 * Usage: node dist/db/cli-restore.js <backupDir> <targetDbPath> <targetUploadDir> [--force]
 *
 * Refuses to restore onto the live database path unless --force is given.
 * The live service must be stopped and the volume swapped by the operator
 * (see docs/18_BACKUP_RESTORE.md); this command only prepares and verifies
 * the restored copy.
 */
const args = process.argv.slice(2);
const force = args.includes('--force');
const positional = args.filter((a) => a !== '--force');
if (positional.length !== 3) {
  console.error(
    'Usage: node dist/db/cli-restore.js <backupDir> <targetDbPath> <targetUploadDir> [--force]',
  );
  process.exit(2);
}
const [backupDir, targetDbPath, targetUploadDir] = positional as [string, string, string];

const config = loadConfig();
const resolvedTarget = path.resolve(targetDbPath);
if (resolvedTarget === path.resolve(config.databasePath) && !force) {
  console.error(
    'Refusing to restore onto the live database path without --force. ' +
      'Restore to an isolated location and swap volumes per docs/18_BACKUP_RESTORE.md.',
  );
  process.exit(2);
}

const result = restoreBackup(path.resolve(backupDir), resolvedTarget, path.resolve(targetUploadDir));
console.log(
  JSON.stringify(
    {
      restoredDatabase: result.database,
      restoredUploads: result.uploadDir,
      schemaVersion: result.schemaVersion,
      counts: result.counts,
      integrity: 'ok',
    },
    null,
    2,
  ),
);