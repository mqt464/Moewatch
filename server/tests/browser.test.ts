import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { browserAvailable, browserRequest, closeBrowser, setBrowserNetworkValidator, withBrowserScenario } from '../infrastructure/browser';

const miruro = 'https://www.miruro.tv/api/v1/anime?q=Cowboy+Bebop&limit=15';
const settlar = 'https://embed.settlar.io';

test('browser transport rejects unsafe URLs and contexts before DNS', async t => {
  let lookups = 0;
  await setBrowserNetworkValidator(async () => { lookups++; return []; });
  t.after(() => setBrowserNetworkValidator());
  const signal = new AbortController().signal;
  for (const url of [
    'http://www.miruro.tv', 'https://www.miruro.tv:443/', 'https://www.miruro.tv:444/',
    'https://alice@www.miruro.tv/', 'https://www.miruro.tv/#fragment', 'https://www.miruro.tv./',
    'https://www.miruro.tv.external.test/', 'https://127.1/', 'https://[::1]/', 'https://www%2emiruro.tv/',
  ]) {
    await assert.rejects(browserRequest(url, { signal }), { code: 'UPSTREAM_BLOCKED' });
  }
  await assert.rejects(browserRequest(miruro, { signal, contextOrigin: settlar }), { code: 'UPSTREAM_BLOCKED' });
  await assert.rejects(browserRequest(miruro, { signal, contextOrigin: 'https://www.miruro.tv/player' }), { code: 'UPSTREAM_BLOCKED' });
  await assert.rejects(browserRequest(miruro, { signal, maxBytes: 8 * 1024 * 1024 + 1 }), { code: 'INVALID_REQUEST' });
  await assert.rejects(browserRequest('https://media.settlar.io/a', { signal, maxBytes: 32 * 1024 * 1024 + 1 }), { code: 'INVALID_REQUEST' });
  assert.equal(lookups, 0);
});

test('browser transport rejects a host when any DNS answer is unsafe', async t => {
  const signal = new AbortController().signal;
  const resolved = new Set<string>();
  let rejectedAddress = '';
  await setBrowserNetworkValidator(async host => {
    resolved.add(host);
    return [{ address: '104.21.20.109' }, { address: rejectedAddress }];
  });
  t.after(() => setBrowserNetworkValidator());
  for (const address of ['127.0.0.1', '192.0.2.4', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1', 'invalid']) {
    rejectedAddress = address;
    await assert.rejects(browserRequest(miruro, { signal }), { code: 'UPSTREAM_BLOCKED' });
  }
  assert.deepEqual([...resolved].sort(), ['embed.settlar.io', 'media.settlar.io', 'miruro.tv', 'www.miruro.tv']);
});

test('caller abort and shutdown cancel DNS and queued requests promptly', { timeout: 3000 }, async t => {
  let start!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  await setBrowserNetworkValidator(() => {
    start();
    return new Promise(() => {});
  });
  t.after(() => setBrowserNetworkValidator());
  const controller = new AbortController();
  const pending = browserRequest(miruro, { signal: controller.signal });
  await started;
  const reason = new Error('caller cancelled');
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  const requests = Array.from({ length: 6 }, () => browserRequest(miruro, { signal: new AbortController().signal }));
  const completed = Promise.all(requests.map(request => assert.rejects(request, { code: 'UPSTREAM_ERROR' })));
  await closeBrowser();
  await completed;
});

test('browser scenarios have separate DNS allowlists and fail closed', async t => {
  const resolved: string[] = [];
  await setBrowserNetworkValidator(async host => {
    resolved.push(host);
    return [{ address: '104.21.20.109' }, { address: '192.168.0.1' }];
  });
  t.after(() => setBrowserNetworkValidator());
  const signal = new AbortController().signal;
  const callback = async () => assert.fail('A scenario cannot start with unsafe DNS');
  await assert.rejects(withBrowserScenario('mkissa-episode', signal, callback), { code: 'UPSTREAM_BLOCKED' });
  assert.deepEqual(resolved.sort(), ['api.mkissa.net', 'cdn.mkissa.net', 'mkissa.to']);
  resolved.length = 0;
  await assert.rejects(withBrowserScenario('mkissa-player', signal, callback), { code: 'UPSTREAM_BLOCKED' });
  assert.deepEqual(resolved, ['bysekoze.com', 'n1mwq.org']);
});

test('live MKissa scenario loads its document and observes a blocked off-list request', {
  skip: process.env.MOEWATCH_BROWSER_LIVE_TEST !== '1',
  timeout: 20_000,
}, async () => {
  const signal = AbortSignal.timeout(15_000);
  await withBrowserScenario('mkissa-episode', signal, async page => {
    await assert.rejects(page.navigate('https://n1mwq.org/player/movie'), { code: 'UPSTREAM_BLOCKED' });
    await page.addInitScript('globalThis.moewatchRuntimeProbe = true');
    await page.navigate('https://mkissa.to/anime');
    assert.equal(await page.evaluate('location.origin'), 'https://mkissa.to');
    assert.equal(await page.evaluate('globalThis.moewatchRuntimeProbe'), true);
    const target = 'https://example.com/probe.m3u8';
    let observed = false;
    const unsubscribe = page.onRequest(url => { if (url === target) observed = true; });
    try {
      const result = await page.evaluate(`fetch(${JSON.stringify(target)}).then(() => 'sent', () => 'blocked')`);
      assert.equal(result, 'blocked');
      assert.ok(observed);
    } finally { unsubscribe(); }
  });
});

test('live hidden Chromium serves Miruro and Settlar through the private CDP pipe', {
  skip: process.env.MOEWATCH_BROWSER_LIVE_TEST !== '1',
  timeout: 45_000,
}, async t => {
  assert.ok(browserAvailable(), 'Full Chromium 157+ is required');
  t.after(closeBrowser);
  const signal = AbortSignal.timeout(40_000);
  const start = performance.now();
  const rss = process.memoryUsage.rss();
  const sample = async (step: string, url: string, options = {}) => {
    const started = performance.now();
    const response = await browserRequest(url, { signal, ...options });
    assert.equal(response.status, 200, step);
    assert.equal(response.headers.get('content-encoding'), null);
    const bytes = Buffer.from(await response.arrayBuffer());
    t.diagnostic(JSON.stringify({ step, status: response.status, bytes: bytes.length, ms: Math.round(performance.now() - started) }));
    return bytes;
  };

  const catalog = await sample('Miruro search', miruro);
  const key = Buffer.from('miruro/catalog');
  const clear = catalog.map((value, index) => value ^ key[index % key.length]);
  assert.ok(JSON.parse(gunzipSync(clear).toString()).data.length > 0);
  await assert.rejects(browserRequest(miruro, { signal, maxBytes: 8 }), /too large/);
  await assert.rejects(browserRequest('https://www.miruro.tv/favicon.ico', { signal }), /Provider browser fetch failed/);
  const [head, copy] = await Promise.all([
    browserRequest(miruro, { signal, method: 'HEAD' }),
    sample('Miruro concurrent GET', miruro),
  ]);
  assert.equal(head.status, 200);
  assert.equal(head.body, null);
  assert.ok(copy.length > 0);

  const api = async (path: string) => {
    const response = await fetch('https://ani.pm/api/anime/' + path, {
      signal, redirect: 'error', headers: { Referer: 'https://ani.pm/' },
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const bootstrap = await api('playback-bootstrap/settlar/attack-on-titan-1631-qluzus?ep=1&lang=sub&core=0');
  const session = await api('settlar/session?' + new URLSearchParams({
    selection: bootstrap.settlarSelection, provider: 'anipm', ep: '1', channel: 'sub', telemetry: '0',
  }));
  const ticket = new URL(session.embedUrl).searchParams.get('t');
  assert.ok(ticket);
  const sessionBytes = await sample('Settlar session', settlar + '/api/embed/session?' + new URLSearchParams({ t: ticket }));
  const playback = JSON.parse(sessionBytes.toString());
  assert.equal(playback.kind, 'hls');
  const [sameOrigin, crossOrigin] = await Promise.all([
    sample('Settlar same-origin HLS', playback.source, { headers: { 'X-Settlar-Key-Proof': playback.keyProof } }),
    sample('Settlar cross-origin HLS', playback.source, { contextOrigin: settlar }),
  ]);
  assert.ok(sameOrigin.toString().startsWith('#EXTM3U'));
  assert.ok(crossOrigin.equals(sameOrigin), 'Cross-origin and same-origin playlists must agree');

  const cancelled = browserRequest(miruro, { signal: AbortSignal.timeout(80) });
  await assert.rejects(cancelled, { name: 'TimeoutError' });
  await closeBrowser();
  await sample('Miruro after close', miruro);
  t.diagnostic(JSON.stringify({ elapsedMs: Math.round(performance.now() - start), nodeRssBytes: process.memoryUsage.rss(), nodeRssDeltaBytes: process.memoryUsage.rss() - rss }));
});
