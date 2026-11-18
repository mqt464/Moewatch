import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import worker, { SigninCoordinator, digest, type Env, type Storage } from '../auth-relay/worker';

test('browser delivers fragment token only to its cookie-bound relay session and clears URL', async ({ page, context }) => {
  const origin = 'https://relay.example';
  const db = new DatabaseSync(':memory:');
  const storage: Storage = { sql: { exec<T>(sql: string, ...values: (string | number | null)[]) {
    const rows = db.prepare(sql).all(...values) as T[]; return Object.assign(rows, { toArray: () => rows });
  } }, async setAlarm() {} };
  let ready: Promise<unknown> = Promise.resolve();
  const env = { RELAY_PUBLIC_ORIGIN: origin, TURNSTILE_SITE_KEY: 'site-key', ANILIST_CLIENT_ID: 'client', SIGNIN: {
    idFromName: () => 'test', get: () => ({ fetch: (request: Request) => coordinator.fetch(request) }),
  } } as unknown as Env;
  const coordinator = new SigninCoordinator({ storage, blockConcurrencyWhile(callback) { ready = callback(); return ready; } }, env);
  await ready;
  const id = 'i'.repeat(43), state = 's'.repeat(43), browser = 'b'.repeat(43), verifier = 'v'.repeat(43);
  db.prepare('INSERT INTO logins (id, challenge, expires, phase, state, browser) VALUES (?, ?, ?, ?, ?, ?)').run(id, await digest(verifier), Date.now() + 600000, 'authorized', state, await digest(browser));
  await context.addCookies([{ name: `moewatch_relay_${id}`, value: browser, domain: 'relay.example', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
  const networkUrls: string[] = [];
  await page.route(`${origin}/**`, async route => {
    networkUrls.push(route.request().url());
    const request = route.request();
    const response = await worker.fetch(new Request(request.url(), {
      method: request.method(), headers: await request.allHeaders(),
      ...(request.method() === 'POST' ? { body: request.postData() } : {}),
    }), env);
    return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
  try {
    await page.goto(`${origin}/anilist/callback#access_token=browser-only-token&expires_in=3600&state=${state}`);
    await expect(page.getByRole('heading')).toContainText(/connected/i);
    await expect(page).toHaveURL(`${origin}/anilist/callback`);
    expect(networkUrls.every(url => !url.includes('access_token') && !url.includes('browser-only-token'))).toBe(true);
    const claim = await worker.fetch(new Request(`${origin}/v1/login/${id}/claim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ verifier }) }), env);
    const result = await claim.json() as { status: string; accessToken: string };
    expect(result.status).toBe('complete'); expect(result.accessToken).toBe('browser-only-token');
  } finally { db.close(); }
});
