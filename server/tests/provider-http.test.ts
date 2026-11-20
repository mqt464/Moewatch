import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { media, request } from '../providers/common';
import { Impit } from 'impit';
import { directProviderRequest, providerNetwork } from '../infrastructure/provider-http';

const url = 'https://www.miruro.tv/api/v1/anime?q=Frieren';
test('direct provider transport rejects unrelated hosts, credentials, ports and oversized budgets before DNS', async t => {
  t.mock.method(providerNetwork, 'validated', () => assert.fail('Unsafe request reached DNS'));
  for (const value of ['http://www.miruro.tv/', 'https://www.miruro.tv.evil.test/', 'https://alice@www.miruro.tv/', 'https://media.settlar.io:444/', 'https://127.0.0.1/']) {
    await assert.rejects(directProviderRequest(value, { signal: new AbortController().signal }), { code: 'UPSTREAM_BLOCKED' });
  }
  await assert.rejects(directProviderRequest(url, { signal: new AbortController().signal, maxBytes: 8 * 1024 * 1024 + 1 }), { code: 'INVALID_REQUEST' });
});

test('direct provider transport preserves bytes and supplies fetch context without forwarding credentials', async t => {
  t.mock.method(providerNetwork, 'validated', async () => ({ address: '104.21.20.109', family: 4 as const }));
  const bytes = new Uint8Array([0, 255, 127, 15]);
  t.mock.method(Impit.prototype, 'fetch', async (...[_input, options]: Parameters<Impit['fetch']>) => {
    const headers = new Headers(options?.headers);
    assert.equal(headers.get('sec-fetch-site'), 'same-origin');
    assert.equal(headers.get('sec-fetch-dest'), 'empty');
    assert.equal(headers.get('cookie'), null);
    assert.equal(headers.get('authorization'), null);
    assert.equal(options?.redirect, 'error');
    return new Response(bytes, { headers: { 'content-type': 'application/octet-stream', 'content-encoding': 'gzip', 'set-cookie': 'private=value' } }) as never;
  });
  const response = await directProviderRequest(url, { signal: new AbortController().signal, headers: { Cookie: 'private=value', Authorization: 'private' } });
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal(response.headers.get('content-encoding'), null);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('direct provider transport bounds response bodies and cancels readers', async t => {
  t.mock.method(providerNetwork, 'validated', async () => ({ address: '104.21.20.109', family: 4 as const }));
  let cancelled = false;
  t.mock.method(Impit.prototype, 'fetch', async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(32)); },
    cancel() { cancelled = true; },
  })) as never);
  await assert.rejects(directProviderRequest(url, { signal: new AbortController().signal, maxBytes: 8 }), { code: 'UPSTREAM_ERROR' });
  assert.equal(cancelled, true);
});

test('direct provider HEAD preserves upstream asset length without a body', async t => {
  t.mock.method(providerNetwork, 'validated', async () => ({ address: '104.21.20.109', family: 4 as const }));
  t.mock.method(Impit.prototype, 'fetch', async () => new Response(null, { headers: { 'content-length': '4096' } }) as never);
  const response = await directProviderRequest('https://media.settlar.io/asset', { signal: new AbortController().signal, method: 'HEAD' });
  assert.equal(response.headers.get('content-length'), '4096');
  assert.equal((await response.arrayBuffer()).byteLength, 0);
});

test('direct provider transport rejects cancelled requests before network work', async t => {
  t.mock.method(providerNetwork, 'validated', () => assert.fail('Cancelled request reached DNS'));
  const reason = new Error('cancelled');
  await assert.rejects(directProviderRequest(url, { signal: AbortSignal.abort(reason) }), error => error === reason);
});

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
