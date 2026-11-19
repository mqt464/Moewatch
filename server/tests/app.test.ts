import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { get } from 'node:http';
import type { AnimeProvider } from '../providers/types';
import type { Anime } from '../../src/catalog';
import { createServer } from '../app';
import { createMediaProxy } from '../infrastructure/media';
import { ApiError } from '../infrastructure/errors';
import { mkissa } from '../providers/mkissa';

const anime: Anime = { id: 1, title: 'Example', romaji: 'Example', description: '', cover: '', banner: '', year: 2024, format: 'TV', episodes: 12, duration: 24, score: 80, genres: ['Action'], status: 'FINISHED', studios: [], characters: [], related: [] };
const catalog = { async search() { return [anime]; }, async anime(id: number) { return id === 1 ? anime : null; } };

function provider(id: AnimeProvider['id'], resolveUrl = 'http://8.8.8.8/video.m3u8'): AnimeProvider {
  return {
    id, name: id, configured: true,
    async search() { return []; },
    async match() { return { status: 'matched', title: { id: 'title', title: 'Example' } }; },
    async episodes() { return [{ id: 'episode-1', number: 1, kind: 'regular', audio: ['sub', 'dub'] }]; },
    async servers() { return [{ id: `${id}-server`, name: 'Main', audio: 'sub' }]; },
    async resolve() { return { sources: [{ url: resolveUrl, type: 'hls' }], subtitles: [], mediaEncryption: { type: 'gotaku', keySeed: Buffer.alloc(32, 1).toString('base64url'), segmentBytes: 8192 }, playlistKey: Buffer.alloc(32, 7).toString('base64'), audioLanguage: 'ja', headers: { Referer: 'https://example.org', Authorization: 'secret' } }; },
  };
}

const server = createServer({ episodeMetadata: async anime => anime, catalog, providers: [provider('reanime', 'http://127.0.0.1/video.m3u8'), provider('anikoto')] });
let root = '';
before(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

test('Discord presence validates requests and does not claim a paused player', async () => {
  const post = (body: unknown, headers = { 'content-type': 'application/json' }) => fetch(`${root}/api/v1/discord/presence`, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ session: 42, clear: true })).status, 400);
  assert.equal((await post({}, { 'content-type': 'text/plain' })).status, 415);
  const response = await post({ session: 'test-viewer', animeId: 1, episode: 1, time: 10, duration: 1440, rate: 1, paused: true });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { accepted: false });
  assert.equal((await post({ session: 'test-viewer', clear: true })).status, 200);
});

test('catalog and anime response contract', async () => {
  const catalogResult = await (await fetch(`${root}/api/v1/catalog?genre=Action`)).json();
  assert.deepEqual(catalogResult, { anime: [anime] });
  const missing = await (await fetch(`${root}/api/v1/anime/2`)).json();
  assert.deepEqual(missing, { anime: null });
});

test('availability and canonical episode routes', async () => {
  const availability = await (await fetch(`${root}/api/v1/anime/1/availability`)).json();
  assert.equal(availability.providers.length, 2);
  assert.equal(availability.providers[0].status, 'available');
  const episodes = await (await fetch(`${root}/api/v1/anime/1/episodes?provider=anikoto&audio=dub`)).json();
  assert.equal(episodes.episodes[0].id, 'episode-1');
  const servers = await (await fetch(`${root}/api/v1/anime/1/episodes/1/servers?provider=anikoto&audio=sub`)).json();
  assert.equal(servers.episodeId, 'episode-1');
});

test('playback records failed server and returns opaque media URL', async () => {
  const response = await fetch(`${root}/api/v1/playback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ animeId: 1, episode: 1, audio: 'sub' }) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.provider, 'anikoto');
  assert.equal(result.attempts[0].code, 'UPSTREAM_BLOCKED');
  assert.match(result.sources[0].url, /^\/media\/[A-Za-z0-9_-]+$/);
  assert.equal(JSON.stringify(result).includes('Authorization'), false);
  assert.equal(JSON.stringify(result).includes('8.8.8.8'), false);
  assert.equal(result.playlistKey, undefined);
  assert.equal(result.audioLanguage, undefined);
  assert.equal(result.mediaEncryption, undefined);
  assert.equal(JSON.stringify(result).includes(Buffer.alloc(32, 7).toString('base64')), false);
});

test('media token creation rejects private hosts and credentials', async () => {
  const media = createMediaProxy();
  await assert.rejects(media.issue('http://127.0.0.1/stream'), { code: 'UPSTREAM_BLOCKED' });
  await assert.rejects(media.issue('https://user:pass@8.8.8.8/stream'), { code: 'UNSUPPORTED_MEDIA' });
});

test('availability keeps other providers when a match is ambiguous', async () => {
  const ambiguous: AnimeProvider = { ...provider('miruro'), async match() { return { status: 'ambiguous', candidates: [{ id: 'a', title: 'Example' }, { id: 'b', title: 'Example' }] }; } };
  const instance = createServer({ episodeMetadata: async anime => anime, catalog, providers: [ambiguous, provider('anikoto')] });
  await new Promise<void>(resolve => instance.listen(0, '127.0.0.1', resolve));
  try {
    const address = `http://127.0.0.1:${(instance.address() as AddressInfo).port}`;
    const result = await (await fetch(`${address}/api/v1/anime/1/availability`)).json();
    assert.equal(result.providers[0].status, 'ambiguous');
    assert.equal(result.providers[0].error.code, 'AMBIGUOUS_MATCH');
    assert.equal(result.providers[1].status, 'available');
  } finally { instance.close(); }
});

test('API rejects cross-origin requests and unknown Host headers', async () => {
  const response = await fetch(`${root}/api/v1/providers`, { headers: { Origin: 'https://untrusted.example' } });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  const rebinding = await new Promise<number | undefined>((resolve, reject) => {
    get(`${root}/api/v1/providers`, { headers: { Host: 'untrusted.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(rebinding, 403);
});

test('fallback tries another server without leaking headers or switching audio', async () => {
  const source = provider('anikoto');
  source.servers = async () => [{ id: 'bad', name: 'Bad', audio: 'dub' }, { id: 'good', name: 'Good', audio: 'dub' }, { id: 'sub-only', name: 'Sub', audio: 'sub' }];
  const resolved: string[] = [];
  source.resolve = async id => {
    resolved.push(id);
    if (id === 'bad') throw new ApiError('UPSTREAM_BLOCKED', 'Server blocked');
    return { sources: [{ url: 'https://8.8.8.8/stream.m3u8', type: 'hls' }], subtitles: [] };
  };
  const instance = createServer({ episodeMetadata: async anime => anime, catalog, providers: [source] });
  await new Promise<void>(resolve => instance.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(instance.address() as AddressInfo).port}/api/v1/playback`;
  try {
    const request = { animeId: 1, episode: 1, provider: 'anikoto', audio: 'dub', serverId: 'bad' };
    const response = await fetch(endpoint, { method: 'POST', body: JSON.stringify(request) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.audio, 'dub');
    assert.equal(result.server.id, 'good');
    assert.deepEqual(resolved, ['bad', 'good']);
    assert.equal(result.attempts[0].code, 'UPSTREAM_BLOCKED');
    assert.ok(result.expiresAt > Date.now() + 60 * 60_000);
    resolved.length = 0;
    const strict = await fetch(endpoint, { method: 'POST', body: JSON.stringify({ ...request, fallback: false }) });
    assert.equal(strict.status, 503);
    assert.deepEqual(resolved, ['bad']);
  } finally { instance.closeAllConnections(); await new Promise<void>(resolve => instance.close(() => resolve())); }
});

test('unknown catalogue audio requires an actual matching server and never downgrades a dub', async () => {
  const unknown = provider('miruro');
  unknown.episodes = async () => [{ id: 'unknown', number: 1, kind: 'regular', audio: [], audioStatus: 'unknown' }];
  const resolved: string[] = [];
  unknown.resolve = async id => { resolved.push(id); return { sources: [{ url: 'https://8.8.8.8/test.mp4', type: 'mp4' }], subtitles: [] }; };
  for (const dubAvailable of [false, true]) {
    unknown.servers = async () => [{ id: 'sub-only', name: 'Sub', audio: 'sub' }, ...(dubAvailable ? [{ id: 'dub', name: 'Dub', audio: 'dub' as const }] : [])];
    const instance = createServer({ catalog, providers: [unknown] });
    await new Promise<void>(resolve => instance.listen(0, '127.0.0.1', resolve));
    const root = `http://127.0.0.1:${(instance.address() as AddressInfo).port}/api/v1`;
    try {
      const post = () => fetch(`${root}/playback`, { method: 'POST', body: JSON.stringify({ animeId: 1, episode: 1, provider: 'miruro', audio: 'dub', fallback: false }) });
      const playback = await post();
      assert.equal(playback.status, dubAvailable ? 200 : 503);
      assert.deepEqual(resolved, dubAvailable ? ['dub'] : []);
      if (dubAvailable) assert.equal((await playback.json()).audio, 'dub');
      const response = await fetch(`${root}/anime/1/episodes?provider=miruro&audio=dub`);
      assert.equal((await response.json()).episodes.length, 1);
    } finally { instance.closeAllConnections(); await new Promise<void>(resolve => instance.close(() => resolve())); }
  }
});

test('AniSkip endpoint rejects invalid identity and runtime before contacting upstreams', async () => {
 for (const path of ['anime/1/skip-times/1','anime/1/skip-times/1?duration=Infinity','anime/1/skip-times/1?duration=-1','anime/1/skip-times/1?duration=86401','anime/0/skip-times/1?duration=100']) {
  const response=await fetch(`${root}/api/v1/${path}`);assert.equal(response.status,400);assert.equal((await response.json()).error.code,'INVALID_REQUEST');
 }
});

test('series details enrich episode fields while search and playback availability bypass enrichment', async () => {
  let enrichments = 0;
  const instance = createServer({ catalog, providers: [], episodeMetadata: async anime => {
    enrichments++;
    return { ...anime, episodeArtwork: [{ number: 1, title: 'Enriched episode', thumbnail: 'https://example.com/episode.jpg' }] };
  } });
  await new Promise<void>(resolve => instance.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(instance.address() as AddressInfo).port}/api/v1`;
  try {
    await fetch(`${endpoint}/catalog`); assert.equal(enrichments, 0);
    const result = await (await fetch(`${endpoint}/anime/1`)).json();
    assert.equal(result.anime.episodeArtwork[0].title, 'Enriched episode');
    await fetch(`${endpoint}/anime/1/availability`); assert.equal(enrichments, 1);
  } finally { instance.closeAllConnections(); await new Promise<void>(resolve => instance.close(() => resolve())); }
});

test('thumbnail source order skips providers for metadata images and caches provider resolution', async () => {
  let resolutions = 0;
  const source = provider('anikoto');
  source.resolve = async () => { resolutions++; return { sources: [], subtitles: [], thumbnail: 'https://8.8.8.8/episode.jpg', headers: { Referer: 'https://player.example/' } }; };
  let metadataImage = true;
  const instance = createServer({ catalog, providers: [source], episodeMetadata: async anime => ({ ...anime, episodeArtwork: metadataImage ? [{ number: 1, title: 'Metadata', thumbnail: 'https://8.8.8.8/kitsu.jpg' }] : [] }) });
  await new Promise<void>(resolve => instance.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(instance.address() as AddressInfo).port}/api/v1/anime/1/episodes/1/thumbnail`;
  try {
    let response = await fetch(endpoint, { redirect: 'manual' });
    assert.equal(response.status, 302); assert.equal(resolutions, 0);
    assert.match(response.headers.get('location')!, /^\/media\/[\w-]+$/);
    metadataImage = false;
    response = await fetch(endpoint, { redirect: 'manual' });
    assert.equal(response.status, 302); assert.equal(resolutions, 1);
    const first = response.headers.get('location');
    response = await fetch(endpoint, { redirect: 'manual' });
    assert.equal(response.headers.get('location'), first); assert.equal(resolutions, 1);
    assert.ok(!JSON.stringify([...response.headers]).includes('player.example'));
    assert.ok(!JSON.stringify([...response.headers]).includes('8.8.8.8'));
  } finally { instance.closeAllConnections(); await new Promise<void>(resolve => instance.close(() => resolve())); }
});

test('thumbnail lookup rejects private images and caches unavailable results without breaking detail pages', async () => {
  let resolutions = 0;
  const source = provider('anikoto');
  source.resolve = async () => { resolutions++; return { sources: [], subtitles: [], thumbnail: 'http://127.0.0.1/private.jpg' }; };
  const instance = createServer({ catalog, providers: [source], episodeMetadata: async anime => anime });
  await new Promise<void>(resolve => instance.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(instance.address() as AddressInfo).port}/api/v1`;
  try {
    for (let i = 0; i < 2; i++) assert.equal((await fetch(`${endpoint}/anime/1/episodes/1/thumbnail`)).status, 404);
    assert.equal(resolutions, 1);
    assert.equal((await fetch(`${endpoint}/anime/1`)).status, 200);
    assert.equal((await fetch(`${endpoint}/anime/1/episodes/0/thumbnail`)).status, 400);
    assert.equal((await fetch(`${endpoint}/anime/1/episodes/10001/thumbnail`)).status, 404);
  } finally { instance.closeAllConnections(); await new Promise<void>(resolve => instance.close(() => resolve())); }
});


test('MKissa remains unavailable through production API routes without contacting upstream', async t => {
  const methods = ['search', 'match', 'episodes', 'servers', 'resolve'] as const;
  for (const method of methods) t.mock.method(mkissa, method, async () => assert.fail('Disabled MKissa must not contact upstream'));
  const app = createServer({ catalog, providers: [mkissa], episodeMetadata: async anime => anime });
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => app.close(error => error ? reject(error) : resolve())));
  const base = 'http://127.0.0.1:' + (app.address() as AddressInfo).port + '/api/v1/';
  const status = await (await fetch(base + 'providers')).json();
  assert.equal(status.providers[0].configured, false);
  assert.equal(status.providers[0].status, 'unconfigured');
  const availability = await (await fetch(base + 'anime/1/availability')).json();
  assert.equal(availability.providers[0].error.code, 'UNAVAILABLE');
  const playback = await fetch(base + 'playback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ animeId: 1, episode: 1, provider: 'mkissa', fallback: false }) });
  assert.equal(playback.status, 503);
  const download = await fetch(base + 'downloads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ animeId: 1, provider: 'mkissa', fallback: false }) });
  assert.equal(download.status, 503);
});
