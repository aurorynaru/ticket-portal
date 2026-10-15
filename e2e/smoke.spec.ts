import { test, expect } from '@playwright/test';

test.describe('P0 smoke (synthetic local data only)', () => {
  test('health endpoints respond and index page renders', async ({ page, request }) => {
    const live = await request.get('/health/live');
    expect(live.ok()).toBeTruthy();
    expect(await live.json()).toEqual({ status: 'live' });

    const ready = await request.get('/health/ready');
    expect(ready.ok()).toBeTruthy();
    const readyBody = (await ready.json()) as { status: string; schemaVersion: number };
    expect(readyBody.status).toBe('ready');
    expect(readyBody.schemaVersion).toBeGreaterThanOrEqual(1);

    await page.goto('/');
    // Unauthenticated root redirects to the sign-in page.
    await expect(page).toHaveURL(/\/login/);
    await expect(page).toHaveTitle('Sign in · Ticketing');
    await expect(page.locator('h1')).toHaveText('Ticketing');
    await expect(page.locator('link[href="/assets/app.css"]')).toHaveAttribute('href', '/assets/app.css');
  });
});