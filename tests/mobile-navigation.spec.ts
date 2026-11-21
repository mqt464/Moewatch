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
