import { normalizeAnime } from '../src/catalog';
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', route => route.abort());
});

test('search retains existing cards and heading while refreshing, then opens cached metadata', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/**', async route => {
    if (new URL(route.request().url()).searchParams.get('search') !== 'New title') return route.abort();
    await gate;
    return route.fulfill({ json: { anime: [normalizeAnime({ id: 900002, title: { english: 'New title' }, coverImage: { large: '/artwork/1-cover.jpg' }, bannerImage: '/artwork/1-banner.jpg', startDate: { year: 2026 } })] } });
  });
  await page.goto('/browse');
  await expect(page.locator('.poster')).toHaveCount(8);
  await page.getByRole('searchbox').fill('New title');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('.search-results')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.poster')).toHaveCount(8);
  await expect(page.locator('.results-heading h2')).toHaveText('Anime');
  await expect(page.locator('.poster-skeleton')).toHaveCount(0);
  release();
  await expect(page.locator('.search-results')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.poster')).toHaveCount(1);
  await expect(page.locator('.poster p')).toHaveText('2026');
  await page.locator('.poster-link').click();
  await expect(page.getByRole('heading', { name: 'New title', level: 1 })).toBeVisible();
  await expect(page.locator('.loading-state')).toHaveCount(0);
});

test('poster loading and failure keep the same footprint without extra metadata', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/artwork/154587-cover.jpg', async route => { await gate; await route.continue(); });
  await page.route('**/artwork/1-cover.jpg', route => route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const featured = page.locator('.catalog-row').first();
  const poster = featured.locator('.poster-image').first();
  const image = poster.locator('img');
  await expect(image).toHaveClass(/is-loading/);
  const before = await poster.boundingBox();
  release();
  await expect(image).toHaveClass(/is-ready/);
  expect(await poster.boundingBox()).toEqual(before);
  await expect(featured.locator('.poster p')).toHaveCount(0);
  await expect(featured.locator('.poster-image .art-fallback')).toHaveCount(1);
});

test('series and watch navigation run short native transitions without runtime errors', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const state = window as typeof window & { motion: { started: number; ready: number; finished: number; errors: string[] } };
    state.motion = { started: 0, ready: 0, finished: 0, errors: [] };
    const original = document.startViewTransition.bind(document);
    document.startViewTransition = (...args) => {
      state.motion.started++;
      const transition = original(...args);
      transition.ready.then(() => { state.motion.ready++; }).catch(error => { state.motion.errors.push(String(error)); });
      transition.finished.then(() => { state.motion.finished++; });
      return transition;
    };
  });
  await page.goto('/');
  await page.locator('.hero-actions').getByRole('link', { name: 'Details' }).click();
  await expect(page).toHaveURL('/anime/154587');
  await expect.poll(() => page.evaluate(() => (window as any).motion.finished)).toBe(1);
  await page.getByRole('link', { name: 'Watch episode 1', exact: true }).click();
  await expect(page).toHaveURL('/watch/154587/1');
  await expect.poll(() => page.evaluate(() => (window as any).motion.finished)).toBe(2);
  await page.goBack();
  await expect(page.getByRole('tab', { name: /Episodes/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).motion.finished)).toBe(3);
  expect(await page.evaluate(() => (window as any).motion)).toEqual({ started: 3, ready: 3, finished: 3, errors: [] });
  expect(await page.locator('.page-scene').evaluate(element => getComputedStyle(element, '::view-transition-new(page)').animationDuration)).toBe('0.22s');
  expect(errors).toEqual([]);
});

test('reduced motion skips navigation animations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    document.startViewTransition = () => { throw new Error('Reduced motion must skip transitions'); };
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('.hero-actions').getByRole('link', { name: 'Watch', exact: true }).click();
  await expect(page).toHaveURL('/watch/154587/1');
  await expect(page.getByText('No video source', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await expect(page.locator('.page-scene')).toHaveCSS('animation-name', 'none');
});

test('browsers without native transitions retain working navigation and a short fallback', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => { Object.defineProperty(document, 'startViewTransition', { value: undefined }); });
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/no-view-transitions/);
  await page.locator('.hero-actions').getByRole('link', { name: 'Details' }).click();
  await expect(page.getByRole('tab', { name: /Episodes/ })).toBeVisible();
  await expect(page.locator('.page-scene')).toHaveCSS('animation-duration', '0.16s');
});

test('hero framing changes per title and viewport without horizontal overflow', async ({ page }) => {
  await page.goto('/anime/1');
  await expect(page.locator('.hero-art')).toHaveCSS('object-position', '52% 40%');
  await expect(page.locator('.hero-art')).toHaveClass(/is-ready/);
  await page.screenshot({ path: 'test-results/cowboy-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(page.locator('.hero-art')).toHaveCSS('object-position', '56% 42%');
  await page.screenshot({ path: 'test-results/cowboy-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/anime/161645');
  await expect(page.locator('.hero-art')).toHaveCSS('object-position', '54% 35%');
});
