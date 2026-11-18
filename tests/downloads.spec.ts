import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { curated } from '../src/catalog';
import type { DownloadSeries, DownloadsResponse } from '../shared/downloads';

const anime = { ...curated[0], cover: '/favicon.png', banner: '/favicon.png', episodeArtwork: [{ number: 1, title: 'The journey', thumbnail: '/favicon.png' }] };
const id = '11111111-1111-4111-8111-111111111111';
const media = readFileSync('tests/fixtures/player-flower.mp4');
const download: DownloadSeries = { id, anime, audio: 'sub', quality: 720, provider: 'auto', fallback: true, created: 1, bytesPerSecond: 2097152, remainingSeconds: 90, episodes: [1, 2].map(number => ({ number, status: 'downloading', progress: .25, bytes: 1024 })) };

async function fixture(page: Page, completed = false) {
  let jobs: DownloadSeries[] = completed ? [{ ...download, episodes: download.episodes.map(episode => ({ ...episode, status: 'complete', progress: 1, playback: { provider: 'reanime', server: { id: 'saved', name: 'Saved', audio: 'sub' }, episode: episode.number, audio: 'sub', sources: [{ url: `/api/v1/downloads/${id}/files/episode-${episode.number}/0.bin`, type: 'mp4' }], subtitles: [{ url: `/api/v1/downloads/${id}/files/episode-${episode.number}/subtitles-0/0.bin`, format: 'vtt', label: 'English', language: 'en' }], attempts: [] } })) }] : [];
  const requests: Record<string, unknown>[] = [];
  let onlineRequests = 0;
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.includes('/files/')) {
      if (path.includes('subtitles')) return route.fulfill({ contentType: 'text/plain', body: 'WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nSaved subtitle.' });
      const match = /bytes=(\d+)-(\d*)/.exec(request.headers().range || '');
      const start = match ? Number(match[1]) : 0, end = match?.[2] ? Math.min(Number(match[2]), media.length - 1) : media.length - 1;
      return route.fulfill({ status: match ? 206 : 200, contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), ...(match ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}) }, body: media.subarray(start, end + 1) });
    }
    if (path.endsWith('/downloads') && request.method() === 'POST') {
      const body = request.postDataJSON(); requests.push(body);
      jobs = [{ ...structuredClone(download), audio: body.audio, quality: body.quality }];
      return route.fulfill({ status: 202, json: { download: jobs[0] } });
    }
    if (path.endsWith('/downloads')) {
      const response: DownloadsResponse = { downloads: jobs, location: 'C:\\Videos\\Moewatch', canPickFolder: false, storage: { video: jobs.length ? 5000000 : 0, artwork: jobs.length ? 50000 : 0, subtitles: jobs.length ? 5000 : 0, other: 0, total: jobs.length ? 5055000 : 0, capacity: 1000000000, free: 500000000 } };
      return route.fulfill({ json: response });
    }
    if (path.endsWith('/downloads/location')) { requests.push(request.postDataJSON()); return route.fulfill({ json: { ok: true } }); }
    if (path === `/api/v1/downloads/${id}` && request.method() === 'DELETE') { jobs = []; return route.fulfill({ json: { ok: true } }); }
    if (path.endsWith('/account')) return route.fulfill({ json: { user: null, configured: false } });
    if (path.endsWith('/shared-storage')) return route.fulfill({ json: {} });
    if (path.endsWith('/providers')) return route.fulfill({ json: { providers: [] } });
    if (path.includes('/skip-times/')) return route.fulfill({ json: { status: 'not-found' } });
    if (path.endsWith('/availability') || path.endsWith('/playback') || path.endsWith('/servers')) {
      onlineRequests++;
      if (completed) return route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: 'Internet disconnected' } } });
      return route.fulfill({ json: { animeId: anime.id, providers: [] } });
    }
    if (path.endsWith(`/anime/${anime.id}`)) return route.fulfill({ json: { anime } });
    return route.fulfill({ json: {} });
  });
  return { requests, onlineRequests: () => onlineRequests };
}

test('one series button starts downloads without a popup and header shows a minimal queue', async ({ page }) => {
  const { requests } = await fixture(page);
  await page.goto(`/anime/${anime.id}`);
  await expect(page.locator('.downloads-trigger')).toHaveCount(0);
  await expect(page.locator('.series-download-button')).toHaveAttribute('data-state', 'undownloaded');
  await expect(page.locator('.series-download-button')).toHaveText('');
  await page.getByRole('button', { name: `Download all available episodes of ${anime.title}` }).click();
  await expect(page.locator('.series-download-button')).toHaveText('25%');
  await expect(page.locator('.series-download-button')).toHaveAttribute('data-state', 'downloading');
  await expect(page.getByRole('button', { name: /Downloads, 25%/ })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(requests).toEqual([{ animeId: anime.id, audio: 'sub', provider: 'auto', fallback: true, quality: 720 }]);
  await page.getByRole('button', { name: /Downloads, 25%/ }).click();
  const popover = page.getByRole('dialog', { name: 'Downloads' });
  await expect(popover.locator('.download-subheading')).toHaveText('0/2 · 2.0 MB/s · 2m remaining');
  await expect(popover.getByRole('progressbar')).toHaveAttribute('value', '0.25');
  await expect(popover.getByRole('button')).toHaveCount(0);
  await expect(popover.getByText('Downloads', { exact: true })).toHaveCount(0);
  await expect(page.locator('.downloads-trigger')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const artwork = await popover.locator('.download-cover').boundingBox();
  const copy = await popover.locator('.download-copy').boundingBox();
  expect(artwork!.y).toBe(copy!.y);
  expect(artwork!.height).toBe(copy!.height);
  expect(artwork!.height).toBe(56);
  const progressBar = await popover.getByRole('progressbar').boundingBox();
  expect(progressBar!.y + progressBar!.height).toBe(artwork!.y + artwork!.height);
  await page.screenshot({ path: 'artifacts/downloads/desktop-popover.png' });
  expect((await new AxeBuilder({ page }).include('.downloads-popover').analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Downloads, 25%/ })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /Downloads, 25%/ }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/downloads/mobile-popover.png' });
  const mobileArtwork = await popover.locator('.download-cover').boundingBox();
  const mobileCopy = await popover.locator('.download-copy').boundingBox();
  expect(mobileArtwork!.y).toBe(mobileCopy!.y);
  expect(mobileArtwork!.height).toBe(mobileCopy!.height);
});

test('completed download uses an icon and can return to the undownloaded state', async ({ page }) => {
  await fixture(page, true);
  await page.goto(`/anime/${anime.id}`);
  const button = page.locator('.series-download-button');
  await expect(button).toHaveAttribute('data-state', 'downloaded');
  await expect(button).toHaveText('');
  await page.getByRole('button', { name: `Remove download of ${anime.title}` }).click();
  await expect(button).toHaveAttribute('data-state', 'undownloaded');
  await expect(page.locator('.downloads-trigger')).toHaveCount(0);
});

test('Playback settings show storage categories and allow a LAN client to change the host folder', async ({ page }) => {
  const { requests } = await fixture(page, true);
  await page.goto('/settings/playback');
  await expect(page.getByRole('heading', { name: 'Downloads', exact: true })).toBeVisible();
  const size = await page.getByRole('heading', { name: 'Playback', exact: true }).evaluate(element => getComputedStyle(element).fontSize);
  await expect(page.getByRole('heading', { name: 'Downloads', exact: true })).toHaveCSS('font-size', size);
  await expect(page.getByRole('heading', { name: 'Provider status', exact: true })).toHaveCSS('font-size', size);
  await expect(page.locator('.download-settings .setting-title').first()).toHaveText('Local storage');
  await expect(page.getByText('downloads closest matching quality', { exact: true })).toBeVisible();
  await expect(page.getByText('Shown when the video includes subtitle tracks.')).toHaveCount(0);
  await expect(page.getByRole('img', { name: /Downloads use/ })).toBeVisible();
  await page.getByRole('combobox', { name: 'Download quality' }).selectOption('1080');
  await page.getByRole('button', { name: 'Change folder' }).click();
  await page.getByRole('textbox', { name: 'Host folder' }).fill('D:\\Anime');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Host folder' })).toHaveCount(0);
  expect(requests).toContainEqual({ location: 'D:\\Anime' });
  await page.screenshot({ path: 'artifacts/downloads/desktop-settings.png' });
  expect((await new AxeBuilder({ page }).include('.settings-content').analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/downloads/mobile-settings.png' });
});

test('downloaded episodes play and seek after reload without checking providers', async ({ page }) => {
  const fixtureState = await fixture(page, true);
  await page.addInitScript(() => localStorage.setItem('moewatch-settings-v1', JSON.stringify({ subtitles: true })));
  await page.goto(`/watch/${anime.id}/1`);
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
  await expect(page.locator('video')).toHaveAttribute('src', /\/downloads\//);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.subtitle-overlay')).toContainText('Saved subtitle.');
  await page.getByRole('slider', { name: 'Playback position' }).fill('2');
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThanOrEqual(2);
  await page.reload();
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
  expect(fixtureState.onlineRequests()).toBe(0);
});
