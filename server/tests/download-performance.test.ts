import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer, request, type ClientRequestArgs } from 'node:http';
import type { AddressInfo } from 'node:net';
import { saveMedia, type DownloadReader, type DownloadProgress } from '../download-media';
import { DownloadRate } from '../download-progress';
import { createMediaAgents } from '../infrastructure/media';

const playlist = (count: number) => '#EXTM3U\n#EXT-X-TARGETDURATION:6\n' + Array.from({ length: count }, (_, index) => `#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:6,\nsegment-${index}`).join('\n') + '\n#EXT-X-ENDLIST';
const body = (text: string) => (async function* () { yield Buffer.from(text); })();

test('four concurrent segment transfers retry only the failed asset and save no partial or duplicate files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'moewatch-parallel-'));
  const calls = new Map<string, number>();
  let active = 0, peak = 0;
  let final: DownloadProgress | undefined;
  const read: DownloadReader = async (url, signal) => {
    calls.set(url, (calls.get(url) || 0) + 1);
    if (url === 'master') return { type: 'application/vnd.apple.mpegurl', length: 0, body: body(playlist(12)) };
    const attempt = calls.get(url)!;
    return { type: 'application/octet-stream', length: url === 'key' ? 16 : 100, body: (async function* () {
      active++; peak = Math.max(peak, active);
      try {
        await delay(15, undefined, { signal });
        if (url === 'segment-3' && attempt === 1) { yield Buffer.from('partial'); throw Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' }); }
        yield Buffer.alloc(url === 'key' ? 16 : 100, 42);
      } finally { active--; }
    })() };
  };
  try {
    const saved = await saveMedia({ url: 'master', directory, read, quality: 720, signal: new AbortController().signal, onProgress: (_progress, _bytes, estimate) => { final = estimate; } });
    assert.equal(peak, 4); assert.equal(active, 0);
    assert.equal(calls.get('segment-3'), 2); assert.equal(calls.get('key'), 1);
    for (let index = 0; index < 12; index++) if (index !== 3) assert.equal(calls.get(`segment-${index}`), 1);
    assert.equal(saved.files.length, 14);
    assert.equal(new Set(saved.files.map(file => file.name)).size, saved.files.length);
    for (const file of saved.files.filter(file => file.name.endsWith('.bin'))) assert.equal((await readFile(join(directory, file.name))).length, file.bytes);
    assert.ok(final!.transferredBytes > 1216); assert.ok(final!.totalBytes! >= saved.bytes);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('permanent failures abort and settle other workers before returning', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'moewatch-parallel-failure-'));
  let active = 0, failedCalls = 0;
  const read: DownloadReader = async (url, signal) => {
    if (url === 'master') return { type: 'application/vnd.apple.mpegurl', length: 0, body: body(playlist(8)) };
    return { type: 'application/octet-stream', length: 10, body: (async function* () {
      active++;
      try {
        if (url === 'segment-0') { failedCalls++; throw Object.assign(new Error('Forbidden'), { retryable: false }); }
        await delay(5000, undefined, { signal }); yield Buffer.alloc(10);
      } finally { active--; }
    })() };
  };
  try {
    await assert.rejects(saveMedia({ url: 'master', directory, read, quality: 720, signal: new AbortController().signal }), /Forbidden/);
    assert.equal(active, 0); assert.equal(failedCalls, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('retry delays are cancellable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'moewatch-download-backoff-'));
  const controller = new AbortController();
  let calls = 0;
  try {
    const promise = saveMedia({ url: 'file', directory, quality: 720, signal: controller.signal, read: async () => { calls++; throw Object.assign(new Error('Temporary error'), { code: 'ECONNRESET' }); } });
    await delay(30); controller.abort(new Error('User cancelled'));
    await assert.rejects(promise, /abort|cancel/i);
    assert.equal(calls, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('temporary failures stop after three attempts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'moewatch-download-retry-limit-'));
  let calls = 0;
  try {
    await assert.rejects(saveMedia({ url: 'file', directory, quality: 720, signal: new AbortController().signal, read: async () => { calls++; throw Object.assign(new Error('Unavailable'), { retryable: true }); } }), /Unavailable/);
    assert.equal(calls, 3);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('initial size estimates use playlist duration and average bandwidth', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'moewatch-download-size-'));
  let firstEstimate: number | undefined;
  const read: DownloadReader = async url => {
    if (url === 'master') return { type: 'application/vnd.apple.mpegurl', length: 0, body: body('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1600,AVERAGE-BANDWIDTH=800,RESOLUTION=1280x720\nvideo') };
    if (url === 'video') return { type: 'application/vnd.apple.mpegurl', length: 0, body: body('#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nfirst\n#EXTINF:10,\nsecond\n#EXT-X-ENDLIST') };
    return { type: 'video/mp2t', length: 1000, body: (async function* () { yield Buffer.alloc(1000); })() };
  };
  try {
    await saveMedia({ url: 'master', directory, read, quality: 720, signal: new AbortController().signal, onProgress: (_progress, _bytes, estimate) => { firstEstimate ??= estimate?.totalBytes; } });
    assert.equal(firstEstimate, 2000);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('recent download rate follows the last five seconds and decays to zero when stalled', () => {
  const rate = new DownloadRate(0);
  for (let second = 1; second <= 5; second++) rate.update(second * 1000, second * 1000);
  assert.equal(rate.perSecond(5000), 1000);
  for (let second = 6; second <= 10; second++) rate.update(5000 + (second - 5) * 100, second * 1000);
  assert.equal(rate.perSecond(10000), 100);
  assert.equal(rate.perSecond(15000), 0);
  assert.equal(rate.perSecond(16000), 0);
  const unpolled = new DownloadRate(0);
  unpolled.update(1000, 1000);
  assert.equal(unpolled.perSecond(11000), 0);
});

test('media pools reuse sockets for the same DNS pin and separate different pins', async () => {
  const pools = createMediaAgents();
  const server = createServer((_req, res) => res.end('ok'));
  let connections = 0;
  server.on('connection', () => connections++);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const pin = { host: '127.0.0.1', port: (server.address() as AddressInfo).port, mediaAddress: '127.0.0.1', mediaFamily: 4 };
  try {
    for (let index = 0; index < 3; index++) await new Promise<void>((resolve, reject) => {
      const options: ClientRequestArgs = { ...pin, agent: pools.http };
      const req = request(options, response => { response.resume(); response.on('end', resolve); }); req.on('error', reject); req.end();
    });
    assert.equal(connections, 1);
    assert.notEqual(pools.http.getName(pin), pools.http.getName({ ...pin, mediaAddress: '8.8.8.8' }));
    assert.notEqual(pools.https.getName(pin), pools.https.getName({ ...pin, mediaAddress: '8.8.8.8' }));
    assert.equal(pools.http.maxFreeSockets, 4);
  } finally { pools.http.destroy(); pools.https.destroy(); server.closeAllConnections(); server.close(); }
});

test('a provider timeout retries its segment without restarting completed segments', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'moewatch-timeout-'));
  const calls = new Map<string, number>();
  const read: DownloadReader = async url => {
    const attempt = (calls.get(url) || 0) + 1;
    calls.set(url, attempt);
    if (url === 'master') return { type: 'application/vnd.apple.mpegurl', length: 0, body: body(playlist(8)) };
    if (url === 'segment-5' && attempt === 1) throw new DOMException('Provider request timed out', 'TimeoutError');
    return { type: 'application/octet-stream', length: 16, body: body('1234567890123456') };
  };
  try {
    const saved = await saveMedia({ url: 'master', directory, read, quality: 720, signal: new AbortController().signal });
    assert.equal(calls.get('segment-5'), 2);
    for (let index = 0; index < 8; index++) if (index !== 5) assert.equal(calls.get(`segment-${index}`), 1);
    assert.equal(saved.files.length, 10);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
