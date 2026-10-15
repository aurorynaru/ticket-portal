import { test, expect } from 'e2e';

test('POST /logout without a CSRF token is rejected and the session survives', { session: 'admin' }, async ({ app, browser }) => {
  await app.open('/account');
  const result = await browser.evaluate(async () => {
    const res = await fetch('/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'csrfToken=',
    });
    return { status: res.status, body: await res.text() };
  });
  expect(result.status).toBe(403);
  await app.open('/');
  await expect(browser).toHaveURL(/\/$/);
});

test('POST /admin/users without a CSRF token is rejected', { session: 'admin' }, async ({ app, browser }) => {
  await app.open('/admin/users');
  const result = await browser.evaluate(async () => {
    const res = await fetch('/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        email: 'csrf-probe@example.com',
        name: 'Csrf Probe',
        password: 'ProbePass12345!',
        accessLevel: 'viewer',
      }).toString(),
    });
    return { status: res.status, body: await res.text() };
  });
  expect(result.status).toBe(403);
});