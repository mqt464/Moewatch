import { normalizeAnime } from '../src/catalog';
import { test, expect } from '@playwright/test';

test.use({ reducedMotion: 'reduce' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0; localStorage.removeItem('moewatch.hero-history'); });
});

test('cached heroes show compact metadata chips and fractional five-star ratings', async ({ page }) => {
  await page.route('**/api/v1/**', route => route.abort());
  await page.goto('/');
  const metadata = page.locator('.hero .metadata');
  await expect(metadata.locator('.metadata-chip')).toHaveCount(5);
  await expect(metadata.getByText('2023', { exact: true })).toBeVisible();
  await expect(metadata.getByText('28 episodes', { exact: true })).toBeVisible();
  await expect(metadata.locator('.metadata-duration, .metadata-status, .metadata-favourites')).toHaveCount(0);
  await expect(metadata.getByRole('img', { name: 'Community rating: 4.5 out of 5 stars' })).toBeVisible();
  await expect(metadata.locator('.rating-star')).toHaveCount(5);
  expect(await metadata.locator('.rating-star-fill').evaluateAll(elements => elements.map(element => (element as HTMLElement).style.width))).toEqual(['100%', '100%', '100%', '100%', '50%']);
  await expect(metadata.locator('.metadata-popularity .sr-only')).toHaveText('Popularity: 499,746 AniList users');
  await expect(metadata).not.toContainText('/ 10');
  expect(await metadata.locator('.metadata-chip').first().evaluate(element => getComputedStyle(element).borderRadius)).toBe('3px');
  expect(await page.locator('.header').evaluate(element => getComputedStyle(element, '::before').backgroundImage)).toContain('rgba(0, 0, 0, 0.333)');
  const chip = await metadata.locator('.metadata-format').evaluate(element => ({ border: getComputedStyle(element).borderStyle, background: getComputedStyle(element).backgroundColor }));
  expect(chip.border).toBe('none');
  expect(chip.background).toBe('rgb(97, 69, 120)');
  const colors = await metadata.locator('.metadata-format, .metadata-episodes, .metadata-popularity, .metadata-rating').evaluateAll(elements => elements.map(element => getComputedStyle(element).color));
  expect(new Set(colors).size).toBe(4);
  await expect(page.locator('.hero-art')).toHaveClass(/is-ready/);
  await page.screenshot({ path: 'test-results/hero-chips-desktop.png', animations: 'disabled' });
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(page.getByRole('link', { name: 'Watch', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/hero-chips-mobile.png', animations: 'disabled' });
  await page.goto('/anime/1');
  await expect(page.locator('.detail-hero .metadata-rating')).toHaveAttribute('aria-label', 'Community rating: 4.3 out of 5 stars');
  await expect(page.locator('.detail-hero .metadata-popularity')).toBeVisible();
});

test('featured hero uses trending metadata and its real banner', async ({ page }) => {
  await page.route('**/api/v1/**', route => {
    if (!new URL(route.request().url()).pathname.endsWith('/catalog')) return route.abort();
    return route.fulfill({ json: { anime: [normalizeAnime({
      id: 154587, title: { english: 'Frieren: Beyond Journey’s End' }, startDate: { year: 2023 },
      format: 'TV', episodes: 28, duration: 24, status: 'FINISHED', averageScore: 83,
      description: 'A trending adventure.',
      popularity: 1234567, bannerImage: '/artwork/1-banner.jpg',
    })] } });
  });
  await page.goto('/');
  await expect(page.getByRole('img', { name: 'Community rating: 4.2 out of 5 stars', exact: true })).toBeVisible();
  await expect(page.locator('.hero')).toHaveCount(1);
  await expect(page.locator('.hero .metadata-rating')).toHaveAttribute('aria-label', 'Community rating: 4.2 out of 5 stars');
  await expect(page.locator('.hero .metadata-popularity .sr-only')).toHaveText('Popularity: 1,234,567 AniList users');
  await expect(page.locator('.hero-art')).toHaveAttribute('src', '/artwork/1-banner.jpg');
  await page.locator('.hero-actions').getByRole('link', { name: 'Details' }).click();
  await page.goBack();
  await expect(page.locator('.hero-art')).toHaveAttribute('src', '/artwork/1-banner.jpg');
});
