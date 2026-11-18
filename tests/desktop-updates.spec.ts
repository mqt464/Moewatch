import { test, expect } from '@playwright/test';
test('desktop checks at startup and installs only after a click', async ({page}) => {
 await page.addInitScript(() => {
  const calls: string[] = [];
  Object.assign(window, { isTauri: true, desktopCalls: calls, __TAURI_INTERNALS__: {
   invoke: async (command: string) => { calls.push(command); if(command === 'plugin:updater|check') return {rid:1,version:'0.2.0',currentVersion:'0.1.0',body:'Update'}; },
   transformCallback: () => 1, unregisterCallback: () => {}
  }});
 });
 await page.route('**/api/v1/**', route => route.abort());
 await page.goto('/settings/about');
 await expect(page.getByRole('button',{name:'Install update'})).toBeEnabled();
 expect(await page.evaluate(() => (window as unknown as {desktopCalls:string[]}).desktopCalls)).toEqual(['plugin:updater|check']);
 await page.getByRole('button',{name:'Install update'}).click();
 await expect.poll(() => page.evaluate(() => (window as unknown as {desktopCalls:string[]}).desktopCalls)).toContain('plugin:updater|download_and_install');
 await expect.poll(() => page.evaluate(() => (window as unknown as {desktopCalls:string[]}).desktopCalls)).toContain('plugin:process|restart');
});
test('web app does not invoke desktop updates', async ({page}) => {
 await page.route('**/api/v1/**', route => route.abort());
 await page.goto('/settings/about');
 await expect(page.getByRole('button',{name:'Check for updates'})).toBeDisabled();
 await expect(page.locator('.profile-update-dot')).toHaveCount(0);
 await page.getByRole('button', { name: 'Profile menu' }).click();
 await expect(page.getByRole('menuitem', { name: 'Install update' })).toHaveCount(0);
});

test('profile CTA appears after detection and supports retrying a failed install', async ({ page }) => {
 await page.addInitScript(() => {
  const calls: string[] = [];
  let finishCheck: (value: unknown) => void;
  Object.assign(window, { isTauri: true, desktopCalls: calls, detectUpdate: () => finishCheck({rid:1,version:'0.2.0',currentVersion:'0.1.0'}), __TAURI_INTERNALS__: {
   invoke: async (command: string) => {
    calls.push(command);
    if (command === 'plugin:updater|check') return new Promise(resolve => { finishCheck = resolve; });
    if (command === 'plugin:updater|download_and_install' && calls.filter(call => call === command).length === 1) throw new Error('Download failed');
   },
   transformCallback: () => 1, unregisterCallback: () => {}
  }});
 });
 await page.route('**/api/v1/**', route => route.abort());
 await page.goto('/settings/playback');
 const profile = page.getByRole('button', { name: 'Profile menu' });
 await profile.click();
 await expect(page.locator('.profile-update-dot')).toHaveCount(0);
 await expect(page.getByRole('menuitem', { name: 'Install update' })).toHaveCount(0);
 await page.evaluate(() => (window as unknown as { detectUpdate: () => void }).detectUpdate());
 await expect(page.locator('.profile-update-dot')).toBeVisible();
 await expect(profile).toHaveAccessibleDescription('Update available');
 const install = page.getByRole('menuitem', { name: 'Install update', exact: true });
 await install.click();
 await expect(page.getByRole('status')).toHaveText('Update failed. Try again.');
 await install.click();
 await expect.poll(() => page.evaluate(() => (window as unknown as {desktopCalls:string[]}).desktopCalls)).toContain('plugin:process|restart');
});

test('desktop without an update hides the profile CTA', async ({ page }) => {
 await page.addInitScript(() => {
  Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: {
   invoke: async () => null, transformCallback: () => 1, unregisterCallback: () => {}
  }});
 });
 await page.route('**/api/v1/**', route => route.abort());
 await page.goto('/settings/about');
 await expect(page.getByText('You are up to date.')).toBeVisible();
 await expect(page.locator('.profile-update-dot')).toHaveCount(0);
 await page.getByRole('button', { name: 'Profile menu' }).click();
 await expect(page.getByRole('menuitem', { name: 'Install update' })).toHaveCount(0);
});
