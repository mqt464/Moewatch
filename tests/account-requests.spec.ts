import { test, expect } from '@playwright/test';
import curated from '../src/curated.json' with { type: 'json' };

test('automatic focus refreshes are throttled, idle sync reads once, and manual Sync remains fresh', async ({ page }) => {
  await page.route('**/api/v1/**', route => route.abort());
  await page.route('**/api/v1/account', route => route.fulfill({ json: { configured: true, user: { id: 42, name: 'Test', avatar: '' } } }));
  const refreshes: string[] = [];
  await page.route('**/api/v1/account/list', route => {
    refreshes.push(route.request().headers()['x-moewatch-refresh']);
    return route.fulfill({ json: { entries: [] } });
  });
  await page.goto('/settings/account');
  const sync = page.getByRole('button', { name: 'Sync now', exact: true });
  await expect(sync).toBeEnabled();
  expect(refreshes).toEqual(['0']);
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
  });
  await sync.click();
  await expect(sync).toBeEnabled();
  expect(refreshes).toEqual(['0', '1']);
});

test('recommendations stay visible when the next automatic refresh is rate limited', async ({ page }) => {
  await page.clock.install();
  await page.route('**/api/v1/**', route => route.abort());
  await page.route('**/api/v1/account', route => route.fulfill({ json: { configured: true, user: { id: 42, name: 'Test', avatar: '' } } }));
  await page.route('**/api/v1/account/list', route => route.fulfill({ json: { entries: [] } }));
  let requests = 0;
  await page.route('**/api/v1/account/recommendations?*', route => {
    requests++;
    return requests === 1 ? route.fulfill({ json: { anime: [curated[0]] } }) : route.fulfill({ status: 429, json: { error: { code: 'RATE_LIMITED', message: 'AniList rate limit reached' } } });
  });
  await page.goto('/');
  const row = page.getByRole('region', { name: 'Recommended', exact: true });
  await expect(row.getByRole('heading', { name: curated[0].title })).toBeVisible();
  await page.clock.fastForward(3 * 60_000 + 1000);
  await expect.poll(() => requests).toBe(2);
  await expect(row.getByRole('heading', { name: curated[0].title })).toBeVisible();
  await expect(page.getByText('AniList recommendations are unavailable right now.')).toHaveCount(0);
});
