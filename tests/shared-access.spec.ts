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
 await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { (window as unknown as { copiedLink: string }).copiedLink = text; } } }); });
 await page.goto('/settings/shared-access');
 await expect(page.getByText('Use moewatch on other devices', { exact: true })).toBeVisible();
 const link = page.getByRole('link', { name: 'http://192.168.1.8:17847', exact: true });
 await expect(link).toBeVisible();
 await page.getByRole('button', { name: 'Copy link', exact: true }).click();
 expect(await page.evaluate(() => (window as unknown as { copiedLink: string }).copiedLink)).toBe(state.urls[0]);
 await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
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
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSharedAccess } from '../server/shared-access';

test('a copied access link opens from another site in a fresh browser', async ({ page }) => {
 const directory = await mkdtemp(join(tmpdir(), 'moewatch-link-'));
 const previous = { data: process.env.MOEWATCH_DATA_DIR, port: process.env.MOEWATCH_PORT };
 const reserve = createServer(); await new Promise<void>(resolve => reserve.listen(0, '127.0.0.1', resolve));
 const lanPort = (reserve.address() as { port: number }).port;
 await new Promise<void>(resolve => reserve.close(() => resolve()));
 process.env.MOEWATCH_DATA_DIR = directory; process.env.MOEWATCH_PORT = String(lanPort - 1);
 const shared = createSharedAccess((_req, res) => { res.end('LAN stream ready'); });
 const local = createServer(shared.handle);
 await new Promise<void>(resolve => local.listen(0, '127.0.0.1', resolve));
 const base = `http://127.0.0.1:${(local.address() as { port: number }).port}`;
 let source: ReturnType<typeof createServer> | undefined;
 try {
  const status = await (await fetch(base + '/api/v1/shared-access', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) })).json();
  const entry = new URL(status.urls[0]); entry.hostname = 'localhost';
  source = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<a href="${entry}">Open shared app</a>`); });
  await new Promise<void>(resolve => source!.listen(0, '127.0.0.1', resolve));
  await page.goto(`http://127.0.0.1:${(source.address() as { port: number }).port}`);
  await page.getByRole('link', { name: 'Open shared app' }).click();
  await expect(page.locator('body')).toHaveText('LAN stream ready');
  await page.reload();
  await expect(page.locator('body')).toHaveText('LAN stream ready');
 } finally {
  shared.close(); local.closeAllConnections(); await new Promise<void>(resolve => local.close(() => resolve()));
  if (source) { source.closeAllConnections(); await new Promise<void>(resolve => source!.close(() => resolve())); }
  if (previous.data === undefined) delete process.env.MOEWATCH_DATA_DIR; else process.env.MOEWATCH_DATA_DIR = previous.data;
  if (previous.port === undefined) delete process.env.MOEWATCH_PORT; else process.env.MOEWATCH_PORT = previous.port;
  await rm(directory, { recursive: true, force: true });
 }
});
