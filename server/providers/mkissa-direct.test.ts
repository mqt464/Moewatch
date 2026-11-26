import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash, createHmac } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { decodeMkissaBootstrap, decodeMkissaPayload, mkissaBootstrapProof, mkissaBuild, mkissaEpochMs, mkissaRequestEnvelope } from '../extractors/mkissa-crypto';
import { idDecode, idEncode } from './common';
import { mkissa } from './mkissa';

const titleId = 'Qwi4hM3qzcwv9Rbaa';
const episodeId = idEncode({ titleId, episode: '1' });
const hash = '670bbf38d0868f446e2346c1e956ca2c40c416e733ca248fd54e04f1c8b99145';
const mask = Buffer.from('nBKBEWrlVikc0SV8gUw5hWidhrgmx1tiXLFUQnDKUXI=', 'base64');
const bootstrap = () => ({ epoch: Math.floor(Date.now() / mkissaEpochMs), epochMs: mkissaEpochMs,
  k: 'k7', switchAt: Date.now() + 3_600_000, partB: Buffer.alloc(32, 85).toString('base64') });
function packet(body: unknown, key: Buffer) {
  const iv = Buffer.alloc(12, 19), cipher = createCipheriv('aes-256-gcm', key, iv);
  return Buffer.concat([Buffer.from([1]), iv, cipher.update(JSON.stringify(body)), cipher.final(), cipher.getAuthTag()]).toString('base64');
}

test('MKissa build-193 proof, request envelope and authenticated response match the public protocol', () => {
  const epoch = 5, now = 1_795_660_000_000;
  const proofKey = createHmac('sha256', mask).update('ueQcEF8Ty:193').digest();
  assert.equal(mkissaBootstrapProof(epoch), createHmac('sha256', proofKey).update('k7:193:youtu-chan.com:mirror:5').digest('hex'));
  const key = Buffer.alloc(32, 17), encoded = mkissaRequestEnvelope(key, epoch, hash, now);
  const bytes = Buffer.from(encoded, 'base64'), iv = bytes.subarray(1, 13), ts = Math.floor(now / 300_000) * 300_000;
  assert.deepEqual(iv, createHash('sha256').update(`${epoch}:193:${hash}:${ts}:k7`).digest().subarray(0, 12));
  const cipher = createDecipheriv('aes-256-gcm', key, iv);
  cipher.setAuthTag(bytes.subarray(-16));
  assert.deepEqual(JSON.parse(Buffer.concat([cipher.update(bytes.subarray(13, -16)), cipher.final()]).toString()),
    { v: 1, ts, epoch, buildId: '193', qh: hash, k: 'k7' });
  assert.deepEqual(decodeMkissaPayload(packet({ episode: { episodeString: '1' } }, key), key), { episode: { episodeString: '1' } });
  bytes[bytes.length - 1] ^= 1;
  assert.throws(() => decodeMkissaPayload(bytes.toString('base64'), key), { code: 'UPSTREAM_ERROR' });
});

test('MKissa rejects expired or mismatched bootstraps and malformed encrypted frames', () => {
  const valid = bootstrap();
  for (const value of [{ ...valid, k: 'k9' }, { ...valid, epoch: valid.epoch + 1 },
    { ...valid, switchAt: Date.now() - 1 }, { ...valid, partB: 'bad' }, { ...valid, epochMs: 604800000 }]) {
    assert.throws(() => decodeMkissaBootstrap(value, valid.epoch), { code: 'UPSTREAM_ERROR' });
  }
  const session = decodeMkissaBootstrap(valid, valid.epoch);
  assert.deepEqual(session.key, Buffer.from(mask.map(byte => byte ^ 85)));
  for (const value of [undefined, '', '!!', Buffer.alloc(30).toString('base64')]) {
    assert.throws(() => decodeMkissaPayload(value, session.key), { code: 'UPSTREAM_ERROR' });
  }
});

function pipeline(t: TestContext, change: { identityAudio?: string; pageTitle?: string; showTitle?: string; host?: string; expired?: boolean; captcha?: boolean; corrupt?: boolean; embedOnly?: boolean; mp4?: boolean } = {}) {
  const boot = bootstrap(), session = decodeMkissaBootstrap(boot, boot.epoch);
  let queries = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin === 'https://www.mp4upload.com' && change.mp4) {
      assert.equal(url.pathname, '/embed-abcdefgh1234.html');
      return new Response(`player.src({src:"https://a1.mp4upload.com:183/d/${'a'.repeat(64)}/video.mp4"})`);
    }
    assert.equal(url.origin, 'https://api.mkissa.net');
    assert.equal(init?.redirect, 'error');
    const headers = new Headers(init?.headers);
    if (url.pathname === '/client-crypto/v1/bootstrap') {
      assert.equal(headers.get('x-aa-boot'), mkissaBootstrapProof(boot.epoch));
      assert.equal(headers.get('x-build-id'), mkissaBuild);
      assert.equal(headers.get('origin'), 'https://youtu-chan.com');
      return Response.json(boot);
    }
    const extensions = JSON.parse(url.searchParams.get('extensions') ?? '{}');
    if (extensions.persistedQuery?.sha256Hash !== hash) return Response.json({ data: { show: {
      _id: titleId, availableEpisodesDetail: { sub: ['1'], dub: ['1'] }
    } } });
    const variables = JSON.parse(url.searchParams.get('variables') ?? '{}');
    assert.equal(headers.get('referer'), 'https://youtu-chan.com/');
    assert.equal(headers.get('x-build-id'), mkissaBuild);
    const signed = decodeMkissaPayload(extensions.aaReq, session.key);
    assert.equal(typeof signed, 'object');
    if (change.captcha) return Response.json({ errors: [{ message: 'NEED_CAPTCHA' }], data: { episode: null } });
    const audio = variables.translationType;
    const token = `fixture.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + (change.expired ? -60 : 3600), query: ++queries })).toString('base64url')}.signature`;
    const sourceUrl = `https://${change.host ?? 'tools.fast4speed.rsvp'}/media7/videos/fixture/${audio}/1?Authorization=${token}`;
    const data = { episode: { episodeString: '1', show: { _id: change.showTitle ?? titleId },
      pageStatus: { pageId: `anime-${change.pageTitle ?? titleId}_${change.identityAudio ?? audio}_1` },
      sourceUrls: change.embedOnly ? [{ sourceName: 'Fm-Hls', type: 'iframe', sourceUrl: 'https://bysekoze.com/e/fixture' }] : [
        { sourceName: 'Yt-mp4', type: 'player', fileExtenstion: 'mp4', sourceUrl },
        ...(change.mp4 ? [{ sourceName: 'Mp4', type: 'iframe', sourceUrl: 'https://mp4upload.com/embed-abcdefgh1234.html' }] : []),
        { sourceName: 'Fm-Hls', type: 'iframe', sourceUrl: 'https://bysekoze.com/e/fixture' }
      ] } };
    let encrypted = packet(data, session.key);
    if (change.corrupt) {
      const bytes = Buffer.from(encrypted, 'base64'); bytes[bytes.length - 1] ^= 1; encrypted = bytes.toString('base64');
    }
    return Response.json({ data: { _m: {}, tobeparsed: encrypted } });
  });
  return { queries: () => queries };
}

test('MKissa advertises only verified direct servers, separates audio and resolves signed URLs fresh', async t => {
  const fixture = pipeline(t), signal = new AbortController().signal;
  const servers = await mkissa.servers(episodeId, signal);
  assert.deepEqual(servers.map(s => s.audio), ['sub', 'dub']);
  assert(!JSON.stringify(servers).includes('Authorization'));
  assert(!JSON.stringify(servers).includes('fixture.'));
  assert.deepEqual(idDecode(servers[1].id, 'mkissa'), { titleId, episode: '1', audio: 'dub', source: 'Yt-mp4' });
  const playback = await mkissa.resolve(servers[1].id, signal);
  assert.equal(fixture.queries(), 3);
  assert.equal(playback.sources[0].type, 'mp4');
  assert(new URL(playback.sources[0].url).pathname.endsWith('/dub/1'));
  assert(playback.expiresAt! > Date.now());
  assert.deepEqual(playback.headers, { Referer: 'https://filelotion.fyi/' });
});

test('MKissa exposes Mp4 for both audio tracks and resolves it through the direct extractor', async t => {
  const fixture = pipeline(t, { mp4: true }), signal = new AbortController().signal;
  const servers = await mkissa.servers(episodeId, signal);
  assert.deepEqual(servers.map(s => s.name), ['MKissa Yt-mp4 (sub)', 'MKissa Mp4 (sub)', 'MKissa Yt-mp4 (dub)', 'MKissa Mp4 (dub)']);
  assert.deepEqual(idDecode(servers[3].id, 'mkissa'), { titleId, episode: '1', audio: 'dub', source: 'Mp4' });
  const playback = await mkissa.resolve(servers[3].id, signal);
  assert.equal(fixture.queries(), 3);
  assert.equal(playback.sources[0].type, 'mp4');
  assert.equal(new URL(playback.sources[0].url).hostname, 'a1.mp4upload.com');
  assert.deepEqual(playback.headers, { Referer: 'https://www.mp4upload.com/' });
});

test('MKissa rejects audio downgrade, bad authentication and required upstream CAPTCHA', async t => {
  for (const [change, code] of [
    [{ identityAudio: 'sub' }, 'UPSTREAM_ERROR'], [{ showTitle: 'other' }, 'UPSTREAM_ERROR'],
    [{ pageTitle: 'invalid-title' }, 'UPSTREAM_ERROR'], [{ corrupt: true }, 'UPSTREAM_ERROR'], [{ captcha: true }, 'UPSTREAM_BLOCKED']
  ] as const) {
    await t.test(code + JSON.stringify(change), async t => {
      pipeline(t, change);
      const id = idEncode({ titleId, episode: '1', audio: 'dub', source: 'Yt-mp4' });
      await assert.rejects(mkissa.resolve(id, new AbortController().signal), { code });
    });
  }
});

test('MKissa accepts legacy page IDs while checking the authoritative show, episode and audio', async t => {
  pipeline(t, { pageTitle: 'LegacyTitle123' });
  const playback = await mkissa.resolve(idEncode({ titleId, episode: '1', audio: 'sub', source: 'Yt-mp4' }), new AbortController().signal);
  assert.equal(playback.sources[0].type, 'mp4');
});

test('MKissa does not expose unsafe, expired or embed-only sources', async t => {
  for (const change of [{ host: '127.0.0.1' }, { host: 'tools.fast4speed.rsvp.evil.test' }, { expired: true }, { embedOnly: true }]) {
    await t.test(JSON.stringify(change), async t => {
      pipeline(t, change);
      assert.deepEqual(await mkissa.servers(episodeId, new AbortController().signal), []);
    });
  }
});
