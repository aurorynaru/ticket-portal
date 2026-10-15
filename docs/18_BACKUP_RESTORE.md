# 18 — Backup & Restore Operations

Scope: consistent backups of the SQLite database **and** the attachments
directory on the Railway persistent volume, plus a verified restore path.
Companion to `docs/14_OPERATIONS.md` (daily ops) and
`docs/11_RAILWAY_DEPLOY.md` (deployment).

## What a backup contains

Each backup is a directory `backup-<UTC timestamp>/` containing:

| File | Description |
| --- | --- |
| `tickets.db` | Consistent single-file snapshot via the SQLite **Online Backup API** (`Database.backup`). A plain file copy of a WAL database is NOT consistent — committed data can live in `-wal`/`-shm` sidecar files. |
| `uploads/` | Byte-for-byte copy of the attachments directory. |
| `manifest.json` | Timestamp, source paths, schema version, `PRAGMA integrity_check` result, `PRAGMA foreign_key_check` violation count, row counts (users/tickets/comments/attachments), database SHA-256, and per-upload-file SHA-256 checksums. |

The backup is verified **before** it is reported as successful: the snapshot
itself is opened and checked (`integrity_check = ok`, zero FK violations).
A backup that fails verification is an error, not a warning.

## Creating a backup

From the running service (in-container) or any environment with the built
app and access to the volume:

```bash
# default: <database dir>/backups  (i.e. /data/backups on Railway)
node dist/db/cli-backup.js

# explicit target root
node dist/db/cli-backup.js /data/backups
```

Local development equivalent: `npm run db:backup`.

Output is a JSON summary (directory, schema version, counts, sizes).

Recommended cadence: at least **daily**, and **before every deploy** that
could touch the schema (migrations run at boot; a failed boot after a bad
deploy is recoverable from the pre-deploy backup).

## Restoring a backup

Restore always writes to an **isolated target** and verifies the result. It
never overwrites the live database path without an explicit `--force`:

```bash
# 1. Restore to an isolated location and verify
node dist/db/cli-restore.js /data/backups/backup-2026-10-14T12-00-00-000Z \
  /data/restore/tickets.db /data/restore/uploads

# 2. Operator swaps the volume contents (stop service first):
#    - move current tickets.db + uploads aside (do not delete)
#    - move restored files into place
#    - start service; /health/ready must report ok
```

The restore command checks, in order: manifest present → database SHA-256
matches manifest → files copied → restored database opens with
`integrity_check = ok` and zero FK violations. Any failure aborts before the
target is left in a half-written state that the app would trust.

## Known edge cases

- **In-flight uploads at the backup instant**: the manifest records exactly
  which files were captured. An upload that lands after the snapshot is not
  in the backup; a restore from that backup does not contain it. Accepted
  trade-off for a single-writer attachment store.
- **WAL sidecars**: the Online Backup API produces a self-contained file;
  no `-wal`/`-shm` files are needed for a backup or a restore.
- **Restore of a tampered/corrupt backup**: checksum mismatch aborts the
  restore (covered by `tests/backup.test.ts`).

## Retention

Keep at least 7 daily backups on the volume and export the most recent one
off-volume (e.g. download from the Railway volume or copy to object storage)
so a volume-level failure does not destroy all copies.

## Verification evidence

- `tests/backup.test.ts` — snapshot consistency with an open write
  transaction, restore round-trip (data + uploads), tamper rejection.
- `npm run db:integrity` — live-database integrity check (see
  `docs/14_OPERATIONS.md`).