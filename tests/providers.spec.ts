import { expect, test, type Page } from '@playwright/test';
import { curated } from '../src/catalog';
import type { PlaybackRequest, ProviderId } from '../shared/api';

async function fixture(page: Page) {
  const requests: PlaybackRequest[] = [];
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/providers')) return route.fulfill({ json: { providers: [
      { id: 'anikoto', name: 'KotoPlay / AniKoto', configured: true, status: 'configured' },
      { id: 'miruro', name: 'Miruro', configured: true, status: 'configured' },
      { id: 'reanime', name: 'Re:Anime', configured: false, status: 'unconfigured', note: 'Origin required.' },
    ] } });
    if (path.endsWith('/availability')) return route.fulfill({ json: { animeId: 154587, providers: (['anikoto', 'miruro'] as ProviderId[]).map(provider => ({ provider, status: 'available', episodes: [
      { id: `${provider}-1`, number: 1, kind: 'regular', audio: ['sub', 'dub'] },
      { id: `${provider}-3`, number: 3, kind: 'regular', audio: ['sub'] },
    ] })) } });
    if (path.endsWith('/servers')) return route.fulfill({ json: { provider: 'anikoto', episodeId: '1', servers: [{ id: 'main', name: 'Main', audio: 'sub' }] } });
    if (path.endsWith('/playback')) {
      const request = route.request().postDataJSON() as PlaybackRequest;
      requests.push(request);
      const provider = request.provider === 'miruro' ? 'miruro' : 'anikoto';
      return route.fulfill({ json: { provider, server: { id: 'main', name: 'Main', audio: request.audio }, episode: request.episode, audio: request.audio, sources: [{ url: `/media/${provider}-${request.audio}`, type: 'webm' }], subtitles: [], attempts: [] } });
    }
    if (/\/anime\/154587$/.test(path)) return route.fulfill({ json: { anime: curated[0] } });
    return route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: 'Metadata offline' } } });
  });
  await page.route('**/media/**', route => route.fulfill({ status: 200, contentType: 'video/webm', body: Buffer.from([]) }));
  return requests;
}

test('provider preferences persist and report configuration truthfully', async ({ page }) => {
  await fixture(page);
  await page.goto('/settings/playback');
  await page.getByRole('combobox', { name: 'Preferred provider' }).selectOption('anikoto');
  await page.getByRole('combobox', { name: 'Preferred audio' }).selectOption('dub');
  await page.getByRole('switch', { name: 'Provider fallback' }).uncheck();
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Preferred provider' })).toHaveValue('anikoto');
  await expect(page.getByRole('combobox', { name: 'Preferred audio' })).toHaveValue('dub');
  await expect(page.getByRole('switch', { name: 'Provider fallback' })).not.toBeChecked();
  await expect(page.getByText('Origin required.')).toBeVisible();
  await expect(page.getByText('Configured', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('combobox', { name: 'Preferred provider' }).locator('option[value="reanime"]')).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Preferred provider' }).locator('option[value="reanime"]')).toContainText('Unavailable');
  await expect(page.locator('.setting-row[aria-disabled="true"]')).toContainText('Re:Anime');
  await expect(page.getByRole('combobox', { name: 'Preferred provider' }).locator('option[value="anikoto"]')).toBeEnabled();
  await page.route('**/api/v1/providers', route => route.abort());
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect(page.getByRole('combobox', { name: 'Preferred provider' }).locator('option[value="anikoto"]')).toBeDisabled();
});

test('provider selection stays disabled when configuration cannot be loaded', async ({ page }) => {
  await fixture(page);
  await page.route('**/api/v1/providers', route => route.abort());
  await page.goto('/settings/playback');
  const provider = page.getByRole('combobox', { name: 'Preferred provider' });
  for (const id of ['anikoto', 'miruro', 'reanime']) await expect(provider.locator(`option[value="${id}"]`)).toBeDisabled();
  await expect(provider.locator('option[value="auto"]')).toBeEnabled();
});

test('series uses available episode numbers, not metadata episode count', async ({ page }) => {
  await fixture(page);
  await page.goto('/anime/154587');
  await expect(page.getByText('Available episodes for your audio and provider preferences.')).toBeVisible();
  await expect(page.locator('.episode-row')).toHaveCount(2);
  await expect(page.locator('.episode-row').nth(1)).toHaveAttribute('href', '/watch/154587/3');
  await page.getByRole('link', { name: 'Watch episode 1' }).click();
  await page.getByRole('button', { name: 'Next episode' }).click();
  await expect(page).toHaveURL(/watch\/154587\/3$/);
});

test('watch changes provider and audio through normalized API requests', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/watch/154587/1');
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Playback settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Provider', exact: true }).locator('option[value="reanime"]')).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Provider', exact: true }).locator('option[value="reanime"]')).toContainText('Unavailable');
  expect(requests[0]).toMatchObject({ animeId: 154587, episode: 1, provider: 'auto', audio: 'sub', fallback: true });
  await page.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('miruro');
  await expect.poll(() => requests.at(-1)?.provider).toBe('miruro');
  await page.getByRole('button', { name: 'Subtitles', exact: true }).click();
  await page.getByRole('button', { name: 'Dub', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.audio).toBe('dub');
  await expect(page.locator('video')).toHaveAttribute('src', '/media/miruro-dub');
  expect(requests.at(-1)?.provider).toBe('miruro');
  await expect(page.getByLabel('Choose a local video')).toBeAttached();
});

test('watch disables providers without the selected episode and audio', async ({ page }) => {
  await fixture(page);
  await page.addInitScript(() => localStorage.setItem('moewatch-settings-v1', JSON.stringify({ audio: 'dub' })));
  await page.goto('/watch/154587/3');
  await page.getByRole('button', { name: 'Playback settings', exact: true }).click();
  const provider = page.getByRole('combobox', { name: 'Provider', exact: true });
  await expect(provider.locator('option[value="anikoto"]')).toBeDisabled();
  await expect(provider.locator('option[value="miruro"]')).toBeDisabled();
  await expect(provider.locator('option[value="auto"]')).toBeEnabled();
});

test('provider failures keep local playback and retry accessible', async ({ page }) => {
  await fixture(page);
  await page.route('**/availability', route => route.fulfill({ json: { animeId: 154587, providers: [{ provider: 'anikoto', status: 'error', episodes: [], error: { code: 'UPSTREAM_BLOCKED', message: 'Provider blocked request' } }] } }));
  await page.goto('/watch/154587/1');
  await expect(page.getByText('No video source', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Choose a local video')).toBeAttached();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Playback settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Provider', exact: true }).locator('option[value="anikoto"]')).toBeDisabled();
  await page.setViewportSize({ width: 375, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
