import { test, expect } from 'e2e';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createTicket(screen: any, title: string, description: string) {
  await screen.getByLabel('Title *').fill(title);
  await screen.getByLabel('Description *').fill(description);
  await screen.getByRole('button', 'Create ticket').tap();
}

test('search finds a ticket by title word', { session: 'user' }, async ({ app, screen }) => {
  await app.open('/tickets/new');
  await createTicket(screen, 'Searchable widget failure', 'The widget fails to start in the morning.');
  await app.open('/search?q=widget');
  await expect(screen.getByText('Searchable widget failure')).toBeVisible();
});

test('the dashboard shows metric cards and recent activity', { session: 'user' }, async ({ app, screen }) => {
  await app.open('/dashboard');
  await expect(screen.getByRole('heading', 'Welcome, User')).toBeVisible();
  await expect(screen.getByText('Overdue')).toBeVisible();
  await expect(screen.getByText('Recent activity')).toBeVisible();
});

test('manager assigns a ticket so the assignee gets a notification', { session: 'manager' }, async ({ app, screen }) => {
  await app.open('/tickets/new');
  await createTicket(screen, 'Notification source ticket', 'This ticket will be assigned to create a notification.');
  await screen.getByRole('button', 'Assign').tap();
  await screen.getByLabel('Assignee').selectOption({ label: 'User' });
  await screen.getByRole('button', 'Save').tap();
  await expect(screen.getByText('Assignee: User')).toBeVisible();
});

test('the assignee sees the notification on the notifications page', { session: 'user' }, async ({ app, screen }) => {
  await app.open('/notifications');
  await expect(screen.getByRole('heading', 'Notifications')).toBeVisible();
  await expect(screen.getByText('Notification source ticket')).toBeVisible();
});

test('a user can upload an attachment and see it listed', { session: 'user' }, async ({ app, screen, browser }) => {
  await app.open('/tickets/new');
  await createTicket(screen, 'Attachment target ticket', 'This ticket receives an attachment.');
  await expect(browser).toHaveURL(/\/tickets\/.+/);
  await screen.getByLabel('Upload file').setInputFiles('tests/fixtures/sample.png');
  await screen.getByRole('button', 'Upload').tap();
  await expect(screen.getByText('sample.png')).toBeVisible();
});