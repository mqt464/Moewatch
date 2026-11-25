import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import curated from '../src/curated.json' with { type: 'json' };

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', route => route.abort());
});

test('settings opens editing; cancel, save, reset and navigation preserve the right layout', async ({ page }) => {
  await page.goto('/settings/appearance');
  await page.getByRole('link', { name: 'Customize home' }).click();
  const bar = page.getByRole('region', { name: 'Homepage editing' });
  await expect(bar).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Move Watching down' }).click();
  await page.getByRole('checkbox', { name: 'Show Action', exact: true }).uncheck();
  await bar.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(bar).toHaveCount(0);
  await page.goto('/settings/appearance');
  await page.getByRole('link', { name: 'Customize home' }).click();
  await expect(page.locator('[data-home-row]').first()).toHaveAttribute('data-home-row', 'watching');
  await expect(page.getByRole('checkbox', { name: 'Show Action', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Move Watching down' }).click();
  await page.getByRole('checkbox', { name: 'Show Action', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Show hero' }).uncheck();
  await page.getByRole('combobox', { name: 'Watching card style' }).selectOption('landscape');
  await bar.getByRole('button', { name: 'Save', exact: true }).click();
  await page.reload();
  await expect(bar).toHaveCount(0);
  await expect(page.locator('.home-hero')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Action', exact: true })).toHaveCount(0);
  await page.goto('/settings/appearance');
  await page.getByRole('link', { name: 'Customize home' }).click();
  await expect(page.locator('[data-home-row]').first()).toHaveAttribute('data-home-row', 'recommended');
  await expect(page.getByRole('combobox', { name: 'Watching card style' })).toHaveValue('landscape');
  await bar.getByRole('button', { name: 'Reset layout' }).click();
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL('/browse');
  await expect(page.getByRole('heading', { name: 'Search', exact: true })).toBeVisible();
  await expect(bar).toHaveCount(0);
  await page.goBack();
  await expect(bar).toHaveCount(0);
  await expect(page.locator('.home-hero')).toHaveCount(0);
});

test('drag handles and keyboard controls reorder rows', async ({ page }) => {
  await page.goto('/settings/appearance');
  await page.getByRole('link', { name: 'Customize home' }).click();
  const watching = page.locator('[data-home-row="watching"]');
  await expect(watching.locator('h2:visible')).toHaveCount(1);
  await expect(watching.locator('.home-row-tools h2')).toHaveText('Watching');
  const source = page.getByRole('button', { name: 'Drag Watching to reorder' });
  const target = page.locator('[data-home-row="recommended"]');
  await target.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('Missing row bounds');
  await page.mouse.move(from.x + 20, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(to.x + 20, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('[data-home-row]').first()).toHaveAttribute('data-home-row', 'recommended');
  const up = page.getByRole('button', { name: 'Move Watching up' });
  await up.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-home-row]').first()).toHaveAttribute('data-home-row', 'watching');
});

test('landscape cards show episode artwork, remaining time and progress on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(anime => {
    if (localStorage.getItem('seeded-home')) return;
    localStorage.setItem('seeded-home', 'true');
    localStorage.setItem('moewatch-settings-v1', JSON.stringify({ homeLayout: { continueStyle: 'landscape' } }));
    localStorage.setItem('moewatch-library-v1', JSON.stringify({ saved: [anime], statuses: { [anime.id]: 'CURRENT' }, progress: [
      { anime: { ...anime, episodeArtwork: [{ number: 2, title: 'Episode title', thumbnail: 'https://example.com/episode.jpg' }] }, episode: 2, time: 600, duration: 1200, updated: 1 },
      { anime: { ...anime, id: 99999 }, episode: 1, time: 1200, duration: 1200, updated: 1 },
    ] }));
  }, curated[0]);
  await page.route('https://example.com/episode.jpg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"/>' }));
  await page.goto('/');
  const row = page.getByRole('region', { name: 'Watching', exact: true });
  await expect(row.locator('.continue-card')).toHaveCount(1);
  await expect(row.getByText('10 minutes left')).toBeVisible();
  await expect(row.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  await expect(row.locator('img')).toHaveAttribute('src', 'https://example.com/episode.jpg');
  await expect(row.getByRole('link')).toHaveAttribute('href', `/watch/${curated[0].id}/2`);
  await expect(row.getByText('Episode title', { exact: true })).toHaveCount(0);
  await expect(row.locator('.poster-playback')).toContainText('Episode 2');
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const artwork = await row.locator('.continue-art').boundingBox();
    const bar = await row.getByRole('progressbar').boundingBox();
    if (!artwork || !bar) throw new Error('Missing artwork or progress bounds');
    expect(bar.y).toBeGreaterThanOrEqual(artwork.y);
    expect(bar.y + bar.height).toBeLessThanOrEqual(artwork.y + artwork.height + 1);
    expect(bar.x).toBeGreaterThanOrEqual(artwork.x);
    expect(bar.x + bar.width).toBeLessThanOrEqual(artwork.x + artwork.width + 1);
  }
  await page.evaluate(() => {
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = ((update: () => Promise<void>) => {
      const artwork = document.querySelector('.continue-card[data-player-transition="true"] .continue-art');
      const hero = document.querySelector('.home-hero');
      document.documentElement.dataset.cardSurface = artwork ? getComputedStyle(artwork).viewTransitionName : 'missing';
      document.documentElement.dataset.heroSurface = hero ? getComputedStyle(hero).viewTransitionName : 'missing';
      return start(update);
    }) as typeof document.startViewTransition;
  });
  await row.getByRole('link').click();
  await expect(page.locator('html')).toHaveAttribute('data-card-surface', 'playback-surface');
  await expect(page.locator('html')).toHaveAttribute('data-hero-surface', 'none');
  await expect(page.locator('.player-backdrop')).toHaveAttribute('src', 'https://example.com/episode.jpg');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/settings/appearance');
  await page.getByRole('link', { name: 'Customize home' }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

