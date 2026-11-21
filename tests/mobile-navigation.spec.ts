import { test, expect } from '@playwright/test';

test.use({ browserName: process.env.MOBILE_BROWSER === 'webkit' ? 'webkit' : 'chromium', hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
test.describe('touch navigation', () => {
  test.beforeEach(async ({ page }) => {
   await page.route('**/api/v1/**', route => route.abort());
   await page.route('https://s4.anilist.co/**', route => route.fulfill({ path: 'public/pwa-192.png', contentType: 'image/png' }));
  });
  for (const route of ['/', '/browse']) {
   test(`one poster tap opens details from ${route}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(route);
    const poster = page.locator('.poster-link').first();
    await expect(poster).toBeVisible();
    await expect(poster.locator('img')).toHaveAttribute('draggable', 'false');
    const href = await poster.getAttribute('href');
    await poster.locator('.poster-image').tap();
    await expect(page).toHaveURL(href!);
    await expect(page.getByRole('tab', { name: /Episodes/ })).toBeVisible();
    expect(errors).toEqual([]);
   });
  }
 });

test('header navigation accepts each first tap', async ({ page }) => {
 await page.route('**/api/v1/**', route => route.abort());
 await page.addInitScript(() => {
  const start = document.startViewTransition?.bind(document);
  (window as any).touchTransitions = 0;
  if (start) document.startViewTransition = ((...args: any[]) => { (window as any).touchTransitions++; return (start as any)(...args); }) as typeof document.startViewTransition;
 });
 await page.goto('/');
 const nav = page.getByRole('navigation', { name: 'Main navigation' });
 for (const [label, path] of [['Search', '/browse'], ['My List', '/list'], ['Discover', '/'], ['My List', '/list'], ['Search', '/browse']] as const) {
  await nav.getByRole('link', { name: label, exact: true }).tap();
  await expect(page).toHaveURL(path);
 }
 expect(await page.evaluate(() => (window as any).touchTransitions)).toBe(0);
});

test('loading cards never widen the mobile viewport', async ({ page }) => {
 await page.route('**/api/v1/catalog**', () => {});
 await page.route('https://s4.anilist.co/**', () => {});
 await page.goto('/');
 await expect(page.locator('.header')).toBeVisible();
 const widths = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
 expect(widths.page).toBeLessThanOrEqual(widths.viewport);
 expect(widths.body).toBeLessThanOrEqual(widths.viewport);
});
