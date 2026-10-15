import { test, credentials, expect } from 'e2e';

test('manager can run the full lifecycle: assign, start, resolve, close, reopen', { session: 'manager' }, async ({ app, screen, browser }) => {
  await app.open('/tickets/new');
  await screen.getByLabel('Title *').fill('Full lifecycle ticket');
  await screen.getByLabel('Description *').fill('This ticket walks the whole state machine.');
  await screen.getByLabel('Team').selectOption({ label: 'General' });
  await screen.getByRole('button', 'Create ticket').tap();
  await expect(browser).toHaveURL(/\/tickets\/.+/);
  await expect(screen.getByRole('heading', 'Full lifecycle ticket')).toBeVisible();

  // assign to self
  await screen.getByRole('button', 'Assign').tap();
  await screen.getByLabel('Assignee').selectOption({ label: 'Manager' });
  await screen.getByRole('button', 'Save').tap();
  await expect(screen.getByText('Assignee: Manager')).toBeVisible();

  // start work
  await screen.getByRole('button', 'Start work').tap();
  await screen.getByRole('button', 'Start').tap();
  await expect(screen.getByText('IN_PROGRESS')).toBeVisible();

  // resolve with required documentation
  await screen.getByRole('button', 'Resolve').tap();
  await screen.getByLabel('Issue summary *').fill('The thing was broken.');
  await screen.getByLabel('Work performed *').fill('Fixed the thing carefully.');
  await screen.getByLabel('Resolution *').fill('The thing now works correctly.');
  await screen.getByRole('button', 'Mark resolved').tap();
  await expect(screen.getByText('RESOLVED')).toBeVisible();

  // close
  await screen.getByRole('button', 'Close').tap();
  await expect(screen.getByText('CLOSED')).toBeVisible();

  // reopen with a reason
  await screen.getByRole('button', 'Reopen').tap();
  await screen.getByLabel('Reason *').fill('It broke again, sadly.');
  await screen.getByRole('button', 'Reopen ticket').tap();
  await expect(screen.getByText('ASSIGNED')).toBeVisible();
});

// Isolated exploratory test: the only ticket test that depends on the local LLM.
// Excluded from the mandatory gate via --exclude-tag exploratory.
test('exploratory: agent tours the ticket workflow', { tags: ['exploratory'], timeout: 600000 }, async ({ app, agent, browser }) => {
  let llmUp = false;
  try {
    const res = await fetch('http://127.0.0.1:11434/v1/models');
    llmUp = res.ok;
  } catch {
    llmUp = false;
  }
  if (!llmUp) {
    test.skip(true, 'local LLM endpoint (127.0.0.1:11434) unreachable');
    return;
  }
  const creds = credentials.user('manager');
  await app.open('/login');
  await agent.act('Sign in to the ticketing app', {
    params: { username: creds.username, password: creds.password },
    timeout: 480000,
  });
  await agent.act('Create a new ticket titled "Exploratory check" with a short description, then open it.', {
    timeout: 480000,
  });
  await expect(browser).toHaveURL(/\/tickets\/.+/);
  await agent.assert('The ticket detail page shows the ticket title and an activity log.', {
    timeout: 240000,
  });
});