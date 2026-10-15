import { test, credentials, expect } from 'e2e';

test('sign in with valid credentials reaches the home page', async ({ app, screen, browser }) => {
  const creds = credentials.user('admin');
  await app.open('/login');
  await screen.getByLabel('Email').fill(creds.username);
  await screen.getByLabel('Password').fill(creds.password);
  await screen.getByRole('button', 'Sign in').tap();
  await expect(browser).toHaveURL(/\/$/);
  await expect(screen.getByRole('heading', 'Welcome, Admin')).toBeVisible();
});

test('sign in with a wrong password shows an error and stays on login', async ({ app, screen, browser }) => {
  const creds = credentials.user('admin');
  await app.open('/login');
  await screen.getByLabel('Email').fill(creds.username);
  await screen.getByLabel('Password').fill('WrongPassword123!');
  await screen.getByRole('button', 'Sign in').tap();
  await expect(browser).toHaveURL(/\/login/);
  await expect(screen.getByRole('alert')).toHaveText('Invalid email or password.');
});

test('session persists across a full page reload', { session: 'admin' }, async ({ app, screen, browser }) => {
  await app.open('/');
  await expect(screen.getByRole('heading', 'Welcome, Admin')).toBeVisible();
  await browser.reload();
  await expect(screen.getByRole('heading', 'Welcome, Admin')).toBeVisible();
});

// Signs in fresh instead of using the saved "admin" session: a real sign-out
// deletes the session token from the database, which would invalidate the
// shared saved session for every later test that restores it.
test('sign out returns to the login page and clears the session', async ({ app, screen, browser }) => {
  const creds = credentials.user('admin');
  await app.open('/login');
  await screen.getByLabel('Email').fill(creds.username);
  await screen.getByLabel('Password').fill(creds.password);
  await screen.getByRole('button', 'Sign in').tap();
  await expect(browser).toHaveURL(/\/$/);
  await app.open('/account');
  await screen.getByRole('button', 'Sign out').tap();
  await expect(browser).toHaveURL(/\/login/);
  await app.open('/');
  await expect(browser).toHaveURL(/\/login/);
});