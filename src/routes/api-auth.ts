import type { FastifyInstance } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { publicRequestBase, type AppAuth } from '../auth/auth.js';
import type { AppConfig } from '../config/env.js';

/**
 * Mount Better Auth's official request handler at /api/auth/*.
 *
 * The Fastify request is translated to a standard Web `Request`, forwarded to
 * `auth.handler`, and the resulting `Response` (status, ALL headers including
 * Set-Cookie, and body) is written back unchanged. Form-encoded and JSON
 * bodies are both supported because the parsed body is re-serialized as JSON,
 * which Better Auth accepts.
 */
export function registerApiAuthRoutes(
  app: FastifyInstance,
  deps: { auth: AppAuth; config: AppConfig },
): void {
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    config: { rateLimit: { max: deps.config.rateLimitAuthMax, timeWindow: '1 minute' } },
    handler: async (req, reply) => {
      const base = publicRequestBase(deps.config, req.headers.host);
      const url = new URL(req.url, base);
      const headers = fromNodeHeaders(req.headers);
      const init: RequestInit = { method: req.method, headers };

      if (req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined && req.body !== null) {
        init.body = JSON.stringify(req.body);
        headers.set('content-type', 'application/json');
      }

      const response = await deps.auth.handler(new Request(url.toString(), init));
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        reply.header(key, value);
      });
      const text = await response.text();
      return reply.send(text.length > 0 ? text : null);
    },
  });
}