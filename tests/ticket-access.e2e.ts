import { test, expect } from 'e2e';

test('anonymous users are redirected to login from the ticket list', async ({ app, browser }) => {
  await app.open('/tickets');
  await expect(browser).toHaveURL(/\/login/);
});

test('viewer cannot open the new ticket form', { session: 'viewer' }, async ({ app, browser }) => {
  await app.open('/tickets/new');
  await expect.poll(() => browser.evaluate(() => document.body.innerText)).toContain('Forbidden');
});

test('viewer sees the ticket list but no New ticket button', { session: 'viewer' }, async ({ app, screen }) => {
  await app.open('/tickets');
  await expect(screen.getByRole('heading', 'Tickets')).toBeVisible();
  await expect(screen.getByRole('link', 'New ticket')).not.toBeVisible();
});

test('a creator who is not the assignee is not offered the Resolve action', { session: 'user' }, async ({ app, screen, browser }) => {
  await app.open('/tickets/new');
  await screen.getByLabel('Title *').fill('Resolve permission check');
  await screen.getByLabel('Description *').fill('I created this ticket but am not the assignee.');
  await screen.getByRole('button', 'Create ticket').tap();
  await expect(browser).toHaveURL(/\/tickets\/.+/);
  await expect(screen.getByRole('button', 'Resolve')).not.toBeVisible();
});