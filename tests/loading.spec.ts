import { normalizeAnime } from '../src/catalog';
import { test, expect } from '@playwright/test';
import { preferencesKey } from '../src/preferences';

const media = {
  id: 900101,
  title: { english: 'Loaded anime' },
  coverImage: { large: '/artwork/1-cover.jpg' },
  bannerImage: '/artwork/1-banner.jpg',
  startDate: { year: 2026 },
  episodes: 12,
  duration: 24,
};

test.use({ reducedMotion: 'reduce' });

test('initial search paints a measured, inert skeleton before metadata arrives', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/**', async route => {
    await gate;
    await route.fulfill({ json: { anime: [normalizeAnime(media)] } });
  });
  await page.goto('/browse');
  await expect(page.getByRole('searchbox')).toBeEnabled();
  const skeleton = page.locator('.search-results [skullet-loading]').first();
  await expect(skeleton).toHaveAttribute('inert', '');
  await expect(skeleton).toHaveAttribute('aria-hidden', 'true');
  await expect(skeleton.locator('[skullet-rect]').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Frieren/ })).toHaveCount(0);
  release();
  await expect(page.locator('.search-results')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('heading', { name: 'Loaded anime' })).toBeVisible();
  await expect(page.locator('.search-results [skullet-loading]')).toHaveCount(0);
});

test('home rows reveal independently instead of waiting for every request', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/**', async route => {
    if (new URL(route.request().url()).searchParams.has('genre')) await gate;
    await route.fulfill({ json: { anime: [normalizeAnime(media)] } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Trending', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Loaded anime' })).toBeVisible();
  await expect(page.locator('.home-content > [skullet-reveal][aria-busy="true"]')).toHaveCount(3);
  release();
  await expect(page.locator('.home-content > [skullet-reveal][aria-busy="true"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Action', exact: true })).toBeVisible();
});

for (const [path, label] of [['/anime/900101', 'Loading series'], ['/watch/900101/1', 'Loading episode']]) {
  test(`${path} shows its real layout skeleton and recovers from failure`, async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/v1/**', async route => { await gate; await route.abort(); });
    await page.goto(path);
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    await expect(page.locator('main [skullet-loading] [skullet-rect]').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /My List/ })).toHaveCount(0);
    await expect(page.locator('.loading-state, .spinner')).toHaveCount(0);
    release();
    await expect(page.getByRole('heading', { name: /Unable to load/ })).toBeVisible();
    await page.route('**/api/v1/**', route => route.fulfill({ json: { anime: normalizeAnime(media) } }));
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Loaded anime', exact: true })).toBeVisible();
  });
}

test('slow artwork skeleton does not hold back titles or navigation', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/**', route => route.abort());
  await page.route('**/artwork/154587-cover.jpg', async route => { await gate; await route.continue(); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const poster = page.locator('.catalog-row').first().locator('.poster').first();
  await expect(poster.getByRole('heading')).toBeVisible();
  await expect(poster.locator('.artwork-loading[skullet-bar]')).toBeVisible();
  await expect(poster.getByRole('link')).toBeEnabled();
  const before = await poster.locator('.poster-image').boundingBox();
  release();
  await expect(poster.locator('img')).toHaveClass(/is-ready/);
  await expect(poster.locator('.artwork-loading')).toHaveCount(0);
  expect(await poster.locator('.poster-image').boundingBox()).toEqual(before);
});

test('video buffering uses a Skullet overlay without replacing the player', async ({ page }) => {
  await page.route('**/api/v1/**', route => route.abort());
  await page.goto('/watch/154587/1');
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const context = canvas.getContext('2d')!;
    const stream = canvas.captureStream(12);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    const completed = new Promise<Blob>(resolve => {
      recorder.ondataavailable = event => chunks.push(event.data);
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
    });
    recorder.start();
    for (let frame = 0; frame < 4; frame++) {
      context.fillStyle = frame % 2 ? '#e7a0b4' : '#171114';
      context.fillRect(0, 0, 160, 90);
      await new Promise(resolve => setTimeout(resolve, 90));
    }
    recorder.stop();
    const blob = await completed;
    stream.getTracks().forEach(track => track.stop());
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByLabel('Choose a local video').setInputFiles({ name: 'loading-test.webm', mimeType: 'video/webm', buffer: Buffer.from(bytes) });
  const player = page.locator('video');
  await expect.poll(() => player.evaluate(video => (video as HTMLVideoElement).readyState)).toBe(4);
  const original = await player.elementHandle();
  await player.dispatchEvent('waiting');
  await expect(page.getByRole('status', { name: 'Loading video', exact: true })).toBeVisible();
  await expect(page.locator('.player-loading [skullet-bar]')).toBeVisible();
  expect(await original!.evaluate(video => video.isConnected)).toBe(true);
  await expect(player).toHaveJSProperty('controls', true);
  await player.dispatchEvent('canplay');
  await expect(page.locator('.player-loading')).toHaveCount(0);
  await page.getByLabel('Choose a local video').setInputFiles({ name: 'broken.webm', mimeType: 'video/webm', buffer: Buffer.from('not a video') });
  await expect(page.getByRole('alert')).toContainText('This browser cannot play this source.');
  await expect(page.locator('.player-loading')).toHaveCount(0);
});

test('Settings reduced motion also disables Skullet animations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(key => localStorage.setItem(key, JSON.stringify({ reduceMotion: true })), preferencesKey);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/**', async route => { await gate; await route.abort(); });
  await page.goto('/browse');
  const rect = page.locator('.search-results [skullet-rect]').first();
  await expect(rect).toBeVisible();
  expect(await rect.evaluate(element => element.getAnimations().length)).toBe(0);
  release();
  await expect(page.locator('.search-results')).toHaveAttribute('aria-busy', 'false');
});
