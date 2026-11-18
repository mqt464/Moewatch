import { test, expect } from '@playwright/test';
import worker, { type Env } from '../auth-relay/worker';

test('relay form keeps its own Origin without forwarding cross-site referrers', async ({ page }) => {
  const origin = 'https://relay.example';
  let formOrigin: string | undefined;
  const env = { RELAY_PUBLIC_ORIGIN: origin, SIGNIN: {
    idFromName: () => 'test', get: () => ({ fetch: async () => Response.json({ accepted: true }) }),
  } } as unknown as Env;
  const policy = await worker.fetch(new Request(`${origin}/health`), env);
  await page.route(`${origin}/authorize`, async route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ headers: { ...Object.fromEntries(policy.headers), 'content-type': 'text/html' },
        body: '<form method="post" action="/authorize"><button>Continue</button></form>' });
    }
    formOrigin = route.request().headers().origin;
    const response = await worker.fetch(new Request(`${origin}/authorize`, {
      method: 'POST', headers: route.request().headers(), body: route.request().postData(),
    }), env);
    await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
  });
  await page.goto(`${origin}/authorize`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('body')).toContainText('accepted');
  expect(formOrigin).toBe(origin);
  expect(policy.headers.get('referrer-policy')).toBe('same-origin');
});
