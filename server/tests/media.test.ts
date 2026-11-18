import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMediaProxy, pinnedLookup, preparePlaylist, rewritePlaylist } from '../infrastructure/media';

test('pinned DNS lookup supports Node single-address and auto-family request modes', () => {
  const lookup = pinnedLookup({ address: '8.8.8.8', family: 4 });
  const values: unknown[] = [];
  lookup('untrusted.example', { all: true }, (error, address, family) => { assert.equal(error, null); values.push([address, family]); });
  lookup('untrusted.example', { all: false }, (error, address, family) => { assert.equal(error, null); values.push([address, family]); });
  assert.deepEqual(values, [[[{ address: '8.8.8.8', family: 4 }], undefined], ['8.8.8.8', 4]]);
});

test('HLS rewrite includes nested playlists, segments, keys, maps and subtitle tracks', async () => {
  const requested: string[] = [];
  const result = await rewritePlaylist('#EXTM3U\r\n#EXT-X-MEDIA:TYPE=SUBTITLES,URI="subs/en.m3u8"\r\n#EXT-X-KEY:METHOD=AES-128,URI="../key"\r\n#EXT-X-MAP:URI="init.mp4"\r\nvariant/index.m3u8\r\nsegment.ts?token=abc', new URL('https://cdn.example/show/master.m3u8'), async url => {
    requested.push(url.href);
    return `/media/token${requested.length}`;
  });
  assert.deepEqual(requested, ['https://cdn.example/show/subs/en.m3u8', 'https://cdn.example/key', 'https://cdn.example/show/init.mp4', 'https://cdn.example/show/variant/index.m3u8', 'https://cdn.example/show/segment.ts?token=abc']);
  assert.match(result, /URI="\/media\/token1"/);
  assert.match(result, /\/media\/token4\n\/media\/token5$/);
  assert.equal(result.includes('cdn.example'), false);
});

test('media tokens are reusable, opaque and reject private addresses and unsafe URLs', async () => {
  const proxy = createMediaProxy();
  const first = await proxy.issue('https://8.8.8.8/video.m3u8');
  assert.equal(await proxy.issue('https://8.8.8.8/video.m3u8'), first);
  assert.notEqual(await proxy.issue('https://8.8.8.8/video.m3u8', { Referer: 'https://example.com/' }), first);
  for (const url of ['file:///etc/passwd', 'http://10.0.0.1/x', 'http://169.254.169.254/x', 'http://172.16.0.1/x', 'http://192.168.1.1/x', 'http://[::1]/x', 'http://[::ffff:127.0.0.1]/x', 'http://[2001:db8::1]/x']) await assert.rejects(proxy.issue(url));
  await assert.rejects(proxy.issue('https://8.8.8.8/x', {}, Date.now() - 1), { code: 'SOURCE_EXPIRED' });
  await assert.rejects(proxy.issue('https://8.8.8.8/x', {}, NaN), { code: 'UNSUPPORTED_MEDIA' });
});

test('FlixCloud playlists decrypt before rewriting and keep only the requested audio', async () => {
  const master = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="jpn",NAME="Native",DEFAULT=YES,URI="audio/native.m3u8"\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="eng",NAME="English",DEFAULT=NO,URI="audio/english.m3u8"\n#EXT-X-STREAM-INF:AUDIO="audio"\nvideo.m3u8';
  const key = Buffer.alloc(32, 0x42), data = Buffer.from(master);
  for (let i = 0; i < data.length; i++) data[i] ^= key[i % key.length];
  const playlistKey = key.toString('base64');
  const decoded = preparePlaylist(data.toString('base64'), { playlistKey, audioLanguage: 'en' });
  assert.match(decoded, /LANGUAGE="eng".*DEFAULT=YES/);
  assert.equal(decoded.includes('LANGUAGE="jpn"'), false);
  const urls: string[] = [];
  const rewritten = await rewritePlaylist(decoded, new URL('https://cdn.example/master.m3u8'), async url => { urls.push(url.href); return `/media/${urls.length}`; });
  assert.deepEqual(urls, ['https://cdn.example/audio/english.m3u8', 'https://cdn.example/video.m3u8']);
  assert.match(rewritten, /URI="\/media\/1"/);
  assert.equal(preparePlaylist(master, { playlistKey, audioLanguage: 'ja' }).includes('LANGUAGE="eng"'), false);
  assert.throws(() => preparePlaylist(data.toString('base64'), { playlistKey: Buffer.alloc(32).toString('base64') }), { code: 'UNSUPPORTED_MEDIA' });
  assert.throws(() => preparePlaylist(master.replace('LANGUAGE="jpn"', 'LANGUAGE="fra"'), { audioLanguage: 'ja' }), { code: 'UNSUPPORTED_MEDIA' });
  assert.equal(preparePlaylist('#EXTM3U\nsegment.ts', {}), '#EXTM3U\nsegment.ts');
});

test('media tokens distinguish private playlist keys and audio preferences', async () => {
  const proxy = createMediaProxy(), url = 'https://8.8.8.8/master.m3u8';
  const sub = await proxy.issue(url, {}, undefined, { audioLanguage: 'ja' });
  assert.notEqual(sub, await proxy.issue(url, {}, undefined, { audioLanguage: 'en' }));
  assert.notEqual(sub, await proxy.issue(url, {}, undefined, { audioLanguage: 'ja', playlistKey: Buffer.alloc(32).toString('base64') }));
});
