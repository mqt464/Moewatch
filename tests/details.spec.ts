import { test, expect } from '@playwright/test';
import { curated } from '../src/catalog';

test('series episode art, synopsis disclosure and range navigation work at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/**', route => new URL(route.request().url()).pathname.endsWith('/anime/154587')
    ? route.fulfill({ json: { anime: { ...curated[0], episodeArtwork: [{ number: 1, title: "The Journey's End", thumbnail: '/artwork/1-banner.jpg' }] } } }) : route.abort());
  await page.route('**/artwork/1-banner.jpg', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jqWQAAAAASUVORK5CYII=', 'base64') }));
  await page.goto('/anime/154587');
  await page.getByRole('button', { name: 'Series details' }).click();
  const toggle = page.getByRole('button', { name: 'Show more' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(page.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Show less' }).click();
  await expect(page.locator('.episode-row').first()).toContainText("The Journey's End");
  await expect(page.locator('.episode-image').first().locator('img')).toHaveAttribute('src', '/artwork/1-banner.jpg');
  await expect(page.locator('.episode-row').nth(1).locator('.episode-placeholder')).toBeVisible();
  await page.getByRole('combobox', { name: 'Episode range' }).selectOption('1');
  await expect(page.locator('.episode-row').first()).toHaveAttribute('href', '/watch/154587/25');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});



test('missing metadata thumbnails load the provider endpoint lazily and keep a fallback on error', async ({ page }) => {
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/anime/154587')) return route.fulfill({ json: { anime: { ...curated[0], episodeArtwork: [{ number: 1, title: 'First', thumbnail: '/episode-primary.png' }] } } });
    if (path.endsWith('/episodes/2/thumbnail')) return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jqWQAAAAASUVORK5CYII=', 'base64') });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.route('**/episode-primary.png', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jqWQAAAAASUVORK5CYII=', 'base64') }));
  await page.goto('/anime/154587');
  const second = page.locator('.episode-row').nth(1);
  await second.scrollIntoViewIfNeeded();
  await expect(second.locator('img')).toHaveAttribute('src', /\/episodes\/2\/thumbnail\?/);
  await expect(second.locator('img')).toHaveClass(/is-ready/);
  await expect(second.locator('img')).toHaveAttribute('loading', 'lazy');
  await expect(page.locator('.episode-row').nth(2).locator('.episode-placeholder')).toBeVisible();
});

test('long series titles keep both detail actions inside the hero at every breakpoint', async ({ page }) => {
  await page.route('**/api/v1/**', route => new URL(route.request().url()).pathname.endsWith('/anime/154587')
    ? route.fulfill({ json: { anime: { ...curated[0], title: 'That Time I Got Reincarnated as a Slime: The Slime Diaries Special Edition' } } }) : route.abort());
  for (const width of [390, 480, 481, 600, 601, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/anime/154587');
    await expect(page.locator('.detail-heading h1')).toContainText('Special Edition');
    const hero = await page.locator('.detail-hero').boundingBox();
    for (const selector of ['.hero-actions .button', '.hero-actions .list-status']) {
      const action = await page.locator(selector).boundingBox();
      expect(action!.y + action!.height, `${selector} clipped at ${width}px`).toBeLessThanOrEqual(hero!.y + hero!.height);
    }
  }
});
