import type { FastifyInstance, FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { requireAuth, requireAdmin, type GuardDeps } from '../auth/guard.js';
import { verifyCsrf } from '../lib/csrf.js';
import { HttpError } from '../lib/errors.js';
import { isAssignableLevel, type AssignableLevel } from '../auth/policy.js';
import {
  provisionUser,
  activateUser,
  deactivateUser,
  setAccessLevel,
  promoteToAdmin,
  demoteFromAdmin,
  resetPassword,
  type ProvisioningDeps,
} from '../auth/provisioning.js';
import type { AppDatabase } from '../db/connection.js';

interface AdminRow {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  banned: number | null;
  access_level: string | null;
  is_active: number | null;
}

function listUsers(db: AppDatabase): AdminRow[] {
  return db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.banned,
              p.access_level, p.is_active
FROM user u
        LEFT JOIN app_user_profiles p ON p.user_id = u.id
        ORDER BY u.createdAt ASC`,
    )
    .all() as AdminRow[];
}

export function registerAdminRoutes(app: FastifyInstance, deps: GuardDeps): void {
  app.register(async (scope) => {
    requireAuth(scope, deps);
    requireAdmin(scope);

    function checkCsrf(req: FastifyRequest): void {
      const user = req.authUser;
      if (!user) throw new HttpError(401, 'Not authenticated');
      const token = (req.body as { csrfToken?: string })?.csrfToken;
      if (!verifyCsrf(deps.config.betterAuthSecret ?? '', user.sessionToken, token)) {
        throw new HttpError(403, 'Invalid CSRF token');
      }
    }

    function provisioningDeps(req: FastifyRequest): ProvisioningDeps {
      return {
        auth: deps.auth,
        db: deps.db,
        actor: req.authUser!,
        actorHeaders: fromNodeHeaders(req.headers),
      };
    }

    scope.get('/admin/users', async (req, reply) => {
      const users = listUsers(deps.db);
      return reply.view('admin-users.ejs', {
        title: 'Users · Ticketing',
        csrfToken: req.csrfToken ?? '',
        role: req.authUser!.role,
        user: { name: req.authUser!.name, email: req.authUser!.email, role: req.authUser!.role },
        users,
        levels: ['manager', 'user', 'viewer'],
        current: 'admin',
        inShell: true,
      });
    });

    scope.post('/admin/users', async (req, reply) => {
      checkCsrf(req);
      const body = req.body as { email?: string; name?: string; password?: string; accessLevel?: string };
      if (!isAssignableLevel(body.accessLevel)) throw new HttpError(422, 'Invalid access level');
      await provisionUser(provisioningDeps(req), {
        email: body.email ?? '',
        name: body.name ?? '',
        password: body.password ?? '',
        accessLevel: body.accessLevel,
      });
      return reply.redirect('/admin/users', 302);
    });

    scope.post('/admin/users/:id/activate', async (req, reply) => {
      checkCsrf(req);
      const { id } = req.params as { id: string };
      await activateUser(provisioningDeps(req), id);
      return reply.redirect('/admin/users', 302);
    });

    scope.post('/admin/users/:id/deactivate', async (req, reply) => {
      checkCsrf(req);
      const { id } = req.params as { id: string };
      await deactivateUser(provisioningDeps(req), id);
      return reply.redirect('/admin/users', 302);
    });

    scope.post('/admin/users/:id/level', async (req, reply) => {
      checkCsrf(req);
      const { id } = req.params as { id: string };
      const level = (req.body as { level?: string })?.level;
      if (!isAssignableLevel(level)) throw new HttpError(422, 'Invalid access level');
      await setAccessLevel(provisioningDeps(req), id, level as AssignableLevel);
      return reply.redirect('/admin/users', 302);
    });

    scope.post('/admin/users/:id/promote', async (req, reply) => {
      checkCsrf(req);
      const { id } = req.params as { id: string };
      await promoteToAdmin(provisioningDeps(req), id);
      return reply.redirect('/admin/users', 302);
    });

    scope.post('/admin/users/:id/demote', async (req, reply) => {
      checkCsrf(req);
      const { id } = req.params as { id: string };
      const level = (req.body as { level?: string })?.level;
      if (!isAssignableLevel(level)) throw new HttpError(422, 'Invalid access level');
      await demoteFromAdmin(provisioningDeps(req), id, level as AssignableLevel);
      return reply.redirect('/admin/users', 302);
    });

    scope.post('/admin/users/:id/password', async (req, reply) => {
      checkCsrf(req);
      const { id } = req.params as { id: string };
      const newPassword = (req.body as { newPassword?: string })?.newPassword ?? '';
      await resetPassword(provisioningDeps(req), id, newPassword);
      return reply.redirect('/admin/users', 302);
    });
  });
}