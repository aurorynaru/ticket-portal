import { test, credentials, expect } from 'e2e';

const PERSONAS = [
  { name: 'admin', user: 'Admin' },
  { name: 'manager', user: 'Manager' },
  { name: 'user', user: 'User' },
  { name: 'viewer', user: 'Viewer' },
] as const;

test.setup(
  'sign in each seeded persona',
  { sessions: ['admin', 'manager', 'user', 'viewer'] },
  async ({ app, screen, session, browser }) => {
    for (const persona of PERSONAS) {
      const creds = credentials.user(persona.name);
      await app.open('/login');
      await screen.getByLabel('Email').fill(creds.username);
      await screen.getByLabel('Password').fill(creds.password);
      await screen.getByRole('button', 'Sign in').tap();
      await expect(browser).toHaveURL(/\/$/);
      await expect(screen.getByRole('heading', `Welcome, ${persona.user}`)).toBeVisible();
      await session.save(persona.name);
      // Clear cookies locally without calling the app's logout: a real sign-out
      // deletes the session token from the database and would invalidate the
      // state we just saved.
      await app.clearState();
    }
  },
);