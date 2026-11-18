import { test, expect } from '@playwright/test';

test('document scrollbar overlays content without reserving a gutter', async ({ page }) => {
  await page.route('**/api/v1/**', route => route.abort());
  await page.goto('/');
  expect(await page.evaluate(() => innerWidth - document.documentElement.clientWidth)).toBe(0);
  await expect(page.locator('html')).toHaveCSS('scrollbar-width', 'none');
  const scrollbar = page.getByRole('scrollbar', { name: 'Page scroll' });
  await expect(scrollbar).toBeVisible();
  const bounds = await scrollbar.boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2 + 100);
  await page.mouse.up();
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await scrollbar.focus();
  await page.keyboard.press('End');
  await expect.poll(() => page.evaluate(() => Math.abs(scrollY + innerHeight - document.documentElement.scrollHeight))).toBeLessThan(2);
});

test('forced colors restore the document native scrollbar', async ({ page }) => {
  await page.route('**/api/v1/**', route => route.abort());
  await page.goto('/');
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(page.locator('html')).toHaveCSS('scrollbar-width', 'auto');
  await expect(page.getByRole('scrollbar', { name: 'Page scroll' })).toBeHidden();
});
