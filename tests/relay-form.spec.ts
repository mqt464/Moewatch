import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import worker, { SigninCoordinator, digest, type Env, type Storage } from '../auth-relay/worker';

test('hosted form submits the callback token once, after verification', async ({ page }) => {
  const origin = 'https://relay.example';
  const db = new DatabaseSync(':memory:');
  const storage: Storage = { sql: { exec<T>(sql: string, ...values: (string | number | null)[]) {
    const rows = db.prepare(sql).all(...values) as T[]; return Object.assign(rows, { toArray: () => rows });
  } }, async setAlarm() {} };
  let ready: Promise<unknown> = Promise.resolve();
  const env = { RELAY_PUBLIC_ORIGIN: origin, TURNSTILE_SITE_KEY: 'public-key', ANILIST_CLIENT_ID: 'client', SIGNIN: {
    idFromName: () => 'test', get: () => ({ fetch: (request: Request) => coordinator.fetch(request) }),
  } } as unknown as Env;
  const coordinator = new SigninCoordinator({ storage, blockConcurrencyWhile(callback) { ready = callback(); return ready; } }, env);
  await ready;
  const start = await worker.fetch(new Request(`${origin}/v1/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challenge: await digest('v'.repeat(43)) }) }), env);
  const login = await start.json() as { authorizeUrl: string };
  let submitted: URLSearchParams | undefined;
  let submissions = 0;
  await page.route('https://challenges.cloudflare.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.route(`${origin}/**`, async route => {
    if (route.request().method() === 'POST') {
      submitted = new URLSearchParams(route.request().postData() ?? ''); submissions++;
      return route.fulfill({ status: 302, headers: { ...Object.fromEntries((await worker.fetch(new Request(`${origin}/health`), env)).headers), location: 'https://anilist.co/api/v2/oauth/authorize' }, body: '' });
    }
    const response = await worker.fetch(new Request(route.request().url()), env);
    return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
  try {
    await page.goto(login.authorizeUrl);
    await expect(page.getByRole('button', { name: 'Continue with AniList' })).toBeDisabled();
    await page.evaluate(() => {
      const callback = (window as unknown as { moewatchTurnstileComplete: (token: string) => void }).moewatchTurnstileComplete;
      callback('verified-token'); callback('verified-token');
    });
    await expect(page).toHaveURL('https://anilist.co/api/v2/oauth/authorize');
    expect(submitted?.get('cf-turnstile-response')).toBe('verified-token');
    expect(submissions).toBe(1);
  } finally { db.close(); }
});
