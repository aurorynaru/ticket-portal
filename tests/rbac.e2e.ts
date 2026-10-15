import { test, expect } from 'e2e';

test('anonymous requests for the app are redirected to login', async ({ app, browser }) => {
  await app.open('/');
  await expect(browser).toHaveURL(/\/login/);
});

test('non-admin cannot open the admin user page', { session: 'user' }, async ({ app, browser }) => {
  await app.open('/admin/users');
  await expect.poll(() => browser.evaluate(() => document.body.innerText)).toContain('Forbidden');
});

test('viewer sees no Users nav link', { session: 'viewer' }, async ({ app, screen }) => {
  await app.open('/');
  await expect(screen.getByRole('link', 'Users')).not.toBeVisible();
});

test('admin sees the Users nav link', { session: 'admin' }, async ({ app, screen }) => {
  await app.open('/');
  await expect(screen.getByRole('link', 'Users')).toBeVisible();
});