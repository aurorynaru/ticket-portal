import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { fromNodeHeaders, resolveSession, type AuthUser } from './session.js';
import type { AppAuth } from './auth.js';
import type { AppDatabase } from '../db/connection.js';
import { csrfToken } from '../lib/csrf.js';
import type { AppConfig } from '../config/env.js';

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
    csrfToken?: string;
  }
}

export interface GuardDeps {
  auth: AppAuth;
  db: AppDatabase;
  config: AppConfig;
  getSchemaVersion: () => number;
}

function isHtmx(req: FastifyRequest): boolean {
  return req.headers['hx-request'] === 'true';
}

function sendUnauthorized(req: FastifyRequest, reply: FastifyReply): void {
  const next = encodeURIComponent(req.url);
  if (isHtmx(req)) {
    reply.status(401).header('HX-Redirect', `/login?next=${next}`).send();
    return;
  }
  reply.redirect(`/login?next=${next}`, 302);
}

/**
 * Register an onRequest hook in the current encapsulation that resolves the
 * session and attaches `req.authUser` + `req.csrfToken`. Unauthenticated
 * requests are redirected to login (full page) or answered with a controlled
 * HTMX redirect.
 */
export function requireAuth(app: FastifyInstance, deps: GuardDeps): void {
  app.addHook('onRequest', async (req, reply) => {
    const user = await resolveSession(deps.auth, deps.db, fromNodeHeaders(req.headers));
    if (!user) {
      sendUnauthorized(req, reply);
      return;
    }
    req.authUser = user;
    req.csrfToken = csrfToken(deps.config.betterAuthSecret ?? '', user.sessionToken);
  });
}

/**
 * Like requireAuth, but additionally requires the effective role to be admin.
 * Must be called after requireAuth within the same encapsulation.
 */
export function requireAdmin(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    if (!req.authUser) {
      sendUnauthorized(req, reply);
      return;
    }
    if (req.authUser.role !== 'admin') {
      if (isHtmx(req)) {
        reply.status(403).header('HX-Retarget', '#error-region').type('text/html; charset=utf-8').send('<p role="alert" class="text-sm text-red-700">Forbidden</p>');
        return;
      }
      reply.code(403).type('application/json').send({ error: 'Forbidden', requestId: req.id });
    }
  });
}