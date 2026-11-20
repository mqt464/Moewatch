import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0; localStorage.removeItem('moewatch.hero-history'); });
  await page.route('**/api/v1/**', route => route.abort());
});

test('home has real artwork and works at desktop and mobile widths', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Frieren/, level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Featured', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Featured anime' }).locator('.hero-art')).toHaveJSProperty('naturalWidth', 1900);
  await page.locator('img.artwork').evaluateAll(images => images.forEach(image => { (image as HTMLImageElement).loading = 'eager'; }));
  await expect(page.locator('.artwork.is-loading')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/home-desktop.png', fullPage: true, animations: 'disabled' });
  for (const width of [375, 768]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('link', { name: 'Watch', exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/home-${width}.png`, fullPage: true, animations: 'disabled' });
  }
});

test('save survives reload; series, episodes, and player navigation work', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('combobox', { name: /List status for Frieren/ }).selectOption('PLANNING');
  await page.getByRole('navigation').getByRole('link', { name: 'My List' }).click();
  await expect(page).toHaveURL('/list');
  await expect(page.locator('.saved-grid .poster h3')).toHaveText(/Frieren/);
  await page.reload();
  await expect(page.locator('.saved-grid .poster h3')).toHaveText(/Frieren/);
  await page.locator('.saved-grid .poster-link').click();
  await expect(page.getByRole('tab', { name: /Episodes/ })).toBeVisible();
  await expect(page.locator('.hero-art')).toHaveClass(/is-ready/);
  await page.screenshot({ path: 'test-results/series-desktop.png', fullPage: true });
  await expect(page.getByRole('link', { name: 'Episode 28', exact: false })).not.toBeVisible();
  await page.getByRole('tab', { name: 'Characters' }).click();
  await expect(page.locator('.character').first()).toBeVisible();
  await page.getByRole('tab', { name: /Episodes/ }).click();
  await page.getByRole('link', { name: 'Watch episode 1' }).click();
  await expect(page.getByText('No video source', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next episode' }).click();
  await expect(page).toHaveURL(/\/watch\/154587\/2$/);
  await page.screenshot({ path: 'test-results/watch.png', fullPage: true });
});

test('search, genres, offline feedback and no-results recovery', async ({ page }) => {
  await page.goto('/browse');
  await expect(page.getByText('AniList unavailable. Showing cached titles.')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search anime' }).fill('Cowboy');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/search=Cowboy/);
  await expect(page.locator('.poster')).toHaveCount(1);
  await expect(page.locator('.poster h3')).toHaveText('Cowboy Bebop');
  await page.getByRole('button', { name: 'Romance', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No results' })).toBeVisible();
  await page.getByRole('link', { name: 'Reset filters' }).click();
  await expect(page.locator('.poster')).toHaveCount(8);
  await page.goto('/not-a-page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.locator('.error-page').getByRole('link', { name: 'Discover' }).click();
  await expect(page).toHaveURL('/');
});

test('search has one focus indicator and keeps keyboard submission accessible', async ({ page }) => {
  await page.goto('/browse');
  const field = page.getByRole('searchbox', { name: 'Search anime' });
  const form = page.getByRole('search');
  await field.click();
  await expect(field).toBeFocused();
  await expect(field).toHaveCSS('outline-style', 'none');
  await expect(form).toHaveCSS('border-color', 'rgb(231, 160, 180)');
  await field.fill('Cowboy');
  await field.press('Enter');
  await expect(page).toHaveURL(/search=Cowboy/);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Clear search' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Clear search' })).toHaveCSS('outline-style', 'solid');
  await expect(form).not.toHaveCSS('border-color', 'rgb(231, 160, 180)');
  await page.keyboard.press('Enter');
  await expect(field).toHaveValue('');
  await page.setViewportSize({ width: 375, height: 900 });
  await field.click();
  await expect(field).toHaveCSS('font-size', '16px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/search-mobile-focused.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/search-desktop-focused.png', fullPage: true });
});

test('core screens have no serious accessibility violations', async ({ page }) => {
  for (const route of ['/', '/browse', '/list', '/anime/154587', '/watch/154587/1', '/missing']) {
    await page.goto(route);
    await expect(page.locator('main')).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter(violation => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([]);
  }
});

test('Discover uses direct category rows and accessible carousel controls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.catalog-row h2')).toHaveText(['Featured', 'Action', 'Adventure', 'Slice of Life']);
  await expect(page.getByRole('heading', { name: 'Continue Watching', exact: true })).toHaveCount(0);
  await expect(page.locator('.eyebrow, .editorial, .mood-card, .poster-hover, .round-play')).toHaveCount(0);
  const rail = page.getByRole('group', { name: 'Featured carousel', exact: true });
  const previous = page.getByRole('button', { name: 'Previous Featured', exact: true });
  const next = page.getByRole('button', { name: 'Next Featured', exact: true });
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  await next.click();
  await expect.poll(() => rail.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await expect(next).toBeDisabled();
  await previous.click();
  await expect(previous).toBeDisabled();
  await rail.focus();
  await page.keyboard.press('ArrowRight');
  await expect(previous).toBeEnabled();
  await rail.locator('.poster-link').first().hover();
  await expect(rail.locator('.poster svg')).toHaveCount(0);
  for (const [route, heading] of [['/browse', 'Search'], ['/list', 'My List']]) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
  }
  await page.getByRole('button', { name: 'Profile menu', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'Profile', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL('/settings');
  await expect(page.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(violation => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([]);
  await expect(page.getByRole('menu')).not.toBeVisible();
});

test('local playback saves real progress and returns to continue watching', async ({ page }) => {
  await page.goto('/watch/154587/1');
  await expect(page.getByText('No video source', { exact: true })).toBeVisible();
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext('2d')!;
    const stream = canvas.captureStream(12);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    const completed = new Promise<Blob>(resolve => { recorder.ondataavailable = event => chunks.push(event.data); recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' })); });
    recorder.start();
    for (let frame = 0; frame < 20; frame++) {
      context.fillStyle = frame % 2 ? '#e7a0b4' : '#171114';
      context.fillRect(0, 0, 320, 180);
      await new Promise(resolve => setTimeout(resolve, 90));
    }
    recorder.stop();
    const blob = await completed;
    stream.getTracks().forEach(track => track.stop());
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByLabel('Choose a local video').setInputFiles({ name: 'test-video.webm', mimeType: 'video/webm', buffer: Buffer.from(bytes) });
  const player = page.locator('video');
  await expect(player).toBeVisible();
  await player.evaluate(async video => {
    const element = video as HTMLVideoElement;
    if (element.readyState < 1) await new Promise(resolve => element.addEventListener('loadedmetadata', resolve, { once: true }));
    element.currentTime = 0.5;
    await element.play();
  });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('moewatch-library-v1') || '{}').progress?.length)).toBe(1);
  await player.evaluate(video => (video as HTMLVideoElement).pause());
  await page.getByRole('link', { name: 'Back to series' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Discover' }).click();
  await expect(page.getByRole('heading', { name: 'Continue Watching' })).toBeVisible();
  await expect(page.locator('.continue-card')).toHaveCount(1);
  await expect(page.locator('.continue-card p')).toHaveText(/Episode 1.*min left/);
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuetext', /minutes remaining/);
  await expect(page.locator('.remaining')).toHaveCount(0);
});

test('removing a saved title can be undone', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: /List status for Frieren/ }).selectOption('PLANNING');
  await page.goto('/list');
  await page.getByRole('button', { name: /Remove Frieren/ }).click();
  await expect(page.getByRole('heading', { name: 'No saved anime' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.saved-grid .poster')).toHaveCount(1);
});
