import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import view from '@fastify/view';
import fastifyStatic from '@fastify/static';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import ejs from 'ejs';
import type { AppConfig } from './config/env.js';
import { openDatabase, closeDatabase, type AppDatabase } from './db/connection.js';
import { runMigrations } from './db/migrations.js';
import { createAuth, type AppAuth } from './auth/auth.js';
import { registerErrorHandler } from './lib/errors.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerApiAuthRoutes } from './routes/api-auth.js';
import { registerAuthPageRoutes } from './routes/auth-pages.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerTicketRoutes } from './modules/tickets/routes.js';
import { registerSearchRoutes } from './modules/search/routes.js';
import { registerNotificationRoutes } from './modules/notifications/routes.js';
import { registerAttachmentRoutes } from './modules/attachments/routes.js';
import { registerDashboardRoutes } from './modules/dashboard/routes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const appRoot = path.resolve(here, '..');

export interface AppContext {
  app: FastifyInstance;
  db: AppDatabase;
  auth: AppAuth;
  config: AppConfig;
  schemaVersion: number;
  close: () => Promise<void>;
}

export async function buildApp(config: AppConfig): Promise<AppContext> {
  const db = openDatabase(config.databasePath);
  let schemaVersion = 0;
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: ['req.headers.cookie', 'req.headers.authorization'],
        censor: '[REDACTED]',
      },
    },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  // Better Auth instance (shares the application database handle).
  const auth = createAuth(db, config);

  try {
    // 1) Better Auth tables (user/session/account/verification) — idempotent,
    //    diff-based, safe to run at startup (docs/17).
    await (await auth.$context).runMigrations();
    // 2) Application migrations (0001, 0002). 0002 FK-references user(id), so
    //    the auth tables must exist first.
    const result = runMigrations(db, path.join(appRoot, 'migrations'));
    schemaVersion = result.version;
  } catch (err) {
    closeDatabase(db);
    throw err;
  }

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // No inline <style> tags or style="" attributes are rendered, and no
        // hx-* attributes exist yet, so 'unsafe-inline' is not required.
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  });
  await app.register(formbody);
  await app.register(multipart, {
    limits: {
      fileSize: config.maxUploadBytes,
      files: 10,
      fieldSize: 64 * 1024,
    },
  });
  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: '1 minute',
  });
  await app.register(view, {
    engine: { ejs },
    root: path.join(appRoot, 'src', 'views'),
    defaultContext: {
      pollSeconds: config.notificationPollSeconds,
    },
  });
  await app.register(fastifyStatic, {
    root: path.join(appRoot, 'public'),
    maxAge: '7d',
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Request-Id', _req.id);
  });

  registerErrorHandler(app);
  app.setNotFoundHandler((req, reply) => {
    if (req.headers['hx-request'] === 'true') {
      reply
        .status(404)
        .header('HX-Retarget', '#error-region')
        .type('text/html; charset=utf-8')
        .send('<p role="alert" class="text-sm text-red-700">Not found</p>');
      return;
    }
    reply.status(404).type('application/json').send({ error: 'Not found', requestId: req.id });
  });

  const guardDeps = {
    auth,
    db,
    config,
    getSchemaVersion: () => schemaVersion,
  };

  registerHealthRoutes(app, { db, getSchemaVersion: () => schemaVersion });
  registerApiAuthRoutes(app, { auth, config });
  registerAuthPageRoutes(app, guardDeps);
  registerAdminRoutes(app, guardDeps);
  registerTicketRoutes(app, guardDeps);
  registerSearchRoutes(app, guardDeps);
  registerNotificationRoutes(app, guardDeps);
  registerAttachmentRoutes(app, guardDeps);
  registerDashboardRoutes(app, guardDeps);

  const close = async (): Promise<void> => {
    await app.close();
    closeDatabase(db);
  };

  return { app, db, auth, config, schemaVersion, close };
}