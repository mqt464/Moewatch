import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', route => route.abort());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('group', { name: 'Featured carousel', exact: true })).toBeVisible();
});

test('document fades follow top, middle, and bottom without intercepting input', async ({ page }) => {
  const fades = page.locator('.document-scroll-fades');
  await expect(fades).toHaveAttribute('data-top', 'false');
  await expect(fades).toHaveAttribute('data-bottom', 'true');
  await expect(fades.locator('.scroll-fade-top')).toHaveCSS('opacity', '0');
  await expect(fades.locator('.scroll-fade-bottom')).toHaveCSS('opacity', '1');
  await expect(fades).toHaveCSS('pointer-events', 'none');
  await page.evaluate(() => window.scrollTo(0, 200));
  await expect(fades).toHaveAttribute('data-top', 'true');
  await expect(fades).toHaveAttribute('data-bottom', 'true');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(fades).toHaveAttribute('data-top', 'true');
  await expect(fades).toHaveAttribute('data-bottom', 'false');
  await expect(fades.locator('.scroll-fade-bottom')).toHaveCSS('opacity', '0');
});

test('horizontal rails fade only edges with more content', async ({ page }) => {
  const frame = page.locator('.scroll-frame').filter({ has: page.getByRole('group', { name: 'Featured carousel', exact: true }) });
  const rail = frame.locator('.carousel-rail');
  const fades = frame.locator('.scroll-fades');
  await expect(fades).toHaveAttribute('data-left', 'false');
  await expect(fades).toHaveAttribute('data-right', 'true');
  await expect(fades).toHaveAttribute('data-top', 'false');
  await expect(fades).toHaveAttribute('data-bottom', 'false');
  await rail.evaluate(element => { element.style.scrollSnapType = 'none'; element.scrollLeft = 100; });
  await expect(fades).toHaveAttribute('data-left', 'true');
  await expect(fades).toHaveAttribute('data-right', 'true');
  await rail.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect(fades).toHaveAttribute('data-right', 'false');
  await expect(fades.locator('.scroll-fade-right')).toHaveCSS('opacity', '0');
  await rail.evaluate(element => { while (element.children.length > 1) element.lastElementChild!.remove(); });
  await expect(fades).toHaveAttribute('data-left', 'false');
  await expect(fades).toHaveAttribute('data-right', 'false');
});

test('reusable area adapts vertical fades to scrolling, resizing, and content changes', async ({ page }) => {
  const frame = page.locator('.scroll-frame').filter({ has: page.getByRole('group', { name: 'Featured carousel', exact: true }) });
  const rail = frame.locator('.carousel-rail');
  const fades = frame.locator('.scroll-fades');
  await rail.evaluate(element => {
    element.style.cssText = 'display: block; height: 150px; scroll-snap-type: none';
  });
  await expect(fades).toHaveAttribute('data-top', 'false');
  await expect(fades).toHaveAttribute('data-bottom', 'true');
  await rail.evaluate(element => { element.scrollTop = 100; });
  await expect(fades).toHaveAttribute('data-top', 'true');
  await expect(fades).toHaveAttribute('data-bottom', 'true');
  await rail.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(fades).toHaveAttribute('data-bottom', 'false');
  await rail.evaluate(element => {
    const content = document.createElement('div');
    content.style.height = '300px';
    element.append(content);
  });
  await expect(fades).toHaveAttribute('data-bottom', 'true');
  await rail.evaluate(element => { element.style.height = `${element.scrollHeight + 100}px`; });
  await expect(fades).toHaveAttribute('data-top', 'false');
  await expect(fades).toHaveAttribute('data-bottom', 'false');
});

test('no document overflow means no fades, including after content changes', async ({ page }) => {
  await page.addStyleTag({ content: 'main, .header, .footer { display: none !important; }' });
  const fades = page.locator('.document-scroll-fades');
  await expect(fades).toHaveAttribute('data-top', 'false');
  await expect(fades).toHaveAttribute('data-bottom', 'false');
  await page.evaluate(() => {
    const content = document.createElement('div');
    content.id = 'scroll-content-fixture';
    content.style.height = '2000px';
    document.body.append(content);
  });
  await expect(fades).toHaveAttribute('data-bottom', 'true');
  await page.locator('#scroll-content-fixture').evaluate(element => element.remove());
  await expect(fades).toHaveAttribute('data-bottom', 'false');
});

test('mobile settings navigation uses the same adaptive fades', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/settings');
  const frame = page.locator('.settings-sidebar .scroll-frame');
  const viewport = frame.locator('.scroll-area');
  const fades = frame.locator('.scroll-fades');
  await expect(fades).toHaveAttribute('data-left', 'false');
  await expect(fades).toHaveAttribute('data-right', 'true');
  await viewport.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect(fades).toHaveAttribute('data-left', 'true');
  await expect(fades).toHaveAttribute('data-right', 'false');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(fades).toHaveAttribute('data-left', 'false');
  await expect(fades).toHaveAttribute('data-right', 'false');
});

test('fades respect reduced motion and forced colors', async ({ page }) => {
  const fades = page.locator('.document-scroll-fades');
  await expect(fades.locator('.scroll-fade-bottom')).toHaveCSS('transition-duration', '0s');
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(fades).toHaveCSS('display', 'none');
  await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'no-preference' });
  await expect(fades).not.toHaveCSS('display', 'none');
  await expect(fades.locator('.scroll-fade-bottom')).not.toHaveCSS('transition-duration', '0s');
  await page.evaluate(() => { document.documentElement.dataset.reduceMotion = 'true'; });
  await expect(fades.locator('.scroll-fade-bottom')).toHaveCSS('transition-duration', '0s');
});



