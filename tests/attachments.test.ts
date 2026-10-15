import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from './helpers.js';
import * as svc from '../src/modules/tickets/service.js';
import * as repo from '../src/modules/tickets/repository.js';
import { fromNodeHeaders } from '../src/auth/session.js';
import { csrfToken } from '../src/lib/csrf.js';
import type { AuthUser } from '../src/auth/session.js';

const SECRET = 'test-secret-0123456789abcdef0123456789';

const PNG_1x1 = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA63FC636060000500010D0A2DB40000000049454E44AE426082',
  'hex',
);

let app: TestApp;
let user: AuthUser;
let viewer: AuthUser;
let userCookie: string;
let viewerCookie: string;

beforeAll(async () => {
  app = await makeTestApp();
  user = await app.createUser({ email: 'user@test.local', name: 'User', role: 'user', accessLevel: 'user' });
  viewer = await app.createUser({ email: 'viewer@test.local', name: 'Viewer', role: 'user', accessLevel: 'viewer' });
  userCookie = await signInCookie('user@test.local');
  viewerCookie = await signInCookie('viewer@test.local');
});

afterAll(async () => {
  await app.close();
});

function deps(actor: AuthUser) {
  return { db: app.ctx.db, actor };
}

function makeTicket(actor: AuthUser, over: Partial<svc.CreateTicketInput> = {}) {
  return svc.createTicket(deps(actor), {
    title: 'Attachment ticket',
    description: 'A ticket used by the attachment tests.',
    kind: 'TASK',
    categoryId: '',
    teamId: 'team-general',
    visibility: 'TEAM',
    priority: 'MEDIUM',
    assigneeId: '',
    dueAt: '',
    ...over,
  });
}

async function signInCookie(email: string): Promise<string> {
  const res = await app.ctx.app.inject({
    method: 'POST',
    url: '/login',
    payload: new URLSearchParams({ email, password: 'TestPass12345!' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost:3000' },
  });
  const cookies = res.headers['set-cookie'];
  const list = Array.isArray(cookies) ? cookies : [cookies];
  const match = list.find((c) => String(c).startsWith('better-auth.session_token='));
  return String(match).split(';')[0];
}

async function csrfFor(cookie: string): Promise<string> {
  const session = await app.ctx.auth.api.getSession({ headers: fromNodeHeaders({ cookie }) });
  return csrfToken(SECRET, session!.session.token);
}

function multipart(fields: Record<string, string>, filename: string, contentType: string, fileBuf: Buffer) {
  const boundary = '----p4testboundary';
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
  );
  parts.push(fileBuf);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function upload(cookie: string, ticketId: string, filename: string, contentType: string, fileBuf: Buffer, csrf?: string) {
  const { body, contentType: ct } = multipart(csrf ? { csrfToken: csrf } : {}, filename, contentType, fileBuf);
  return app.ctx.app.inject({
    method: 'POST',
    url: `/tickets/${ticketId}/attachments`,
    headers: { cookie, 'content-type': ct, origin: 'http://localhost:3000' },
    payload: body,
  });
}

function attachmentFor(ticketId: string) {
  return app.ctx.db
    .prepare('SELECT * FROM app_ticket_attachments WHERE ticket_id = ?')
    .get(ticketId) as { id: string; mime_type: string; byte_size: number; disk_key: string } | undefined;
}

describe('attachment upload', () => {
  it('stores a valid PNG on disk and serves it back', async () => {
    const { id } = makeTicket(user);
    const res = await upload(userCookie, id, 'shot.png', 'image/png', PNG_1x1, await csrfFor(userCookie));
    expect(res.statusCode).toBe(302);

    const row = attachmentFor(id);
    expect(row).toBeDefined();
    expect(row!.mime_type).toBe('image/png');
    expect(row!.byte_size).toBe(PNG_1x1.length);
    const diskPath = path.join(app.ctx.config.uploadDir, row!.disk_key);
    expect(fs.existsSync(diskPath)).toBe(true);
    expect(fs.readFileSync(diskPath)).toEqual(PNG_1x1);

    const dl = await app.ctx.app.inject({ method: 'GET', url: `/attachments/${row!.id}/download`, headers: { cookie: userCookie } });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toBe('image/png');
    // inject() decodes .body to a UTF-8 string, which corrupts binary; use the raw Buffer.
    expect(dl.rawPayload).toEqual(PNG_1x1);
  });

  it('rejects unsupported file types by magic bytes, not the client MIME', async () => {
    const { id } = makeTicket(user);
    const res = await upload(userCookie, id, 'notes.txt', 'text/plain', Buffer.from('hello world, this is not an image'), await csrfFor(userCookie));
    expect(res.statusCode).toBe(422);
    expect(attachmentFor(id)).toBeUndefined();
  });

  it('rejects oversized files', async () => {
    const { id } = makeTicket(user);
    const big = Buffer.concat([PNG_1x1, Buffer.alloc(2048, 1)]);
    const res = await upload(userCookie, id, 'big.png', 'image/png', big, await csrfFor(userCookie));
    expect(res.statusCode).toBe(413);
    expect(attachmentFor(id)).toBeUndefined();
  });

  it('rejects uploads without a CSRF token', async () => {
    const { id } = makeTicket(user);
    const res = await upload(userCookie, id, 'shot.png', 'image/png', PNG_1x1);
    expect(res.statusCode).toBe(403);
  });

  it('forbids viewers from uploading', async () => {
    const { id } = makeTicket(user);
    const res = await upload(viewerCookie, id, 'shot.png', 'image/png', PNG_1x1, await csrfFor(viewerCookie));
    expect(res.statusCode).toBe(403);
  });

  it('forbids uploads to closed tickets', async () => {
    const { id } = makeTicket(user);
    svc.assignTicket(deps(user), id, user.id, repo.getTicket(app.ctx.db, id)!.version);
    svc.startWork(deps(user), id, repo.getTicket(app.ctx.db, id)!.version, 'go');
    svc.resolveTicket(deps(user), id, repo.getTicket(app.ctx.db, id)!.version, {
      issueSummary: 'long enough summary',
      actionsTaken: 'long enough actions',
      resolution: 'long enough resolution',
    });
    svc.closeTicket(deps(user), id, repo.getTicket(app.ctx.db, id)!.version);
    const res = await upload(userCookie, id, 'late.png', 'image/png', PNG_1x1, await csrfFor(userCookie));
    expect(res.statusCode).toBe(422);
  });
});

describe('attachment download authorization', () => {
  it('hides attachments of RESTRICTED tickets from non-participants', async () => {
    const { id } = makeTicket(user, { visibility: 'RESTRICTED' });
    const up = await upload(userCookie, id, 'secret.png', 'image/png', PNG_1x1, await csrfFor(userCookie));
    expect(up.statusCode).toBe(302);
    const row = attachmentFor(id)!;
    const res = await app.ctx.app.inject({ method: 'GET', url: `/attachments/${row.id}/download`, headers: { cookie: viewerCookie } });
    expect(res.statusCode).toBe(404);
  });

  it('rejects path traversal disk keys', async () => {
    const { id } = makeTicket(user);
    const evilId = crypto.randomUUID();
    app.ctx.db
      .prepare(
        'INSERT INTO app_ticket_attachments (id, ticket_id, uploaded_by, original_name, mime_type, byte_size, sha256, disk_key, comment_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)',
      )
      .run(evilId, id, user.id, 'evil.png', 'image/png', 3, 'abc', '../evil.png', Date.now());
    const res = await app.ctx.app.inject({ method: 'GET', url: `/attachments/${evilId}/download`, headers: { cookie: userCookie } });
    expect(res.statusCode).toBe(404);
  });
});

describe('attachment delete', () => {
  it('lets the uploader delete their file', async () => {
    const { id } = makeTicket(user);
    await upload(userCookie, id, 'gone.png', 'image/png', PNG_1x1, await csrfFor(userCookie));
    const row = attachmentFor(id)!;
    const diskPath = path.join(app.ctx.config.uploadDir, row.disk_key);
    expect(fs.existsSync(diskPath)).toBe(true);

    const token = await csrfFor(userCookie);
    const del = await app.ctx.app.inject({
      method: 'POST',
      url: `/attachments/${row.id}/delete`,
      headers: { cookie: userCookie, 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost:3000' },
      payload: new URLSearchParams({ csrfToken: token }).toString(),
    });
    expect(del.statusCode).toBe(302);
    const n = app.ctx.db.prepare('SELECT COUNT(*) AS n FROM app_ticket_attachments WHERE id = ?').get(row.id) as { n: number };
    expect(n.n).toBe(0);
    expect(fs.existsSync(diskPath)).toBe(false);
  });

  it('forbids non-uploader non-privileged users from deleting', async () => {
    const { id } = makeTicket(user);
    await upload(userCookie, id, 'keep.png', 'image/png', PNG_1x1, await csrfFor(userCookie));
    const row = attachmentFor(id)!;
    const token = await csrfFor(viewerCookie);
    const del = await app.ctx.app.inject({
      method: 'POST',
      url: `/attachments/${row.id}/delete`,
      headers: { cookie: viewerCookie, 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost:3000' },
      payload: new URLSearchParams({ csrfToken: token }).toString(),
    });
    expect(del.statusCode).toBe(403);
  });
});