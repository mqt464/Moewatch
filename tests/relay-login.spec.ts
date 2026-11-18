import { test, expect, type Page } from '@playwright/test';

const authorizeUrl = 'https://auth.moewatch.test/authorize/browser-test';
const avatar = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

async function mockRelay(page: Page, outcome: 'complete' | 'denied' | 'pending') {
  let connected = false;
  let polls = 0;
  let cancellations = 0;
  let starts = 0;
  await page.route('**/api/v1/**', route => route.abort());
  await page.context().route('https://auth.moewatch.test/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>AniList authorization</h1>' }));
  await page.route('**/api/v1/account', route => route.fulfill({ json: { configured: true, user: connected ? { id: 81, name: 'Relay Viewer', avatar } : null } }));
  await page.route('**/api/v1/account/list', route => route.fulfill({ json: { entries: [] } }));
  await page.route('**/api/v1/account/login/start', route => {
    starts++;
    return route.fulfill({ json: { mode: 'relay', authorizeUrl, expiresAt: Date.now() + 60_000, interval: 1 } });
  });
  await page.route('**/api/v1/account/login/poll', route => {
    polls++;
    const status = polls === 1 ? 'pending' : outcome;
    if (status === 'complete') connected = true;
    return route.fulfill({ json: { status } });
  });
  await page.route('**/api/v1/account/login/cancel', route => {
    cancellations++;
    return route.fulfill({ json: { ok: true } });
  });
  return { polls: () => polls, starts: () => starts, cancellations: () => cancellations };
}

test('relay-only configured account opens hosted authorization and polls into connected profile', async ({ page }) => {
  const flow = await mockRelay(page, 'complete');
  await page.goto('/settings/account');
  const signIn = page.getByRole('button', { name: 'Sign in with AniList', exact: true });
  await expect(signIn).toBeEnabled();
  await expect(page.getByText('AniList sign-in is not configured on this server.')).toHaveCount(0);
  const opened = page.waitForEvent('popup');
  await signIn.click();
  const popup = await opened;
  await expect(popup).toHaveURL(authorizeUrl);
  await expect.poll(flow.polls).toBeGreaterThanOrEqual(1);
  await expect(page.getByText('Relay Viewer', { exact: true })).toBeVisible();
  await expect(page.locator('.profile-button img')).toHaveAttribute('src', avatar);
  await expect.poll(() => popup.isClosed()).toBe(true);
  expect(flow.polls()).toBeGreaterThanOrEqual(2);
  await expect(page).toHaveURL('/settings/account');
});

test('denied relay authorization closes popup and allows another attempt', async ({ page }) => {
  const flow = await mockRelay(page, 'denied');
  await page.goto('/settings/account');
  const signIn = page.getByRole('button', { name: 'Sign in with AniList', exact: true });
  const opened = page.waitForEvent('popup');
  await signIn.click();
  const popup = await opened;
  await expect(page.getByRole('alert')).toContainText(/denied|cancel|declin/i, { timeout: 10_000 });
  await expect(signIn).toBeEnabled();
  await expect.poll(() => popup.isClosed()).toBe(true);
  const retry = page.waitForEvent('popup');
  await signIn.click();
  const second = await retry;
  await expect.poll(flow.starts).toBe(2);
  await second.close();
});

test('closing pending authorization cancels login and enables retry', async ({ page }) => {
  const flow = await mockRelay(page, 'pending');
  await page.goto('/settings/account');
  const signIn = page.getByRole('button', { name: 'Sign in with AniList', exact: true });
  const opened = page.waitForEvent('popup');
  await signIn.click();
  const popup = await opened;
  await expect(popup).toHaveURL(authorizeUrl);
  await expect.poll(flow.polls).toBeGreaterThanOrEqual(1);
  await popup.close();
  await expect(signIn).toBeEnabled();
  await expect.poll(flow.cancellations).toBeGreaterThanOrEqual(1);
  const retry = page.waitForEvent('popup');
  await signIn.click();
  const second = await retry;
  await expect.poll(flow.starts).toBe(2);
  await second.close();
});

test('cancel button stops a pending relay login and closes authorization', async ({ page }) => {
  const flow = await mockRelay(page, 'pending');
  await page.goto('/settings/account');
  const opened = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Sign in with AniList', exact: true }).click();
  const popup = await opened;
  await expect(popup).toHaveURL(authorizeUrl);
  await page.getByRole('button', { name: /cancel/i }).click();
  await expect.poll(() => popup.isClosed()).toBe(true);
  await expect.poll(flow.cancellations).toBeGreaterThanOrEqual(1);
  await expect(page.getByRole('button', { name: 'Sign in with AniList', exact: true })).toBeEnabled();
});
