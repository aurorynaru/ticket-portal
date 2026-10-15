import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { escapeHtml } from './html.js';

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const FRIENDLY: Record<number, string> = {
  400: 'Bad request',
  401: 'Not authenticated',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  413: 'Payload too large',
  422: 'Invalid input',
  429: 'Too many requests',
};

function friendlyMessage(status: number): string {
  return FRIENDLY[status] ?? (status >= 500 ? 'Internal server error' : 'Request failed');
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: Error & { statusCode?: number }, req: FastifyRequest, reply: FastifyReply) => {
    const status =
      typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : 500;
    if (status >= 500) {
      req.log.error({ err: error, requestId: req.id }, 'request failed');
    } else {
      req.log.info({ status, requestId: req.id }, 'request rejected');
    }
    if (req.headers['hx-request'] === 'true') {
      reply
        .status(status)
        .header('HX-Retarget', '#error-region')
        .type('text/html; charset=utf-8')
        .send(`<p role="alert" class="text-sm text-red-700">${escapeHtml(friendlyMessage(status))}</p>`);
      return;
    }
    reply.status(status).type('application/json').send({
      error: friendlyMessage(status),
      requestId: req.id,
    });
  });
}