import { test, expect } from '@playwright/test';

test('scrollbars are visible at rest and edge overlays do not paint black strips', async ({ page }) => {
  await page.route('**/api/v1/**', route => route.abort());
  await page.goto('/');
  const rail = page.locator('.carousel-rail').first();
  await expect(rail).toBeVisible();
  await page.mouse.move(300, 300);
  await expect(rail).not.toHaveAttribute('data-rei-scrollbar-active');
  const thumb = await rail.evaluate(element => getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor);
  expect(thumb).not.toBe('rgba(0, 0, 0, 0)');
  for (const background of await page.locator('.scroll-fades > span').evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundImage))) {
    expect(background).not.toContain('rgb(0, 0, 0)');
  }
});

