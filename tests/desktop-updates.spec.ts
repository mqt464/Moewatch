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
});
