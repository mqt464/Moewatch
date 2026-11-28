import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { providerIds } from '../shared/api';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', route => route.abort());
});

test('profile menu supports keyboard navigation, dismissal and account settings', async ({ page }) => {
  await page.goto('/settings/playback');
  const trigger = page.getByRole('button', { name: 'Profile menu' });
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Sign in', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeFocused();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/settings');
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole('heading', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('menu')).not.toBeVisible();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test('settings show only essential categories and no filler', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Settings pages' });
  await expect(navigation.getByRole('link')).toHaveText(['Account', 'Appearance', 'Playback', 'Subtitles', 'Downloads', 'Accessibility', 'Data', 'About']);
  for (const section of ['account', 'playback', 'about']) {
    await page.goto('/settings/' + section);
    await expect(page.locator('.settings-content h2, .settings-content h3')).toHaveCount(section === 'playback' ? 1 : 0);
    if (section === 'playback') {
      await expect(page.getByRole('heading', { name: 'Providers' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Refresh' })).toHaveCount(0);
    }
    await expect(page.getByText('Changes save automatically.')).toHaveCount(0);
    await expect(page.locator('.settings-sidebar-label, .settings-local-note')).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: 'Check for updates' })).toHaveCount(0);
});

test('connected AniList profile shows avatar, sync controls and signs out', async ({ page }) => {
  let connected = true;
  let listReads = 0;
  const avatar = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  await page.route('**/api/v1/account', route => route.fulfill({ json: { configured: true, user: connected ? { id: 42, name: 'Anime Fan', avatar } : null } }));
  await page.route('**/api/v1/account/list', route => { listReads++; return route.fulfill({ json: { entries: [] } }); });
  await page.route('**/api/v1/account/logout', route => { connected = false; return route.fulfill({ json: { ok: true } }); });
  await page.goto('/settings/account');
  await expect(page.getByText('Anime Fan', { exact: true })).toBeVisible();
  await expect(page.locator('.profile-button img')).toHaveAttribute('src', avatar);
  await expect(page.locator('.settings-avatar img')).toHaveAttribute('src', avatar);
  const sync = page.getByRole('button', { name: 'Sync now', exact: true });
  await expect(sync).toBeEnabled();
  const previousReads = listReads;
  await sync.click();
  await expect.poll(() => listReads).toBeGreaterThan(previousReads);
  await expect(sync).toBeEnabled();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in with AniList', exact: true })).toBeEnabled();
  await expect(page.locator('.profile-button img')).toHaveCount(0);
});

test('audio and subtitle preferences persist', async ({ page }) => {
  await page.route('**/api/v1/providers', route => route.fulfill({ json: { providers: [{ id: 'anikoto', name: 'KotoPlay / AniKoto', configured: true, status: 'configured' }] } }));
  await page.goto('/settings/playback');
  await page.getByRole('combobox', { name: 'Preferred audio' }).selectOption('dub');
  await page.goto('/settings/subtitles');
  await page.getByRole('switch', { name: 'Subtitles' }).check();
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Subtitles' })).toBeChecked();
  await page.goto('/settings/playback');
  await expect(page.getByRole('combobox', { name: 'Preferred audio' })).toHaveValue('dub');
  await expect(page.getByRole('img', { name: 'Configured', exact: true })).toBeVisible();
  for (const icon of await page.locator('.settings-provider-name img').all()) {
    await expect.poll(() => icon.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  }
});

test('desktop Discord integration toggles persist and disabling watch parties leaves', async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: { invoke: async () => null, transformCallback: () => 1, unregisterCallback: () => {} } }));
  let leaves = 0;
  await page.route('**/api/v1/discord/party/playback', route => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/v1/discord/party/leave', route => { leaves++; return route.fulfill({ json: { ok: true } }); });
  await page.goto('/settings/integrations');
  await expect(page.getByRole('heading', { name: 'Integrations', exact: true })).toBeVisible();
  const rpc = page.getByRole('switch', { name: 'Discord activity', exact: true });
  const party = page.getByRole('switch', { name: 'Discord watch party', exact: true });
  await expect(rpc).toBeChecked();
  await expect(party).toBeChecked();
  await rpc.uncheck();
  await expect(party).toBeChecked();
  await party.uncheck();
  await expect.poll(() => leaves).toBeGreaterThan(0);
  await page.reload();
  await expect(rpc).not.toBeChecked();
  await expect(party).not.toBeChecked();
  await rpc.check();
  await expect(party).not.toBeChecked();
});

test('provider names and icons stay readable across settings widths', async ({ page }) => {
  await page.route('**/api/v1/providers', route => route.fulfill({ json: { providers: [] } }));
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/settings/playback');
    const labels = page.locator('.settings-provider-name');
    await expect(labels).toHaveCount(providerIds.length);
    for (const label of await labels.all()) {
      const layout = await label.evaluate(element => {
        const icon = element.querySelector('img')!.getBoundingClientRect();
        return { iconWidth: icon.width, iconHeight: icon.height, labelHeight: element.getBoundingClientRect().height, rowHeight: element.closest('.setting-row')!.getBoundingClientRect().height };
      });
      expect(layout.iconWidth).toBe(20);
      expect(layout.iconHeight).toBe(20);
      expect(layout.labelHeight).toBeLessThanOrEqual(32);
      expect(layout.rowHeight).toBeLessThan(80);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`providers-${width}.png`), fullPage: true });
  }
});

test('all settings pages remain accessible without horizontal overflow', async ({ page }) => {
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const section of ['', '/account', '/appearance', '/playback', '/subtitles', '/downloads', '/accessibility', '/data', '/about']) {
      await page.goto(`/settings${section}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const accessibility = await new AxeBuilder({ page }).analyze();
      expect(accessibility.violations).toEqual([]);
    }
  }
});

test('storage failures are visible and unknown settings pages recover', async ({ page }) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'moewatch-settings-v1') throw new DOMException('Storage blocked', 'SecurityError');
      setItem.call(this, key, value);
    };
  });
  await page.goto('/settings/subtitles');
  await page.getByRole('switch', { name: 'Subtitles' }).check();
  await expect(page.getByRole('alert').filter({ hasText: 'Settings could not be saved' })).toBeVisible();
  await page.goto('/settings/missing');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to settings' }).click();
  await expect(page).toHaveURL('/settings');
});

test('reusable controls have labels, keyboard support and disabled states', async ({ page }) => {
  await page.goto('/tests/fixtures/settings-controls.html');
  await page.getByRole('switch', { name: 'Toggle', exact: true }).check();
  await page.getByRole('slider', { name: 'Slider' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('slider', { name: 'Slider' })).toHaveValue('51');
  await page.getByRole('combobox', { name: 'Dropdown' }).selectOption('second');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Example');
  await page.getByRole('textbox', { name: 'Notes' }).fill('Reusable controls');
  await page.getByRole('checkbox', { name: 'Enable checkbox' }).check();
  for (const label of ['Radio choice', 'Segment choice']) {
    const group = page.getByRole('group', { name: label });
    await group.getByRole('radio', { name: 'First' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(group.getByRole('radio', { name: 'Second' })).toBeChecked();
  }
  await expect(page.getByRole('switch', { name: 'Disabled toggle' })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Disabled input' })).toBeDisabled();
  await page.getByRole('button', { name: 'Run action' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Action complete' })).toHaveText('Action complete');
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test('legacy playback defaults no longer affect local video', async ({ page }) => {
  await page.goto('/settings/playback');
  await expect(page.getByRole('slider', { name: 'Default volume' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Playback speed' })).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Loop video' })).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem('moewatch-settings-v1', JSON.stringify({ volume: 35, playbackSpeed: '1.5', loop: true })));
  await page.goto('/watch/154587/1');
  await expect(page.getByLabel('Choose a local video')).toBeAttached();
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    const completed = new Promise<Blob>(resolve => {
      recorder.ondataavailable = event => chunks.push(event.data);
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
    });
    recorder.start();
    canvas.getContext('2d')!.fillRect(0, 0, 32, 32);
    await new Promise(resolve => setTimeout(resolve, 300));
    recorder.stop();
    const blob = await completed;
    stream.getTracks().forEach(track => track.stop());
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByLabel('Choose a local video').setInputFiles({ name: 'settings-video.webm', mimeType: 'video/webm', buffer: Buffer.from(bytes) });
  const video = page.locator('video');
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
  await expect(video).toHaveJSProperty('volume', 1);
  await expect(video).toHaveJSProperty('playbackRate', 1);
  await expect(video).toHaveJSProperty('loop', false);
});

test('preferences synchronize between tabs', async ({ page, context }) => {
  await page.goto('/settings/playback');
  const second = await context.newPage();
  await second.goto('/settings/playback');
  await expect(second.getByRole('switch', { name: 'Autoplay next episode' })).toBeVisible();
  await page.getByRole('switch', { name: 'Autoplay next episode' }).uncheck();
  await expect(second.getByRole('switch', { name: 'Autoplay next episode' })).not.toBeChecked();
  await second.getByRole('combobox', { name: 'Preferred audio' }).selectOption('dub');
  await expect(page.getByRole('combobox', { name: 'Preferred audio' })).toHaveValue('dub');
  await second.close();
});


test('new playback, subtitle and accessibility controls persist', async ({ page }) => {
  await page.goto('/settings/playback');
  await page.getByRole('switch', { name: 'Autoplay next episode' }).uncheck();
  await page.getByRole('switch', { name: 'Skip openings automatically' }).check();
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Autoplay next episode' })).not.toBeChecked();
  await expect(page.getByRole('switch', { name: 'Skip openings automatically' })).toBeChecked();
  await page.goto('/settings/subtitles');
  await page.getByRole('combobox', { name: 'Text size' }).selectOption('150');
  await expect(page.locator('.settings-subtitle-preview span')).toHaveCSS('font-size', '24px');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Text size' })).toHaveValue('150');
  await page.goto('/settings/accessibility');
  await page.getByRole('switch', { name: 'Reduced motion' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-reduce-motion', 'true');
});

test('backup restore rejects invalid data and history clearing preserves saved titles', async ({ page }) => {
  await page.goto('/settings/data');
  await page.getByLabel('Backup file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1,"library":{}}') });
  await expect(page.getByRole('alert').filter({ hasText: 'Choose a Moewatch backup file.' })).toBeVisible();
  const before = await page.evaluate(() => localStorage.getItem('moewatch-library-v1'));
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('moewatch-library-v1'))).toBe(before);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Watch history cleared.' })).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('moewatch-library-v1') || '{}'));
  expect(stored.progress).toEqual([]);
});

test('phone settings keep the selected category visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings/subtitles');
  await expect(page.getByRole('navigation', { name: 'Settings pages' }).getByRole('link', { name: 'Subtitles', exact: true })).toBeInViewport();
});
