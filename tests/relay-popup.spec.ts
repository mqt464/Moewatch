import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker, { SigninCoordinator, digest, type Env, type Storage } from '../auth-relay/worker';

test('minimal sign-in popup fits desktop and mobile', async ({ page }) => {
  const origin = 'https://relay.example';
  const db = new DatabaseSync(':memory:');
  const storage: Storage = { sql: { exec<T>(sql: string, ...values: (string | number | null)[]) {
    const rows = db.prepare(sql).all(...values) as T[]; return Object.assign(rows, { toArray: () => rows });
  } }, async setAlarm() {} };
  let ready: Promise<unknown> = Promise.resolve();
  const env = { RELAY_PUBLIC_ORIGIN: origin, TURNSTILE_SITE_KEY: 'site-key', SIGNIN: {
    idFromName: () => 'test', get: () => ({ fetch: (request: Request) => coordinator.fetch(request) }),
  }, ASSETS: { async fetch(request: Request) {
    const name = new URL(request.url).pathname.slice(1);
    return new Response(readFileSync(`auth-relay/assets/${name}`), { headers: { 'content-type': name.endsWith('.css') ? 'text/css' : 'image/png' } });
  } } } as unknown as Env;
  const coordinator = new SigninCoordinator({ storage, blockConcurrencyWhile(callback) { ready = callback(); return ready; } }, env);
  await ready;
  const response = await worker.fetch(new Request(`${origin}/v1/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challenge: await digest('v'.repeat(43)) }) }), env);
  const login = await response.json() as { authorizeUrl: string };
  await page.route('https://challenges.cloudflare.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.route(`${origin}/**`, async route => {
    const response = await worker.fetch(new Request(route.request().url()), env);
    return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
  try {
    for (const width of [560, 360]) {
      await page.setViewportSize({ width, height: width === 560 ? 760 : 640 });
      await page.goto(login.authorizeUrl);
      await expect(page.locator('.mascot')).toHaveJSProperty('complete', true);
      await expect(page.locator('.mascot')).toHaveCSS('object-fit', 'contain');
      await expect(page.getByRole('heading')).toHaveText('Sign in to AniList');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/relay-popup-${width}.png` });
    }
  } finally { db.close(); }
});
