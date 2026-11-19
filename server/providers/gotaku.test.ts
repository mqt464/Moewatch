import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash, hkdfSync } from 'node:crypto';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { decodeGotakuApi, decodeGotakuPlaylist, decodeGotakuSegment, gotakuEmbedUrl, gotakuManifestAttributes } from '../extractors/gotaku';
import { idDecode } from './common';
import fixture from './fixtures/gotaku.json';
import { gotaku, resolveGotakuServer } from './gotaku';

const signal = new AbortController().signal;
const staticIv = Buffer.alloc(12, 7);
const derive = (key: Buffer, salt: Buffer | string, info: string) => Buffer.from(hkdfSync('sha256', key, salt, info, 32));
const seal = (bytes: Buffer, key: Buffer) => {
  const cipher = createCipheriv('aes-256-gcm', key, staticIv);
  return Buffer.concat([staticIv, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
};
const packet = (value: unknown) => Buffer.concat([Buffer.of(10), seal(deflateSync(JSON.stringify(value)), derive(
  Buffer.from('1e63ceecb01ae4933723987b06117eb328b5c5d2c25ae823f714822b47757b52', 'hex'), Buffer.alloc(0), 'api-seal|v1',
))]);
const playerKey = Buffer.from('458e5403c40a73332706df406193dd6b040a2ea97a6bb59b52b294a61006e6ef', 'hex');
const seed = Buffer.alloc(32, 11);
const token = 'f'.repeat(22);
const source = `https://fixture.example.top/p/1/2000000000/${token}/master`;
const stamp = '1999999999.fixture_stamp_token';
const embed = `<body data-manifest-base="https://gotakuplay.nl/embed/313630/manifest" data-manifest-stamp="${stamp}">`;

test('matches by AniList ID, maps explicit episode tracks and resolves the player handshake', async t => {
  const requests: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL, init: RequestInit) => {
    const url = new URL(input);
    assert.equal(init.redirect, 'error');
    requests.push(url);
    switch (url.pathname) {
      case '/api/v1/titles':
        assert.equal(url.searchParams.get('q'), 'Cowboy Bebop');
        return Response.json(fixture.search);
      case '/api/v1/titles/g0srsw':
        return Response.json(fixture.details.g0srsw);
      case '/api/v1/titles/iqfjuh':
        return Response.json(fixture.details.iqfjuh);
      case '/api/v1/titles/a5c0j6/episodes':
        assert.equal(url.searchParams.get('k'), '10');
        return new Response(new Uint8Array(packet(fixture.episodes)));
      case '/api/v1/episodes/pzcaix':
        return new Response(new Uint8Array(packet(fixture.episode)));
      case '/api/v1/episodes/pzcaix/embed':
        assert.equal(url.searchParams.get('type'), 'hard_sub');
        return new Response(new Uint8Array(packet(fixture.embed)));
      case '/embed/fixture':
        assert.equal(url.origin, 'https://gotakuplay.nl');
        return new Response(embed);
    }
    assert.match(url.pathname, /^\/embed\/313630\/manifest\//);
    assert.equal(url.origin, 'https://gotakuplay.nl');
    assert.equal(new Headers(init.headers).get('Accept'), 'text/plain');
    const challenge = Buffer.from(url.pathname.split('/').at(-1)!, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', playerKey, challenge.subarray(0, 12));
    decipher.setAuthTag(challenge.subarray(-16));
    const request = JSON.parse(Buffer.concat([decipher.update(challenge.subarray(12, -16)), decipher.final()]).toString());
    assert.equal(request.stamp, stamp);
    const nonce = Buffer.from(request.nonce, 'base64url');
    assert.equal(nonce.length, 16);
    const body = Buffer.from(JSON.stringify({ source, keySeed: seed.toString('base64url'), token, expiresAt: 2000000000, obf: { version: 1, segmentBytes: 8192 } }));
    return new Response(seal(body, derive(playerKey, nonce, 'manifest-resp|v1')).toString('base64url'));
  });

  const identity = { id: 1, title: 'Cowboy Bebop', romaji: 'Cowboy Bebop', year: 1998, format: 'TV', episodes: 26 };
  assert.deepEqual(await gotaku.match(identity, signal), {
    status: 'matched', title: { id: 'g0srsw', title: 'Cowboy Bebop', year: 1998, format: 'TV', anilistId: 1 },
  });
  assert.deepEqual(await gotaku.match({ ...identity, id: 500 }, signal), { status: 'not-found' });
  const episodes = await gotaku.episodes('a5c0j6', signal);
  assert.deepEqual(episodes.map(episode => episode.audio), [['sub', 'dub'], ['sub']]);
  const servers = await gotaku.servers(episodes[0].id, signal);
  assert.deepEqual(servers.map(server => idDecode(server.id, 'gotaku')), [
    { episode: 'pzcaix', track: 'hard_sub' },
    { episode: 'pzcaix', track: 'dub' },
  ]);
  const result = await resolveGotakuServer(servers[0].id, signal);
  assert.equal(result.sources[0].url, source);
  assert.equal(result.expiresAt, 2000000000000);
  assert.deepEqual(result.intro, { start: 0, end: 118 });
  assert.equal(result.headers.Origin, 'https://gotakuplay.nl');
  assert.equal((await gotaku.resolve(servers[0].id, signal)).sources[0].type, 'hls');
  const count = requests.length;
  await assert.rejects(gotaku.episodes('../x', signal), { code: 'INVALID_REQUEST' });
  const reason = Error('canceled');
  await assert.rejects(resolveGotakuServer(servers[0].id, AbortSignal.abort(reason)), reason);
  assert.equal(requests.length, count);
});

test('rejects malformed ciphertext and unsafe embed or manifest URLs', () => {
  const encoded = packet(fixture.episode);
  assert.deepEqual(decodeGotakuApi(encoded), fixture.episode);
  encoded[encoded.length - 1] ^= 1;
  assert.throws(() => decodeGotakuApi(encoded), { code: 'UPSTREAM_ERROR' });
  for (const url of ['http://gotakuplay.nl/embed/a', 'https://gotakuplay.nl.evil.top/embed/a', 'https://localhost/embed/a', 'https://user@gotakuplay.nl/embed/a']) {
    assert.throws(() => gotakuEmbedUrl(url), { code: 'UNSUPPORTED_MEDIA' });
  }
  assert.throws(() => gotakuManifestAttributes(embed.replace('gotakuplay.nl', '127.0.0.1')), { code: 'UNSUPPORTED_MEDIA' });
});

test('decrypts extensionless HLS and segment ranges across the clear boundary', () => {
  const manifest = { source, keySeed: seed.toString('base64url'), token, expiresAt: 2000000000000, segmentBytes: 8192 as const };
  const text = '#EXTM3U\n#EXTINF:5,\nhttps://fixture.example.top/s/1/segment.jpg\n';
  const encryptedPlaylist = seal(Buffer.from(text), derive(seed, token, 'pl|v1'));
  assert.equal(decodeGotakuPlaylist(encryptedPlaylist, new URL(source), manifest), text);

  const clear = Buffer.alloc(9000, 0x47);
  const iv = Buffer.alloc(16);
  createHash('sha256').update('segment').digest().copy(iv, 0, 0, 8);
  const cipher = createCipheriv('aes-256-ctr', seed, iv);
  const encrypted = Buffer.concat([cipher.update(clear.subarray(0, 8192)), clear.subarray(8192)]);
  const url = new URL('https://fixture.example.top/s/1/segment.jpg');
  assert.deepEqual(decodeGotakuSegment(encrypted, url, 0, manifest), clear);
  for (const offset of [17, 8177, 8200]) {
    assert.deepEqual(decodeGotakuSegment(encrypted.subarray(offset), url, offset, manifest), clear.subarray(offset));
  }
});
