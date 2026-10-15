import type { AppDatabase } from '../../db/connection.js';

export interface AttachmentRow {
  id: string;
  ticket_id: string;
  comment_id: string | null;
  uploaded_by: string;
  original_name: string;
  disk_key: string;
  mime_type: string;
  byte_size: number;
  sha256: string | null;
  created_at: number;
}

export function listAttachments(db: AppDatabase, ticketId: string): AttachmentRow[] {
  return db
    .prepare(
      `SELECT * FROM app_ticket_attachments WHERE ticket_id = ? ORDER BY created_at ASC, rowid ASC`,
    )
    .all(ticketId) as AttachmentRow[];
}

export function getAttachment(db: AppDatabase, id: string): AttachmentRow | null {
  const row = db.prepare('SELECT * FROM app_ticket_attachments WHERE id = ?').get(id) as
    | AttachmentRow
    | undefined;
  return row ?? null;
}

export function insertAttachment(
  db: AppDatabase,
  a: {
    id: string;
    ticketId: string;
    uploadedBy: string;
    originalName: string;
    diskKey: string;
    mimeType: string;
    byteSize: number;
    sha256: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO app_ticket_attachments
       (id, ticket_id, comment_id, uploaded_by, original_name, disk_key, mime_type, byte_size, sha256, created_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    a.id,
    a.ticketId,
    a.uploadedBy,
    a.originalName,
    a.diskKey,
    a.mimeType,
    a.byteSize,
    a.sha256,
    Date.now(),
  );
}

export function deleteAttachment(db: AppDatabase, id: string): boolean {
  const result = db.prepare('DELETE FROM app_ticket_attachments WHERE id = ?').run(id);
  return result.changes > 0;
}