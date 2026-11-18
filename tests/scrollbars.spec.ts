import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', route => route.abort());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('group', { name: 'Featured carousel', exact: true })).toBeVisible();
});

test('Rei scrollbars cover document, carousels, dialogs, and new scroll containers', async ({ page }) => {
  await page.evaluate(() => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Scrollbar test dialog');
    document.body.append(dialog);
    dialog.showModal();
    const textarea = document.createElement('textarea');
    textarea.setAttribute('aria-label', 'Scrollbar fixture');
    textarea.value = 'Scrollable content\n'.repeat(50);
    dialog.append(textarea);
  });
  for (const selector of ['html', '.carousel-rail', 'dialog', 'textarea']) {
    const styles = await page.locator(selector).first().evaluate(element => ({
      width: getComputedStyle(element, '::-webkit-scrollbar').width,
      height: getComputedStyle(element, '::-webkit-scrollbar').height,
      buttons: getComputedStyle(element, '::-webkit-scrollbar-button').display,
      thumb: getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor,
      radius: getComputedStyle(element, '::-webkit-scrollbar-thumb').borderRadius,
      nativeWidth: getComputedStyle(element).scrollbarWidth,
      nativeColor: getComputedStyle(element).scrollbarColor,
    }));
    expect(styles).toEqual({ width: selector === 'html' ? '0px' : '6px', height: selector === 'html' ? '0px' : '6px', buttons: 'none', thumb: 'color(srgb 0.643137 0.627451 0.643137 / 0.6)', radius: '999px', nativeWidth: selector === 'html' ? 'none' : 'auto', nativeColor: 'auto' });
  }
});

test('document and horizontal rail highlight independently, then return to their resting state', async ({ page }) => {
  await page.mouse.move(300, 300);
  await page.clock.install();
  await page.evaluate(() => window.scrollTo(0, 200));
  await expect(page.locator('html')).toHaveAttribute('data-rei-scrollbar-active', '');
  const rail = page.locator('.carousel-rail').first();
  await expect(rail).not.toHaveAttribute('data-rei-scrollbar-active');
  await page.clock.fastForward(1000);
  await rail.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect(rail).toHaveAttribute('data-rei-scrollbar-active', '');
  expect(await rail.evaluate(element => getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await page.clock.fastForward(1100);
  await expect(page.locator('html')).not.toHaveAttribute('data-rei-scrollbar-active');
  await expect(rail).toHaveAttribute('data-rei-scrollbar-active', '');
  await page.clock.fastForward(1000);
  await expect(rail).not.toHaveAttribute('data-rei-scrollbar-active');
});

test('edge hover reveals scrollbar and dragging keeps it visible', async ({ page }) => {
  await page.clock.install();
  await page.mouse.move(1438, 400);
  await expect(page.locator('html')).toHaveAttribute('data-rei-scrollbar-active', '');
  await page.mouse.down();
  await page.clock.fastForward(4100);
  await expect(page.locator('html')).toHaveAttribute('data-rei-scrollbar-active', '');
  await page.mouse.up();
  await page.mouse.move(300, 300);
  await page.clock.fastForward(2100);
  await expect(page.locator('html')).not.toHaveAttribute('data-rei-scrollbar-active');
});

test('short dialogs use the same scrollbar without scrolling the page', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 240 });
  await page.evaluate(() => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Scrollbar test dialog');
    dialog.style.cssText = 'height: 100px; width: 300px; overflow: auto';
    const content = document.createElement('div');
    content.style.height = '500px';
    dialog.append(content);
    document.body.append(dialog);
    dialog.showModal();
  });
  const dialog = page.getByRole('dialog');
  expect(await dialog.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  const pageTop = await page.evaluate(() => window.scrollY);
  await dialog.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(dialog).toHaveAttribute('data-rei-scrollbar-active', '');
  expect(await page.evaluate(() => window.scrollY)).toBe(pageTop);
});

test('forced colors retain native accessible scrollbars', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  const styles = await page.locator('.carousel-rail').first().evaluate(element => ({
    width: getComputedStyle(element, '::-webkit-scrollbar').width,
    nativeWidth: getComputedStyle(element).scrollbarWidth,
    color: getComputedStyle(element).scrollbarColor,
    forcedColors: matchMedia('(forced-colors: active)').matches,
  }));
  expect(styles.forcedColors).toBe(true);
  expect(['', 'auto']).toContain(styles.width);
  expect(styles.nativeWidth).toBe('auto');
  expect(styles.color).toBe('auto');
});



