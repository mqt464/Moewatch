import { test, expect } from '@playwright/test';
import { curated } from '../src/catalog';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0; localStorage.removeItem('moewatch.hero-history'); });
});

test('My List keeps episode progress inside posters in every category', async ({ page }) => {
  await page.route('**/api/v1/**', route => route.abort());
  await page.addInitScript(({ titles }) => {
    const states = ['CURRENT', 'PAUSED', 'PLANNING', 'COMPLETED', 'DROPPED'];
    localStorage.setItem('moewatch-library-v1', JSON.stringify({ saved: titles,
      statuses: Object.fromEntries(titles.map((anime, index) => [anime.id, states[index]])),
      progress: titles.map(anime => ({ anime, episode: 4, time: 300, duration: 1200, updated: Date.now() })),
    }));
  }, { titles: curated.slice(0, 5) });
  await page.goto('/list');
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('progressbar')).toHaveCount(5);
    for (const poster of await page.locator('.saved-poster').all()) {
      await expect(poster.getByText('Episode 4', { exact: true })).toBeVisible();
      await expect(poster.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
      const image = await poster.locator('.poster-image').boundingBox();
      for (const element of [poster.locator('.poster-episode'), poster.getByRole('progressbar')]) {
        const bounds = await element.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(image!.x);
        expect(bounds!.y).toBeGreaterThanOrEqual(image!.y);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(image!.x + image!.width + 1);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(image!.y + image!.height + 1);
      }
    }
  }
});

test('My List groups statuses in order and hides empty groups', async ({ page }) => {
  await page.route('**/api/v1/**', route => route.abort());
  await page.addInitScript(({ titles }) => {
    localStorage.setItem('moewatch-library-v1', JSON.stringify({ saved: titles, progress: [], statuses: {
      [titles[0].id]: 'DROPPED', [titles[1].id]: 'COMPLETED', [titles[2].id]: 'PLANNING',
      [titles[3].id]: 'PAUSED', [titles[4].id]: 'CURRENT', [titles[5].id]: 'REPEATING',
    } }));
  }, { titles: curated.slice(0, 6) });
  await page.goto('/list');
  await expect(page.locator('.library-group > h2')).toHaveText(['Watching', 'Paused', 'Planning', 'Completed', 'Dropped']);
  await expect(page.getByRole('region', { name: 'Watching', exact: true }).locator('.poster')).toHaveCount(2);
  await page.getByRole('combobox', { name: `List status for ${curated[3].title}` }).selectOption('PLANNING');
  await expect(page.locator('.library-group > h2')).toHaveText(['Watching', 'Planning', 'Completed', 'Dropped']);
  await expect(page.getByRole('region', { name: 'Planning', exact: true }).locator('.poster')).toHaveCount(2);
});

test('Discover Watching uses standard posters and only Watching entries', async ({ page }) => {
  await page.route('**/api/v1/**', route => route.abort());
  await page.addInitScript(({ titles }) => {
    localStorage.setItem('moewatch-library-v1', JSON.stringify({
      saved: titles, progress: [{ anime: titles[0], episode: 3, time: 300, duration: 1200, updated: Date.now() }],
      statuses: { [titles[0].id]: 'CURRENT', [titles[1].id]: 'DROPPED', [titles[2].id]: 'PLANNING', [titles[3].id]: 'COMPLETED' },
    }));
  }, { titles: curated.slice(0, 4) });
  await page.goto('/');
  const row = page.getByRole('region', { name: 'Watching', exact: true });
  await expect(row.locator('.poster')).toHaveCount(1);
  await expect(row.locator('.poster h3')).toHaveText(curated[0].title);
  await expect(row.locator('.continue-card, .landscape-rail')).toHaveCount(0);
  await expect(row.locator('.poster-link')).toHaveAttribute('href', `/anime/${curated[0].id}`);
  await expect(row.getByText('Episode 3', { exact: true })).toBeVisible();
  await expect(row.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
});

test('expired session offers sign-in without claiming OAuth is unconfigured', async ({ page }) => {
  await page.route('**/api/v1/account', route => route.fulfill({ json: { configured: true, user: null, error: 'Session expired' } }));
  await page.goto('/settings/account');
  await expect(page.getByText('Session expired', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in with AniList' })).toBeEnabled();
  await expect(page.getByText('AniList sign-in is not configured on this server.')).toHaveCount(0);
});

test('list status persists, omits the active menu option and supports removal', async ({ page }) => {
  await page.route('**/api/v1/**', route => route.abort());
  await page.goto('/anime/154587');
  const status = page.getByRole('combobox', { name: /List status for Frieren/ });
  await expect(status).toBeEnabled();
  await status.selectOption('CURRENT');
  await expect(status).toHaveValue('CURRENT');
  await expect(status.locator('option[value="CURRENT"]')).toHaveAttribute('hidden', '');
  await status.selectOption('DROPPED');
  await page.reload();
  await expect(status).toHaveValue('DROPPED');
  await status.selectOption('COMPLETED');
  await expect(status).toHaveValue('COMPLETED');
  await page.screenshot({ path: 'test-results/list-status-desktop.png' });
  await page.setViewportSize({ width: 375, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/list-status-mobile.png' });
  await page.goto('/list');
  const saved = page.getByRole('combobox', { name: /List status for Frieren/ });
  await expect(saved).toHaveValue('COMPLETED');
  await saved.selectOption('');
  await expect(page.locator('.saved-grid .poster')).toHaveCount(0);
});

test('connected status selection updates AniList through the sync API', async ({ page }) => {
  const anime = curated.find(a => a.id === 154587)!;
  let entry = { id: 1, mediaId: anime.id, anime, progress: 2, status: 'CURRENT', updatedAt: 1 };
  let written: Record<string, unknown> | undefined;
  await page.route('**/api/v1/**', route => route.abort());
  await page.route('**/api/v1/account', route => route.fulfill({ json: { configured: true, user: { id: 42, name: 'Test', avatar: '' } } }));
  await page.route('**/api/v1/account/list', route => {
    if (route.request().method() === 'PUT') {
      written = route.request().postDataJSON();
      entry = { ...entry, status: String(written!.status), progress: Number(written!.progress) };
      return route.fulfill({ json: { entry } });
    }
    return route.fulfill({ json: { entries: [entry] } });
  });
  await page.goto('/anime/154587');
  const status = page.getByRole('combobox', { name: /List status for Frieren/ });
  await expect(status).toHaveValue('CURRENT');
  await status.selectOption('COMPLETED');
  await expect.poll(() => written?.status).toBe('COMPLETED');
  expect(written?.progress).toBe(anime.episodes);
  await expect(status).toHaveValue('COMPLETED');
});
