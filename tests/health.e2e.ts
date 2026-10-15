import { test, expect } from 'e2e';

test('health live endpoint responds', async ({ app, browser }) => {
  await app.open('/health/live');
  await expect.poll(() => browser.evaluate(() => document.body.innerText)).toContain('live');
});