# 14 — Operations, backups, incident response

## Daily / weekly routines

- Check Railway app uptime, recent errors, memory/CPU, request latency and storage use.
- Check failed outbox messages and notification backlog; verify users can log in.
- Confirm volume backup schedule remains enabled and successful.
- Weekly: inspect unassigned/overdue tickets, dormant accounts, growth of uploads and WAL.
- Monthly: restore one backup to an isolated copy, verify DB integrity, count tickets/attachments and sample downloads.

## Backup strategy

Use two layers:

1. **Railway volume backups:** daily and weekly as needed. Protects whole `/data` including SQLite and attachments. These snapshots are convenience recovery; understand retention and project/env restore restrictions.
2. **Independent consistent backup:** create SQLite online backup using the **SQLite backup API** or a correctly managed `VACUUM INTO` while DB is open; archive upload directory in a coordinated backup window. Include a manifest with DB integrity result, attachment count/checksums and timestamp. Store archival copy separately from the volume and periodically test restoration.

Do not use `cp /data/tickets.db ...` alone while SQLite WAL transactions are active: that can omit committed data in WAL. Do not copy only the `.db` ignoring `.db-wal`/`.db-shm` while live. Ensure database-to-file manifest consistency when capturing uploads, and plan for possible in-flight uploads. SQLite's online backup API produces a consistent DB snapshot, but files need a separate coordinated policy.

## Restore drill (staging only unless approved)

1. Announce service disruption; disable writes and snapshot current state first.
2. Restore a **separate volume or local isolated directory**; never overwrite live data without approval.
3. Run `PRAGMA integrity_check` and `PRAGMA foreign_key_check` on restored copy.
4. Verify `app_schema_migrations` matches the deployed app, check counts, inspect FTS query, check 3 random ticket histories and download attachments.
5. Start staging app with restored copy; login, open ticket, create a temporary ticket, resolve and close.
6. Record elapsed downtime, missing newest records (RPO), and test result in `STATUS.md`.
7. Only then perform production restore with owner approval and clear rollback plan.

## Common incident runbooks

**SQLite locked/busy:** check recent deploy and write concurrency, query duration, lock error counts; ensure all writes short and busy timeout configured; investigate long transactions and corrupted state before increasing timeout. Don't disable data integrity protections.

**High memory:** verify upload streaming, oversized templates/queries, many simultaneous file downloads, unbounded buffers, Better Auth session/config caches and build artifact accidentally launched in dev mode. Test a fresh load scenario after fix.

**Volume full:** stop or limit new attachments, inspect actual used space and deleted files, archive older attachments only with retention policy, resize volume if approved, verify DB writes resume and integrity okay. Do not delete WAL files manually while DB is open.

**Broken login:** inspect HTTPS origin, `BETTER_AUTH_URL`, cookies, time synchronization, Better Auth schema revision and secret value; don't reset secret without planned session invalidation.

**Failed migration:** app stays not-ready; take snapshot, inspect migration version, restore test copy and produce forward repair migration. Never silently truncate schema table or blindly replay destructive SQL.

**Lost attachment metadata / orphan file:** reconcile disk keys vs DB metadata; quarantine orphans and generate a report. Do not expose orphan content publicly.

## Audit and retention

Audit events should be append-only and retained for a documented policy (initial default: indefinite for small internal volume; revisit per company requirements). Attachments and users are soft-deactivated, not silently deleted. Enforce disk quota thresholds, e.g. warn at 70%, alert at 85%, restrict new large uploads at 95% until repaired.

## Recovery objectives

Initial operational objective: accept brief single-instance downtime for deploys, with RPO bounded by configured backup cadence and tested independent copies. **Do not promise zero downtime or point-in-time recovery** for SQLite on one Railway volume. Record actual achieved RTO/RPO after drills.
