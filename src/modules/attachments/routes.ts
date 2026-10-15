import { createHash } from 'node:crypto';
import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth, type GuardDeps } from '../../auth/guard.js';
import type { AuthUser } from '../../auth/session.js';
import { verifyCsrf } from '../../lib/csrf.js';
import { HttpError } from '../../lib/errors.js';
import * as repo from './repository.js';
import { getTicket, isTeamMember, isWatcher } from '../tickets/repository.js';
import { canComment, canReadTicket, type AccessInput } from '../tickets/policy.js';

/** Magic-byte signatures; the client MIME type is never trusted. */
const SIGNATURES: Array<[Buffer, string]> = [
  [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'],
  [Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg'],
  [Buffer.from('GIF8'), 'image/gif'],
  [Buffer.from('%PDF-'), 'application/pdf'],
  [Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'application/zip'],
];

function detectMimeType(filePath: string): string | null {
  let head: Buffer;
  try {
    const fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(8);
    const read = readSync(fd, buf, 0, 8, 0);
    closeSync(fd);
    head = buf.subarray(0, read);
  } catch {
    return null;
  }
  for (const [sig, mime] of SIGNATURES) {
    if (head.length >= sig.length && head.subarray(0, sig.length).equals(sig)) return mime;
  }
  return null;
}

/** Strip directories and unsafe characters; the name is display-only. */
function sanitizeName(name: string | undefined): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[^\w.\- ()\[\]]/g, '_').trim().slice(0, 255);
  return clean || 'file';
}

function quoteForDisposition(name: string): string {
  const clean = name.replace(/["\\]/g, '').replace(/[\r\n]/g, '').slice(0, 255);
  return clean || 'file';
}

function pipeToFile(stream: NodeJS.ReadableStream, dest: string): Promise<{ size: number; sha256: string }> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const out = createWriteStream(dest);
    let size = 0;
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      hash.update(chunk);
    });
    stream.on('end', () => {
      out.end(() => resolve({ size, sha256: hash.digest('hex') }));
    });
    stream.on('error', reject);
    out.on('error', reject);
    stream.pipe(out);
  });
}

export function registerAttachmentRoutes(app: FastifyInstance, deps: GuardDeps): void {
  app.register(async (scope) => {
    requireAuth(scope, deps);

    function actor(req: FastifyRequest): AuthUser {
      const u = req.authUser;
      if (!u) throw new HttpError(401, 'Not authenticated');
      return u;
    }

    function checkCsrf(req: FastifyRequest): void {
      const u = actor(req);
      const token = (req.body as { csrfToken?: string } | undefined)?.csrfToken;
      if (!verifyCsrf(deps.config.betterAuthSecret ?? '', u.sessionToken, token)) {
        throw new HttpError(403, 'Invalid CSRF token');
      }
    }

    function accessFor(u: AuthUser, ticketId: string): { ticket: NonNullable<ReturnType<typeof getTicket>>; access: AccessInput } {
      const ticket = getTicket(deps.db, ticketId);
      if (!ticket) throw new HttpError(404, 'Ticket not found');
      const access: AccessInput = {
        actor: { id: u.id, role: u.role },
        ticket,
        teamMember: ticket.team_id !== null && isTeamMember(deps.db, ticket.team_id, u.id),
        watcher: isWatcher(deps.db, ticket.id, u.id),
      };
      if (!canReadTicket(access)) throw new HttpError(404, 'Ticket not found');
      return { ticket, access };
    }

    scope.post('/tickets/:id/attachments', async (req, reply) => {
      const { id } = req.params as { id: string };
      const u = actor(req);
      const { ticket, access } = accessFor(u, id);
      if (!canComment(access)) throw new HttpError(403, 'You cannot attach files to this ticket.');
      if (ticket.status === 'CLOSED') throw new HttpError(422, 'Closed tickets do not accept new attachments.');

      let file;
      try {
        file = await req.file();
      } catch (err) {
        const status = (err as { statusCode?: number } | null)?.statusCode;
        if (status === 413) throw new HttpError(413, 'File exceeds the maximum upload size.');
        throw err;
      }
      if (!file) throw new HttpError(422, 'Choose a file to upload.');
      const fields = file.fields as unknown as Record<string, string | { value?: string } | undefined>;
      const rawToken = fields?.csrfToken;
      const token =
        typeof rawToken === 'string'
          ? rawToken
          : rawToken && typeof rawToken === 'object' && typeof rawToken.value === 'string'
            ? rawToken.value
            : undefined;
      if (!verifyCsrf(deps.config.betterAuthSecret ?? '', u.sessionToken, token)) {
        throw new HttpError(403, 'Invalid CSRF token');
      }

      const attachmentId = crypto.randomUUID();
      const diskKey = `${ticket.id}/${attachmentId}`;
      const finalPath = path.join(deps.config.uploadDir, diskKey);
      const tempPath = path.join(deps.config.uploadDir, `.tmp-${attachmentId}`);
      try {
        mkdirSync(deps.config.uploadDir, { recursive: true });
        const { size, sha256 } = await pipeToFile(file.file, tempPath);
        // Busboy truncates the stream at the fileSize limit instead of rejecting
        // req.file(), so an oversized upload surfaces as a truncated stream.
        if (file.file.truncated || size > deps.config.maxUploadBytes) {
          throw new HttpError(413, 'File exceeds the maximum upload size.');
        }
        if (size === 0) throw new HttpError(422, 'Upload is empty.');
        const mimeType = detectMimeType(tempPath);
        if (!mimeType) {
          throw new HttpError(422, 'Unsupported file type. Allowed: PNG, JPEG, GIF, PDF, ZIP.');
        }
        mkdirSync(path.dirname(finalPath), { recursive: true });
        renameSync(tempPath, finalPath);
        repo.insertAttachment(deps.db, {
          id: attachmentId,
          ticketId: ticket.id,
          uploadedBy: u.id,
          originalName: sanitizeName(file.filename),
          diskKey,
          mimeType,
          byteSize: size,
          sha256,
        });
      } catch (err) {
        rmSync(tempPath, { force: true });
        throw err;
      }
      return reply.redirect(`/tickets/${ticket.id}`, 302);
    });

    scope.get('/attachments/:id/download', async (req, reply) => {
      const { id } = req.params as { id: string };
      const u = actor(req);
      const att = repo.getAttachment(deps.db, id);
      if (!att) throw new HttpError(404, 'Attachment not found');
      const { ticket } = accessFor(u, att.ticket_id);

      const uploadRoot = path.resolve(deps.config.uploadDir);
      const filePath = path.resolve(uploadRoot, att.disk_key);
      if (filePath !== uploadRoot && !filePath.startsWith(uploadRoot + path.sep)) {
        throw new HttpError(404, 'Attachment not found');
      }
      if (!existsSync(filePath)) throw new HttpError(404, 'Attachment file missing');
      const stat = statSync(filePath);

      reply.header('Content-Type', att.mime_type);
      reply.header('Content-Length', stat.size);
      reply.header('Content-Disposition', `attachment; filename="${quoteForDisposition(att.original_name)}"`);
      reply.header('X-Content-Type-Options', 'nosniff');
      return reply.send(createReadStream(filePath));
    });

    scope.post('/attachments/:id/delete', async (req, reply) => {
      checkCsrf(req);
      const { id } = req.params as { id: string };
      const u = actor(req);
      const att = repo.getAttachment(deps.db, id);
      if (!att) throw new HttpError(404, 'Attachment not found');
      const { ticket } = accessFor(u, att.ticket_id);
      const allowed =
        u.id === att.uploaded_by ||
        u.id === ticket.created_by ||
        u.role === 'admin' ||
        u.role === 'manager';
      if (!allowed) throw new HttpError(403, 'You cannot delete this attachment.');
      repo.deleteAttachment(deps.db, id);
      rmSync(path.join(deps.config.uploadDir, att.disk_key), { force: true });
      return reply.redirect(`/tickets/${ticket.id}`, 302);
    });
  });
}