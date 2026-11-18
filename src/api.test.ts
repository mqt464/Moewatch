import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest } from './api';

test('account session messages survive a successful HTTP response', async () => {
  const body = { configured: true, user: null, error: 'Session expired' };
  const request = mock.method(globalThis, 'fetch', async () => Response.json(body));
  try { assert.deepEqual(await apiRequest('/account'), body); }
  finally { request.mock.restore(); }
});

test('API error envelopes still reject with their message', async () => {
  const request = mock.method(globalThis, 'fetch', async () => Response.json({ error: { code: 'UNAVAILABLE', message: 'Upstream unavailable' } }, { status: 502 }));
  try { await assert.rejects(apiRequest('/account'), /Upstream unavailable/); }
  finally { request.mock.restore(); }
});
