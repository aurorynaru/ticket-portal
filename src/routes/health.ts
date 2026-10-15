import type { FastifyInstance } from 'fastify';
import type { AppDatabase } from '../db/connection.js';

export interface HealthDeps {
  db: AppDatabase;
  getSchemaVersion: () => number;
}

export function registerHealthRoutes(app: FastifyInstance, deps: HealthDeps): void {
  app.get('/health/live', async (_req, reply) => {
    reply.type('application/json').send({ status: 'live' });
  });

  app.get('/health/ready', async (_req, reply) => {
    try {
      const check = deps.db.prepare('PRAGMA quick_check').get() as { quick_check: string };
      if (check.quick_check !== 'ok') {
        throw new Error('integrity check failed');
      }
      const row = deps.db.prepare('SELECT COUNT(*) AS n FROM app_schema_migrations').get() as {
        n: number;
      };
      reply.type('application/json').send({
        status: 'ready',
        schemaVersion: deps.getSchemaVersion(),
        migrations: row.n,
      });
    } catch {
      reply.status(503).type('application/json').send({ status: 'not_ready' });
    }
  });
}