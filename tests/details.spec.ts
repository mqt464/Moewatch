import { test, expect } from '@playwright/test';
import { curated } from '../src/catalog';

test('episode playback shows completed earlier episodes and highlights only the current episode', async ({ page }) => {
  await page.addInitScript(anime => localStorage.setItem('moewatch-library-v1', JSON.stringify({ saved: [], progress: [{ anime, episode: 3, time: 600, duration: 1440, updated: Date.now() }] })), curated[0]);
  await page.route('**/api/v1/**', route => new URL(route.request().url()).pathname.endsWith('/anime/154587')
    ? route.fulfill({ json: { anime: curated[0] } }) : route.abort());
  await page.goto('/anime/154587');
  await expect(page.getByRole('progressbar', { name: 'Episode 1 progress', exact: true })).toHaveAttribute('aria-valuenow', '100');
  await expect(page.getByRole('progressbar', { name: 'Episode 2 progress', exact: true })).toHaveAttribute('aria-valuenow', '100');
  await expect(page.getByRole('progressbar', { name: 'Episode 3 progress', exact: true })).toHaveAttribute('aria-valuenow', '42');
  await expect(page.getByRole('progressbar', { name: 'Episode 4 progress', exact: true })).toHaveAttribute('aria-valuenow', '0');
  const current = page.locator('.episode-row[aria-current=true]');
  await expect(current).toHaveCount(1);
  await expect(current).toContainText('14 min left');
  await expect(page.locator('.episode-row').first().locator('.episode-time')).toHaveText(curated[0].duration + ' min');
  await expect(page.getByText('In progress', { exact: true })).toHaveCount(0);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const metadata = await current.locator('.episode-playback p').boundingBox();
    const bar = await current.getByRole('progressbar').boundingBox();
    const thumbnail = await current.locator('.episode-image').boundingBox();
    expect(metadata!.y + metadata!.height).toBeLessThanOrEqual(bar!.y);
    expect(metadata!.y).toBeGreaterThanOrEqual(thumbnail!.y);
    expect(bar!.y + bar!.height).toBeLessThanOrEqual(thumbnail!.y + thumbnail!.height);
    await expect(current.locator('.episode-time')).toBeVisible();
  }
});

test('series episode art, synopsis disclosure and range navigation work at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/**', route => new URL(route.request().url()).pathname.endsWith('/anime/154587')
    ? route.fulfill({ json: { anime: { ...curated[0], episodeArtwork: [{ number: 1, title: "The Journey's End", thumbnail: '/artwork/1-banner.jpg' }] } } }) : route.abort());
  await page.route('**/artwork/1-banner.jpg', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jqWQAAAAASUVORK5CYII=', 'base64') }));
  await page.goto('/anime/154587');
  await page.getByRole('button', { name: 'Synopsis' }).click();
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

test('detail actions sit between the hero and synopsis at every breakpoint', async ({ page }) => {
  await page.route('**/api/v1/**', route => new URL(route.request().url()).pathname.endsWith('/anime/154587')
    ? route.fulfill({ json: { anime: { ...curated[0], title: 'That Time I Got Reincarnated as a Slime: The Slime Diaries Special Edition' } } }) : route.abort());
  for (const width of [390, 480, 481, 600, 601, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/anime/154587');
    await expect(page.locator('.detail-heading h1')).toContainText('Special Edition');
    const hero = await page.locator('.detail-hero').boundingBox();
    const actions = await page.locator('.detail-actions').boundingBox();
    const synopsis = await page.locator('.series-facts').boundingBox();
    expect(actions!.y).toBeGreaterThanOrEqual(hero!.y + hero!.height);
    expect(actions!.y + actions!.height).toBeLessThanOrEqual(synopsis!.y);
    for (const selector of ['.hero-actions > .button', '.hero-actions .list-status', '.hero-actions .series-download']) {
      for (const element of await page.locator(selector).all()) {
        const action = await element.boundingBox();
        expect(action!.y + action!.height, `${selector} clipped at ${width}px`).toBeLessThanOrEqual(actions!.y + actions!.height);
        expect(action!.x + action!.width).toBeLessThanOrEqual(width);
      }
    }
  }
});

test('hero has plain genre links and a release status chip', async ({ page }) => {
  await page.route('**/api/v1/**', route => new URL(route.request().url()).pathname.endsWith('/anime/154587')
    ? route.fulfill({ json: { anime: { ...curated[0], status: 'RELEASING' } } }) : route.abort());
  await page.goto('/anime/154587');
  const hero = page.locator('.detail-heading');
  await expect(hero.locator('.metadata-status')).toHaveText('Airing');
  expect(await hero.locator('.metadata > div').evaluateAll(rows => rows.map(row => Array.from(row.children, chip => chip.className)))).toEqual([
    ['metadata-chip metadata-status', 'metadata-chip metadata-rating', 'metadata-chip metadata-popularity'],
    ['metadata-chip metadata-format', 'metadata-chip metadata-episodes', 'metadata-chip metadata-year'],
  ]);
  await expect(hero.locator('.series-production, .score-distribution')).toHaveCount(0);
  await expect(hero).not.toContainText('min per episode');
  await expect(page.locator('.series-facts dl')).toHaveCount(0);
  const genre = curated[0].genres[0];
  const link = hero.getByRole('link', { name: genre, exact: true });
  const style = await link.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, border: getComputedStyle(element).borderWidth }));
  expect(style).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '0px' });
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const genres = await hero.locator('.series-genres').boundingBox();
    const chips = await hero.locator('.metadata').boundingBox();
    const chip = await hero.locator('.metadata-year').boundingBox();
    expect(genres!.y + genres!.height).toBeLessThanOrEqual(chips!.y);
    expect(chips!.y - genres!.y - genres!.height).toBeLessThanOrEqual(12);
    expect(chip!.height).toBeLessThanOrEqual(30);
  }
  await link.click();
  await expect(page).toHaveURL('/browse?' + new URLSearchParams({ genre }));
  await expect(page.getByRole('button', { name: genre, exact: true })).toHaveAttribute('aria-pressed', 'true');
});
