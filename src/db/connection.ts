import Database from 'better-sqlite3';

export type AppDatabase = Database.Database;

export function openDatabase(databasePath: string): AppDatabase {
  const db = new Database(databasePath);
  // WAL is a persistent database-level setting; the others are per-connection.
  // synchronous=NORMAL is the documented safe setting for WAL: commits are
  // durable (WAL + checkpoint) without a full fsync per transaction.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  return db;
}

export function closeDatabase(db: AppDatabase): void {
  if (!db.open) return;
  db.close();
}