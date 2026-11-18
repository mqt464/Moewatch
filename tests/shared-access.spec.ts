import { test, expect } from '@playwright/test';

test('desktop shared access shows a primary address beside its label and saves background mode', async ({ page }) => {
 await page.addInitScript(() => Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: { invoke: async () => null, transformCallback: () => 1, unregisterCallback: () => {} } }));
 let state = { enabled: true, keepRunning: false, urls: ['http://192.168.1.8:17847/?access=test'] };
 await page.route('**/api/v1/**', async route => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/api/v1/shared-access') {
   if (route.request().method() === 'PUT') state = { ...state, ...route.request().postDataJSON() };
   return route.fulfill({ json: state });
  }
  if (path === '/api/v1/shared-storage') return route.fulfill({ json: {} });
  if (path === '/api/v1/account') return route.fulfill({ json: { configured: true, user: null } });
  if (path === '/api/v1/downloads') return route.fulfill({ json: { downloads: [], location: '', storage: {} } });
  return route.abort();
 });
 await page.goto('/settings/shared-access');
 await expect(page.getByText('Use moewatch on other devices', { exact: true })).toBeVisible();
 const link = page.getByRole('link', { name: 'http://192.168.1.8:17847', exact: true });
 await expect(link).toBeVisible();
 await expect(page.locator('.settings-card .setting-title')).toHaveText(['LAN server', 'Keep running while closed', 'LAN address']);
 // Keyboard navigation makes the route's programmatic focus eligible for focus-visible.
 await page.keyboard.press('Tab');
 await page.locator('main').focus();
 await expect(page.locator('main')).toBeFocused();
 await expect(page.locator('main')).toHaveCSS('outline-style', 'none');
 await link.focus();
 await expect(link).toHaveCSS('outline-style', 'solid');
 const row = link.locator('..').locator('..');
 expect(await row.getAttribute('class')).not.toContain('stacked');
 const labelBox = (await page.getByText('LAN address', { exact: true }).boundingBox())!;
 const linkBox = (await link.boundingBox())!;
 expect(linkBox.x).toBeGreaterThan(labelBox.x + labelBox.width);
 expect(Math.abs((linkBox.y + linkBox.height / 2) - (labelBox.y + labelBox.height / 2))).toBeLessThan(5);
 await expect(page.getByText(/Keep Moewatch open/)).toHaveCount(0);
 const background = page.getByRole('switch', { name: 'Keep running while closed' });
 await background.click();
 await expect(background).toBeChecked();
 expect(state.keepRunning).toBe(true);
 await page.getByRole('switch', { name: 'LAN server' }).click();
 await expect(link).toHaveCount(0);
 await expect(background).toBeChecked();
 await page.reload();
 await expect(background).toBeChecked();
});
