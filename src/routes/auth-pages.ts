import type { FastifyInstance } from 'fastify';
import { fromNodeHeaders, resolveSession } from '../auth/session.js';
import { requireAuth, type GuardDeps } from '../auth/guard.js';
import { verifyCsrf } from '../lib/csrf.js';
import { HttpError } from '../lib/errors.js';
import { dashboardViewData } from '../modules/dashboard/routes.js';

export function registerAuthPageRoutes(app: FastifyInstance, deps: GuardDeps): void {
  // Public login page. Already-authenticated users go to the app.
  app.get('/login', async (req, reply) => {
    const user = await resolveSession(deps.auth, deps.db, fromNodeHeaders(req.headers));
    if (user) return reply.redirect('/', 302);
    const error = (req.query as { error?: string }).error === '1';
    return reply.view('login.ejs', {
      title: 'Sign in · Ticketing',
      csrfToken: '',
      user: null,
      role: null,
      showLoginError: error,
    });
  });

  // Conventional (non-JS) sign-in form handler. Delegates to Better Auth's
  // official handler, forwards the session cookie, and redirects on success.
  app.post('/login', async (req, reply) => {
    const { email, password } = req.body as { email?: string; password?: string };
    const base = `http://${req.headers.host ?? 'localhost'}`;
    const url = new URL('/api/auth/sign-in/email', base);
    const headers = fromNodeHeaders(req.headers);
    headers.set('content-type', 'application/json');
    const request = new Request(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: email ?? '', password: password ?? '' }),
    });
    const response = await deps.auth.handler(request);
    for (const cookie of response.headers.getSetCookie()) {
      reply.header('set-cookie', cookie);
    }
    if (response.ok) {
      return reply.redirect('/', 302);
    }
    return reply.status(401).view('login.ejs', {
      title: 'Sign in · Ticketing',
      csrfToken: '',
      user: null,
      role: null,
      showLoginError: true,
    });
  });

  // Protected routes live in their own encapsulation so the auth hook applies
  // only to them (never to /login).
  app.register(async (scope) => {
    requireAuth(scope, deps);

    scope.post('/logout', async (req, reply) => {
      const user = req.authUser;
      if (!user) throw new HttpError(401, 'Not authenticated');
      const token = (req.body as { csrfToken?: string })?.csrfToken;
      if (!verifyCsrf(deps.config.betterAuthSecret ?? '', user.sessionToken, token)) {
        throw new HttpError(403, 'Invalid CSRF token');
      }
      await deps.auth.api.signOut({ headers: fromNodeHeaders(req.headers) });
      return reply.redirect('/login', 302);
    });

    scope.get('/account', async (req, reply) => {
      const user = req.authUser;
      if (!user) throw new HttpError(401, 'Not authenticated');
      return reply.view('account.ejs', {
        title: 'Account · Ticketing',
        csrfToken: req.csrfToken ?? '',
        role: user.role,
        user: { name: user.name, email: user.email, role: user.role },
        current: 'account',
        inShell: true,
      });
    });

    scope.get('/', async (req, reply) => {
      const user = req.authUser;
      if (!user) throw new HttpError(401, 'Not authenticated');
      const { stats, activity } = dashboardViewData(deps, user);
      return reply.view('home.ejs', {
        title: 'Dashboard · Ticketing',
        csrfToken: req.csrfToken ?? '',
        role: user.role,
        user: { name: user.name, email: user.email, role: user.role },
        stats,
        activity,
        fmtTime: (ms: number) => `${new Date(ms).toISOString().replace('T', ' ').slice(0, 16)} UTC`,
        current: 'dashboard',
        inShell: true,
      });
    });
  });
}