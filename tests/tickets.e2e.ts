import { test, expect } from 'e2e';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createTicket(screen: any, title: string, description: string) {
  await screen.getByLabel('Title *').fill(title);
  await screen.getByLabel('Description *').fill(description);
  await screen.getByRole('button', 'Create ticket').tap();
}

test('user can create a ticket and land on its detail page', { session: 'user' }, async ({ app, screen, browser }) => {
  await app.open('/tickets/new');
  await createTicket(screen, 'Printer jam on 3rd floor', 'The printer keeps jamming repeatedly.');
  await expect(browser).toHaveURL(/\/tickets\/.+/);
  await expect(screen.getByRole('heading', 'Printer jam on 3rd floor')).toBeVisible();
  await expect(screen.getByText('Assignee: Unassigned')).toBeVisible();
});

test('a created ticket appears in the ticket list', { session: 'user' }, async ({ app, screen }) => {
  await app.open('/tickets/new');
  await createTicket(screen, 'List visibility check', 'This ticket should show up in the list.');
  await app.open('/tickets');
  await expect(screen.getByText('List visibility check')).toBeVisible();
});

test('manager can assign and then reassign a ticket', { session: 'manager' }, async ({ app, screen, browser }) => {
  await app.open('/tickets/new');
  await createTicket(screen, 'Assignment flow', 'This ticket needs an owner and then a new one.');
  await expect(browser).toHaveURL(/\/tickets\/.+/);

  await screen.getByRole('button', 'Assign').tap();
  await screen.getByLabel('Assignee').selectOption({ label: 'User' });
  await screen.getByRole('button', 'Save').tap();
  await expect(browser).toHaveURL(/\/tickets\/.+/);
  await expect(screen.getByText('Assignee: User')).toBeVisible();

  await screen.getByRole('button', 'Assign').tap();
  await screen.getByLabel('Assignee').selectOption({ label: 'Viewer' });
  await screen.getByRole('button', 'Save').tap();
  await expect(screen.getByText('Assignee: Viewer')).toBeVisible();
});

test('a participant can comment on a ticket', { session: 'user' }, async ({ app, screen, browser }) => {
  await app.open('/tickets/new');
  await createTicket(screen, 'Comment flow', 'Adding comments to this ticket.');
  await expect(browser).toHaveURL(/\/tickets\/.+/);
  await screen.getByPlaceholder('Add a comment…').fill('First comment here.');
  await screen.getByRole('button', 'Comment').tap();
  await expect(screen.getByText('First comment here.')).toBeVisible();
});