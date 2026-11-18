import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { media, request } from '../providers/common';

test('provider HTTP response budgets reject oversized declared payloads', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '9000000' } }));
  try { await assert.rejects(request('https://provider.example/', 'anikoto', new AbortController().signal), { code: 'UPSTREAM_ERROR', message: 'Provider response is too large' }); }
  finally { fetch.mock.restore(); }
});

test('provider expiry accepts Unix seconds and milliseconds without inventing expiry', () => {
  const source = { sources: [{ file: 'https://cdn.example/video.mp4' }] };
  assert.equal(media({ ...source, expires_at: 1900000000 }, 'https://provider.example', 'anikoto').expiresAt, 1900000000000);
  assert.equal(media({ ...source, expiresAt: 1900000000000 }, 'https://provider.example', 'anikoto').expiresAt, 1900000000000);
  assert.equal(media(source, 'https://provider.example', 'anikoto').expiresAt, undefined);
});
