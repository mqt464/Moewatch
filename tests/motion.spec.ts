import { test, expect } from '@playwright/test';
import { curated } from '../src/catalog';
test.beforeEach(async ({ page }) => { await page.route('**/api/v1/**', route => route.abort()); });
for (const reduced of ['none', 'app', 'os']) test('carousel scroll source: ' + reduced, async ({ page }) => {
 await page.addInitScript(reduce => {
  localStorage.setItem('moewatch-settings-v1', JSON.stringify({ reduceMotion: reduce === 'app' }));
  Element.prototype.scrollBy = function(options) { document.documentElement.dataset.scrollBehavior = typeof options === 'object' ? options.behavior : ''; };
 }, reduced);
 await page.emulateMedia({ reducedMotion: reduced === 'os' ? 'reduce' : 'no-preference' });
 await page.goto('/');
 const next = page.getByRole('button', { name: /^Next / }).first();
 await next.click();
 await expect(page.locator('html')).toHaveAttribute('data-scroll-behavior', reduced === 'none' ? 'smooth' : 'instant');
 const rail = page.locator('.carousel-rail').first();
 await rail.press('ArrowRight');
 await expect(page.locator('html')).toHaveAttribute('data-scroll-behavior', 'instant');
});
test('profile pointer reversal keeps its node and keyboard dismissal is immediate', async ({ page }) => {
 await page.goto('/');
 const trigger = page.getByRole('button', { name: 'Profile menu' });
 await trigger.click();
 const menu = page.locator('.profile-menu');
 await expect(menu).toHaveCSS('transition-property', 'opacity, transform');
 await page.evaluate(() => {
  const trigger = document.querySelector<HTMLButtonElement>('.profile-button');
  trigger?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); trigger?.click();
 });
 await expect(menu).toHaveAttribute('inert', '');
 await trigger.click({ force: true });
 await expect(menu).toHaveAttribute('data-open', 'true');
 await expect(menu).toHaveCSS('opacity', '1');
 await page.keyboard.press('Escape');
 await expect(menu).toHaveCount(0);
 await trigger.press('Enter');
 await expect(menu).toHaveCSS('transition-duration', '0s');
});
test('mobile facts reverse, stay inert collapsed and restore desktop geometry', async ({ page }) => {
 await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/anime/154587');
 const facts = page.locator('#series-facts'); const toggle = page.getByRole('button', { name: 'Series details' });
 await expect(facts).toHaveAttribute('inert', '');
 await toggle.click(); await expect(facts).toHaveAttribute('data-open', 'true');
 await toggle.click(); await expect(facts).toHaveAttribute('inert', '');
 await toggle.click(); await expect(facts).not.toHaveAttribute('inert', '');
 await toggle.press('Enter'); await expect(facts).toHaveCSS('height', '0px');
 await page.setViewportSize({ width: 1440, height: 1000 }); await expect(facts).not.toHaveAttribute('inert', '');
 expect((await facts.boundingBox())!.height).toBeGreaterThan(0);
});
test('removal toast supports Undo and replacement during exit', async ({ page }) => {
 await page.addInitScript(titles => localStorage.setItem('moewatch-library-v1', JSON.stringify({ saved: titles, progress: [] })), curated.slice(0, 2));
 await page.goto('/list');
 await page.getByRole('combobox', { name: 'List status for ' + curated[0].title, exact: true }).selectOption('');
 const toast = page.locator('.undo-toast'); await expect(toast).toHaveAttribute('data-open', 'true');
 await toast.getByRole('button', { name: 'Undo', exact: true }).click();
 await expect(page.locator('.saved-poster')).toHaveCount(2);
 await expect(toast).toHaveAttribute('inert', '');
 await page.getByRole('combobox', { name: 'List status for ' + curated[1].title, exact: true }).selectOption('');
 await expect(toast).toHaveAttribute('data-open', 'true');
 await toast.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(page.locator('.saved-poster')).toHaveCount(2);
 await expect(toast).toHaveCount(0);
});

