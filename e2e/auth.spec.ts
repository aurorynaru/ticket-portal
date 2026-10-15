import { test, expect } from '@playwright/test';

test.describe('P1 authentication (synthetic local data only)', () => {
  test('anonymous visitor is redirected to the sign-in page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('h1')).toHaveText('Ticketing');
  });

  test('admin can sign in, manage users, and sign out', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#email').fill('admin@example.com');
    await page.locator('#password').fill('Admin12345!');
    await page.locator('button[type="submit"]').click();

    // Authenticated home.
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('h1')).toHaveText('Welcome, Admin');

    // Admin-only user management page.
    await page.goto('/admin/users');
    await expect(page.locator('h1')).toHaveText('Users');
    await expect(page.locator('table')).toContainText('admin@example.com');

    // Provision a new user through the conventional form.
    await page.locator('#nu-email').fill('e2e-new@example.com');
    await page.locator('#nu-name').fill('E2E New');
    await page.locator('#nu-password').fill('E2ENew12345!');
    await page.locator('#nu-level').selectOption('viewer');
    await page.locator('section form button[type="submit"]').first().click();
    await expect(page.locator('table')).toContainText('e2e-new@example.com');

    // Sign out.
    await page.locator('form[action="/logout"] button[type="submit"]').click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('a non-admin cannot open the user management page', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#email').fill('user@example.com');
    await page.locator('#password').fill('User12345!');
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('h1')).toHaveText('Welcome, User');

    await page.goto('/admin/users');
    // Non-admins are denied (403) — they never see the user table.
    await expect(page.locator('table')).toHaveCount(0);
  });
});