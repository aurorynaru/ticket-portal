import { test, expect } from 'e2e';

const NEW_USER_EMAIL = 'tarmy-created@example.com';

test('admin can open the user list', { session: 'admin' }, async ({ app, screen }) => {
  await app.open('/admin/users');
  await expect(screen.getByText('admin@example.com')).toBeVisible();
  await expect(screen.getByText('viewer@example.com')).toBeVisible();
});

test('admin can create a user with viewer access', { session: 'admin' }, async ({ app, screen, browser }) => {
  await app.open('/admin/users');
  await screen.getByLabel('Email').fill(NEW_USER_EMAIL);
  await screen.getByLabel('Name').fill('Tarmy Created');
  await screen.getByLabel('Password').fill('TarmyPass12345!');
  await screen.getByLabel('Access level').selectOption('viewer');
  await screen.getByRole('button', 'Create user').tap();
  await expect(browser).toHaveURL('/admin/users');
  await expect(screen.getByText(NEW_USER_EMAIL)).toBeVisible();
});

test('admin can deactivate and reactivate a user', { session: 'admin' }, async ({ app, screen }) => {
  await app.open('/admin/users');
  const row = screen.getByRole('row').filter({ hasText: NEW_USER_EMAIL });
  await row.getByRole('button', 'Deactivate').tap();
  await expect(row.getByText('inactive')).toBeVisible();
  await row.getByRole('button', 'Activate').tap();
  await expect(row.getByText('active')).toBeVisible();
});