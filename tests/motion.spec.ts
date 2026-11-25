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
 const facts = page.locator('#series-facts'); const toggle = page.getByRole('button', { name: 'Synopsis', exact: true });
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

test('keyboard navigation stays instant after pointer interaction', async ({ page }) => {
 await page.addInitScript(() => {
  const original = document.startViewTransition.bind(document);
  document.startViewTransition = (...args) => {
   document.documentElement.dataset.transitionStarted = 'true';
   return original(...args);
  };
 });
 await page.goto('/anime/154587');
 await page.getByRole('tab', { name: 'Characters', exact: true }).click();
 await page.locator('.series-genres a').first().focus();
 await page.keyboard.press('Enter');
 await expect(page).toHaveURL(/\/browse\?genre=/);
 await expect(page.locator('html')).not.toHaveAttribute('data-transition-started', 'true');
 await expect(page.locator('.page-scene')).toHaveCSS('animation-name', 'none');
});

for (const reduced of [false, true]) test('episode press feedback, reduced motion: ' + reduced, async ({ page }) => {
 await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
 await page.goto('/anime/154587');
 const link = page.locator('.episode-row').first();
 await link.scrollIntoViewIfNeeded();
 const image = link.locator('.episode-image');
 await image.hover();
 await page.mouse.down();
 if (reduced) await expect(image).toHaveCSS('transform', 'none');
 else await expect(image).not.toHaveCSS('transform', 'none');
 await page.mouse.move(0, 0);
 await page.mouse.up();
 await expect(image).toHaveCSS('transform', 'none');
});

for (const input of ['pointer', 'keyboard', 'reduced']) test('reply fade respects input: ' + input, async ({ page }) => {
 await page.emulateMedia({ reducedMotion: input === 'reduced' ? 'reduce' : 'no-preference' });
 await page.route('**/api/v1/discussions/**', route => {
  const replies = new URL(route.request().url()).searchParams.has('thread');
  return route.fulfill({ json: { Page: { pageInfo: { hasNextPage: false }, ...(replies
   ? { threadComments: [{ id: 2, comment: 'A loaded reply', createdAt: 1, user: null, likeCount: 0, isLiked: false }] }
   : { threads: [{ id: 1, title: 'Test discussion', body: 'A discussion', replyCount: 1, createdAt: 1, user: null, likeCount: 0, isLiked: false, isLocked: false }] }) } } });
 });
 await page.goto('/anime/154587');
 await page.getByRole('tab', { name: 'Discussions', exact: true }).click();
 const toggle = page.getByRole('button', { name: '1 reply', exact: true });
 if (input === 'keyboard') await toggle.press('Enter'); else await toggle.click();
 await expect(page.getByText('A loaded reply', { exact: true })).toBeVisible();
 const content = page.locator('.discussion-children > .discussion-reveal');
 await expect(content).toHaveCSS('transition-duration', input === 'keyboard' ? '0s' : input === 'reduced' ? '0.12s' : '0.15s');
 await expect(content).toHaveCSS('transition-property', input === 'keyboard' ? 'none' : 'opacity');
 await expect(content).toHaveCSS('transform', 'none');
 await page.getByRole('button', { name: 'Hide replies', exact: true }).press('Enter');
 await expect(page.getByText('A loaded reply', { exact: true })).not.toBeVisible();
});

