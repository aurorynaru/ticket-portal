import { test, credentials, expect } from 'e2e';

// Isolated exploratory test: the only test that depends on the local LLM.
// Core acceptance tests never depend on the model (see --exclude-tag exploratory).
// The local 27B thinking model needs minutes per agent step, so this test
// gets its own 10-minute budget instead of the 120s default.
test('exploratory: sign in and tour the app', { tags: ['exploratory'], timeout: 600000 }, async ({ app, agent, browser }) => {
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
  const creds = credentials.user('admin');
  await app.open('/login');
  await agent.act('Sign in to the ticketing app', {
    params: { username: creds.username, password: creds.password },
    timeout: 480000,
  });
  await expect(browser).toHaveURL('/');
  await agent.assert('The home page welcomes the signed-in admin user.', {
    timeout: 240000,
  });
});