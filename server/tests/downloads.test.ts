import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Anime } from '../../src/catalog';
import type { PlaybackResponse } from '../../shared/api';
import { DownloadService } from '../downloads';
import { createServer as createApiServer } from '../app';
import { saveMedia, selectVariant, type DownloadReader } from '../download-media';

const anime: Anime = { id: 1, title: 'Offline example', romaji: 'Offline example', description: 'Saved synopsis', cover: 'https://example.com/cover.jpg', banner: 'https://example.com/banner.jpg', year: 2024, format: 'TV', episodes: 2, duration: 24, score: 80, genres: [], status: 'FINISHED', studios: [], characters: [], related: [], episodeArtwork: [{ number: 1, title: 'Pilot', thumbnail: 'https://example.com/episode.jpg' }] };
const master = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="ja",LANGUAGE="ja",URI="audio"\n#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080,AUDIO="ja"\n1080\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,AUDIO="ja"\n720';
const assets: Record<string, { type: string; body: string }> = {
  master: { type: 'application/vnd.apple.mpegurl', body: master },
  '720': { type: 'application/vnd.apple.mpegurl', body: '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:6,\nsegment\n#EXT-X-ENDLIST' },
  audio: { type: 'application/vnd.apple.mpegurl', body: '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\naudio-segment\n#EXT-X-ENDLIST' },
  key: { type: 'application/octet-stream', body: '1234567890123456' },
  segment: { type: 'video/mp2t', body: 'offline-video' },
  'audio-segment': { type: 'audio/aac', body: 'offline-audio' },
  subtitle: { type: 'text/vtt', body: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello' },
};
const reader: DownloadReader = async (url, signal) => {
  signal.throwIfAborted();
  const asset = assets[url] || (url.startsWith('https://example.com/') ? { type: 'image/jpeg', body: 'artwork' } : undefined);
  if (!asset) throw new Error(`Unexpected upstream request: ${url}`);
  return { type: asset.type, length: Buffer.byteLength(asset.body), body: (async function* () { yield Buffer.from(asset.body); })() };
};
const playback: PlaybackResponse = { provider: 'reanime', server: { id: 'test', name: 'Test', audio: 'sub' }, episode: 1, audio: 'sub', attempts: [], sources: [{ type: 'hls', url: 'master' }], subtitles: [{ url: 'subtitle', format: 'vtt', label: 'English', language: 'en' }] };
async function waitFor(check: () => Promise<boolean>) {
  const deadline = Date.now() + 5000;
  while (!await check()) { if (Date.now() > deadline) throw new Error('Download did not settle'); await new Promise(resolve => setTimeout(resolve, 10)); }
}

test('HLS download keeps one quality, selected audio, keys and segments entirely local', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'moewatch-hls-'));
  try {
    const downloaded = await saveMedia({ url: 'master', directory: folder, read: reader, quality: 720, signal: new AbortController().signal });
    const content = await Promise.all(downloaded.files.filter(file => file.name.endsWith('.m3u8')).map(file => readFile(join(folder, file.name), 'utf8')));
    assert.equal(content.length, 3);
    assert.match(content.join('\n'), /1280x720/);
    assert.doesNotMatch(content.join('\n'), /1920x1080|https?:|\/media\//);
    assert.equal(downloaded.files.filter(file => file.type === 'video/mp2t').length, 1);
    assert.equal(downloaded.files.some(file => file.bytes === 16), true);
    for (const text of content) {
      const references = [...text.matchAll(/URI="([^"]+)"/g)].map(match => match[1]).concat(text.split('\n').filter(line => line && !line.startsWith('#')));
      for (const reference of references) assert.ok(downloaded.files.some(file => file.name === reference));
    }
    assert.match(selectVariant(master, 480), /1280x720/);
    assert.doesNotMatch(selectVariant(master, 480), /1920x1080/);
    const bandwidthOnly = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=4000000\nhigh\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nlow';
    assert.match(selectVariant(bandwidthOnly, 720), /\nhigh$/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('downloads survive restart, retain settings, save artwork and serve seekable files over LAN routes', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'moewatch-downloads-'));
  const settings = { stateFile: join(folder, 'state.json'), defaultLocation: join(folder, 'videos'), read: reader, resolve: async () => ({ ...playback, subtitles: [...playback.subtitles, { ...playback.subtitles[0], label: 'Japanese', language: 'ja' }] }), artwork: async (url: string) => url, thumbnail: async () => null };
  let service = new DownloadService(settings);
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const request = { animeId: 1, episode: 1, audio: 'sub' as const, provider: 'auto' as const, fallback: true, subtitles: false };
    const job = await service.enqueue(anime, [1, 2], request, 720);
    await waitFor(async () => (await service.list()).downloads[0].episodes.every(episode => episode.status === 'complete'));
    const saved = (await service.list()).downloads[0];
    assert.match(saved.anime.cover, /^\/api\/v1\/downloads\//);
    assert.match(saved.anime.episodeArtwork![0].thumbnail, /^\/api\/v1\/downloads\//);
    assert.equal(saved.anime.description, anime.description);
    assert.equal(saved.episodes.length, 2);
    assert.equal((await service.list()).storage.artwork > 0, true);
    await service.setLocation(join(folder, 'new-location'));
    assert.equal((await service.list()).downloads[0].quality, 720);
    await service.close();
    service = new DownloadService({ ...settings, read: async () => { throw new Error('Internet is unavailable'); }, resolve: async () => { throw new Error('Provider is offline'); } });
    const offline = await service.playback(1, 1, 'sub');
    assert.ok(offline);
    assert.equal(offline.subtitles.length, 2, 'All subtitle languages remain saved even with subtitle visibility disabled');
    for (const track of offline.subtitles) assert.match(track.url, /^\/api\/v1\/downloads\//);
    assert.equal(await service.playback(1, 1, 'dub'), undefined);
    assert.equal((await service.list()).location, join(folder, 'new-location'));
    server = createServer((req, res) => {
      const match = /^\/api\/v1\/downloads\/([^/]+)\/files\/(.+)$/.exec(req.url || '');
      if (!match) { res.writeHead(404).end(); return; }
      void service.serve(match[1], match[2], req.method || 'GET', req.headers.range, res, new AbortController().signal).catch(() => res.writeHead(404).end());
    });
    await new Promise<void>(resolve => server!.listen(0, '0.0.0.0', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const playlist = await (await fetch(base + offline.sources[0].url)).text();
    assert.match(playlist, /1280x720/);
    assert.doesNotMatch(playlist, /\/media\/|https?:/);
    const subtitle = await fetch(base + offline.subtitles[0].url, { headers: { Range: 'bytes=0-5' } });
    assert.equal(subtitle.status, 206);
    assert.equal(await subtitle.text(), 'WEBVTT');
    assert.match(subtitle.headers.get('content-range')!, /^bytes 0-5\//);
    assert.equal((await fetch(base + offline.subtitles[0].url, { headers: { Range: 'bytes=99999-' } })).status, 416);
    assert.equal((await fetch(base + offline.subtitles[0].url, { headers: { Range: 'bytes=-0' } })).status, 416);
    assert.equal((await fetch(`${base}/api/v1/downloads/${job.id}/files/state.json`)).status, 404);
    await service.remove(job.id);
    assert.equal((await service.list()).downloads.length, 0);
  } finally { server?.close(); await service.close(); await rm(folder, { recursive: true, force: true }); }
});

test('failed audio remains failed without replacing it and retries keep completed episodes', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'moewatch-download-retry-'));
  let fail = true;
  const calls: number[] = [];
  const service = new DownloadService({ stateFile: join(folder, 'state.json'), defaultLocation: join(folder, 'videos'), read: reader,
    resolve: async request => { calls.push(request.episode); assert.equal(request.audio, 'dub'); if (request.episode === 2 && fail) throw new Error('Dub is unavailable'); return { ...playback, episode: request.episode, audio: 'dub' }; },
    artwork: async url => url, thumbnail: async () => null });
  try {
    const request = { animeId: 1, episode: 1, audio: 'dub' as const };
    await service.enqueue(anime, [1, 2], request, 720);
    await waitFor(async () => (await service.list()).downloads[0].episodes.every(episode => episode.status === 'complete' || episode.status === 'failed'));
    assert.equal((await service.list()).downloads[0].episodes[1].error, 'Dub is unavailable');
    fail = false;
    await service.enqueue(anime, [1, 2], request, 720);
    await waitFor(async () => (await service.list()).downloads[0].episodes.every(episode => episode.status === 'complete'));
    assert.deepEqual(calls, [1, 2, 2, 2]); // Failed prefetch is resolved again when its episode starts.
  } finally { await service.close(); await rm(folder, { recursive: true, force: true }); }
});

test('transfer failures try another server without changing audio or combining partial media', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'moewatch-download-fallback-'));
  const attempts: string[][] = [];
  const service = new DownloadService({ stateFile: join(folder, 'state.json'), defaultLocation: join(folder, 'videos'), read: async (url, signal) => {
    if (url === 'broken') return { type: 'video/mp4', length: 100, body: (async function* () { yield Buffer.from('partial'); throw new Error('Source disconnected'); })() };
    return reader(url, signal);
  }, resolve: async (request, _signal, excluded = []) => {
    assert.equal(request.audio, 'dub'); attempts.push([...excluded]);
    return { ...playback, audio: 'dub', sources: [{ url: excluded.length ? 'master' : 'broken', type: excluded.length ? 'hls' : 'mp4' }], server: { id: excluded.length ? 'backup' : 'broken', name: 'Test', audio: 'dub' } };
  }, artwork: async url => url, thumbnail: async () => null });
  try {
    await service.enqueue(anime, [1], { animeId: 1, episode: 1, audio: 'dub' }, 720);
    await waitFor(async () => (await service.list()).downloads[0].episodes[0].status === 'complete');
    assert.deepEqual(attempts, [[], ['reanime:broken']]);
    const saved = (await service.list()).downloads[0];
    assert.equal(saved.episodes[0].playback?.server.id, 'backup');
    const state = JSON.parse(await readFile(join(folder, 'state.json'), 'utf8'));
    assert.doesNotMatch(await readFile(join(state.jobs[0].directory, 'episode-1', '0.m3u8'), 'utf8'), /broken|partial/);
  } finally { await service.close(); await rm(folder, { recursive: true, force: true }); }
});

test('cancelling an active series removes partial files and leaves the next series running', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'moewatch-download-cancel-'));
  let entered = false;
  const service = new DownloadService({ stateFile: join(folder, 'state.json'), defaultLocation: join(folder, 'videos'), read: async (url, signal) => {
    if (url !== 'slow') return reader(url, signal);
    entered = true;
    return { type: 'video/mp4', length: 100, body: (async function* () {
      yield Buffer.from('partial');
      await new Promise<void>((_resolve, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
    })() };
  }, resolve: async request => ({ ...playback, sources: [{ url: request.animeId === 1 ? 'slow' : 'master', type: request.animeId === 1 ? 'mp4' : 'hls' }] }), artwork: async url => url, thumbnail: async () => null });
  try {
    const job = await service.enqueue(anime, [1], { animeId: 1, episode: 1 }, 720);
    await service.enqueue({ ...anime, id: 2 }, [1], { animeId: 2, episode: 1 }, 720);
    await waitFor(async () => entered && (await service.list()).downloads.find(item => item.id === job.id)!.bytesPerSecond! > 0);
    const transferring = (await service.list()).downloads.find(item => item.id === job.id)!;
    assert.equal(Number.isFinite(transferring.remainingSeconds), true);
    await service.remove(job.id);
    await waitFor(async () => (await service.list()).downloads[0].episodes[0].status === 'complete');
    assert.equal((await service.list()).downloads[0].anime.id, 2);
    assert.equal((await service.list()).downloads.length, 1);
  } finally { await service.close(); await rm(folder, { recursive: true, force: true }); }
});

test('corrupt download paths fail before resuming or deleting files', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'moewatch-download-index-'));
  const stateFile = join(folder, 'state.json');
  const id = '11111111-1111-4111-8111-111111111111';
  try {
    for (const job of [
      { id, directory: folder, files: {}, episodes: [] },
      { id, directory: join(folder, `moewatch-${id}`), files: {}, episodes: [{ number: '../outside', status: 'queued' }] },
    ]) {
      await writeFile(stateFile, JSON.stringify({ version: 1, location: folder, jobs: [job] }));
      const service = new DownloadService({ stateFile, read: reader, resolve: async () => { throw new Error('Must not resume'); }, artwork: async url => url, thumbnail: async () => null });
      await assert.rejects(service.list(), /Could not read the downloads index/);
      await assert.rejects(service.remove(id), /Could not read the downloads index/);
      await service.close();
      assert.ok(await readFile(stateFile));
    }
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('download API validates requests and keeps folder changes behind same-origin checks', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'moewatch-download-api-'));
  const server = createApiServer({ downloadStateFile: join(folder, 'state.json'), downloadLocation: join(folder, 'videos'), providers: [], episodeMetadata: async anime => anime, catalog: { anime: async () => anime, search: async () => [anime] } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  try {
    const response = await fetch(`${root}/downloads`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.downloads, []);
    assert.equal(body.location, join(folder, 'videos'));
    const post = (body: unknown) => fetch(`${root}/downloads`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post({ animeId: 1, audio: 'fr' })).status, 400);
    assert.equal((await post({ animeId: 1, quality: 999 })).status, 400);
    assert.equal((await post({ animeId: 1 })).status, 503);
    assert.equal((await fetch(`${root}/downloads/location`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: '../outside' }) })).status, 400);
    assert.equal((await fetch(`${root}/downloads/location`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' }, body: JSON.stringify({ location: join(folder, 'other') }) })).status, 403);
  } finally { server.close(); await rm(folder, { recursive: true, force: true }); }
});

test('next episode resolves before the current download finishes, and expiring prefetches resolve again', async () => {
  for (const expiresSoon of [false, true]) {
    const folder = await mkdtemp(join(tmpdir(), 'moewatch-prefetch-'));
    const calls: number[] = [];
    let release!: () => void;
    const finish = new Promise<void>(resolve => { release = resolve; });
    const service = new DownloadService({ stateFile: join(folder, 'state.json'), defaultLocation: join(folder, 'videos'), artwork: async url => url, thumbnail: async () => null,
      resolve: async request => {
        calls.push(request.episode);
        return { ...playback, episode: request.episode, expiresAt: request.episode === 2 && expiresSoon ? Date.now() + 1000 : Date.now() + 120000, subtitles: [], sources: [{ url: `episode-${request.episode}`, type: 'mp4' }] };
      },
      read: async (url, signal) => {
        if (!url.startsWith('episode-')) return reader(url, signal);
        return { type: 'video/mp4', length: 1000, body: (async function* () {
          yield Buffer.alloc(900);
          if (url === 'episode-1') await finish;
          signal.throwIfAborted(); yield Buffer.alloc(100);
        })() };
      },
    });
    try {
      await service.enqueue(anime, [1, 2], { animeId: 1, episode: 1 }, 720);
      await waitFor(async () => calls.includes(2));
      const before = (await service.list()).downloads[0];
      assert.equal(before.episodes[0].status, 'downloading');
      assert.equal(before.episodes[1].status, 'queued');
      release();
      await waitFor(async () => (await service.list()).downloads[0].episodes.every(episode => episode.status === 'complete'));
      assert.deepEqual(calls, expiresSoon ? [1, 2, 2] : [1, 2]);
    } finally { release(); await service.close(); await rm(folder, { recursive: true, force: true }); }
  }
});

test('cancelling while waiting for a prefetched source aborts that resolution', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'moewatch-prefetch-cancel-'));
  let prefetchedSignal: AbortSignal | undefined;
  const service = new DownloadService({ stateFile: join(folder, 'state.json'), defaultLocation: join(folder, 'videos'), artwork: async url => url, thumbnail: async () => null, read: reader,
    resolve: async (request, signal) => {
      if (request.episode === 1) return playback;
      prefetchedSignal = signal;
      return new Promise<PlaybackResponse>((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
    },
  });
  try {
    const job = await service.enqueue(anime, [1, 2], { animeId: 1, episode: 1 }, 720);
    await waitFor(async () => (await service.list()).downloads[0].episodes[1].status === 'downloading');
    await service.remove(job.id);
    assert.equal(prefetchedSignal?.aborted, true);
    assert.equal((await service.list()).downloads.length, 0);
  } finally { await service.close(); await rm(folder, { recursive: true, force: true }); }
});

test('a prefetch that takes over a minute resolves again before use', async context => {
  const folder = await mkdtemp(join(tmpdir(), 'moewatch-prefetch-age-'));
  const now = Date.now();
  let elapsed = 0, calls = 0;
  context.mock.method(Date, 'now', () => now + elapsed);
  let release!: () => void;
  const finish = new Promise<void>(resolve => { release = resolve; });
  const service = new DownloadService({ stateFile: join(folder, 'state.json'), defaultLocation: join(folder, 'videos'), artwork: async url => url, thumbnail: async () => null, read: reader,
    resolve: async request => {
      if (request.episode === 2 && ++calls === 1) await finish;
      return playback;
    },
  });
  try {
    await service.enqueue(anime, [1, 2], { animeId: 1, episode: 1 }, 720);
    await waitFor(async () => (await service.list()).downloads[0].episodes[1].status === 'downloading');
    elapsed = 61000;
    release();
    await waitFor(async () => (await service.list()).downloads[0].episodes.every(episode => episode.status === 'complete'));
    assert.equal(calls, 2);
  } finally { release(); await service.close(); await rm(folder, { recursive: true, force: true }); }
});
