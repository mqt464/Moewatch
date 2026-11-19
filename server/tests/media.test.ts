import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMediaProxy, pinnedLookup, preparePlaylist, rewritePlaylist } from '../infrastructure/media';
import { mediaAssetKind, decodeMediaPlaylist, decodeMediaSegments } from '../infrastructure/media';
import { createCipheriv, createHash, hkdfSync } from 'node:crypto';

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

test('explicit HLS metadata follows extensionless variants and renditions, excluding binary assets', async () => {
  const url = new URL('https://cdn.example/master.jpg');
  assert.equal(mediaAssetKind(url, 'image/jpeg', { hls: true }), 'playlist');
  assert.equal(mediaAssetKind(url, 'image/jpeg', {}), 'binary');
  const references: [string, boolean][] = [];
  const issue = async (url: URL, playlist: boolean) => { references.push([url.pathname, playlist]); return '/media/opaque'; };
  await rewritePlaylist('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="/audio"\n#EXT-X-MEDIA:TYPE=SUBTITLES,URI="/subs"\n#EXT-X-SESSION-KEY:METHOD=AES-128,URI="/key"\n#EXT-X-STREAM-INF:BANDWIDTH=1000\n/video', url, issue);
  assert.deepEqual(references, [['/audio', true], ['/subs', true], ['/key', false], ['/video', true]]);
  references.length = 0;
  await rewritePlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="/key"\n#EXT-X-MAP:URI="/init"\n#EXTINF:5,\n/segment.jpg\n#EXT-X-ENDLIST', url, issue);
  assert.deepEqual(references, [['/key', false], ['/init', false], ['/segment.jpg', false]]);
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
  const namedLanguages = master.replace('LANGUAGE="jpn"', 'LANGUAGE="Japanese"').replace('LANGUAGE="eng"', 'LANGUAGE="English"');
  assert.doesNotMatch(preparePlaylist(namedLanguages, { audioLanguage: 'ja' }), /LANGUAGE="English"/);
  assert.doesNotMatch(preparePlaylist(namedLanguages, { audioLanguage: 'en' }), /LANGUAGE="Japanese"/);
  const missingDefaults = namedLanguages.replace(/,DEFAULT=(?:YES|NO)/g, '');
  assert.match(preparePlaylist(missingDefaults, { audioLanguage: 'ja' }), /LANGUAGE="Japanese"[^\n]*,DEFAULT=YES,AUTOSELECT=YES/);
  const disabledAutoselect = master.replace('DEFAULT=NO', 'DEFAULT=NO,AUTOSELECT=NO');
  assert.match(preparePlaylist(disabledAutoselect, { audioLanguage: 'en' }), /DEFAULT=YES,AUTOSELECT=YES/);
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

test('Gotaku proxy decoding recognizes extensionless playlists and streams masked segment ranges', async () => {
  const seed = Buffer.alloc(32, 7), token = 'a'.repeat(22);
  const mediaEncryption = { type: 'gotaku' as const, keySeed: seed.toString('base64url'), segmentBytes: 8192 as const };
  const options = { mediaEncryption };
  const playlistUrl = new URL(`https://cdn.example.top/p/1/2000000000/${token}/master`);
  assert.equal(mediaAssetKind(playlistUrl, 'application/octet-stream', options), 'playlist');
  assert.equal(mediaAssetKind(playlistUrl, 'application/octet-stream', {}), 'binary');
  const iv = Buffer.alloc(12, 9), key = Buffer.from(hkdfSync('sha256', seed, token, 'pl|v1', 32));
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const text = '#EXTM3U\n#EXTINF:5,\n/s/1/asset.jpg\n#EXT-X-ENDLIST';
  const packet = Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]);
  assert.equal(decodeMediaPlaylist(packet, playlistUrl, options), text);
  packet[packet.length - 1] ^= 1;
  assert.throws(() => decodeMediaPlaylist(packet, playlistUrl, options), { code: 'UNSUPPORTED_MEDIA' });

  const url = new URL('https://cdn.example.top/s/1/asset.jpg');
  assert.equal(mediaAssetKind(url, 'text/html', options), 'gotaku-segment');
  const clear = Buffer.alloc(10000, 0x47), counter = Buffer.alloc(16);
  createHash('sha256').update('asset').digest().copy(counter, 0, 0, 8);
  const ctr = createCipheriv('aes-256-ctr', seed, counter);
  const masked = Buffer.concat([ctr.update(clear.subarray(0, 8192)), clear.subarray(8192)]);
  for (const offset of [0, 17, 8100, 9000]) {
    const chunks = (async function* () { for (let i = offset; i < masked.length; i += 313) yield masked.subarray(i, i + 313); })();
    const decoded: Buffer[] = [];
    for await (const chunk of decodeMediaSegments(chunks, url, offset, options)) decoded.push(chunk);
    assert.deepEqual(Buffer.concat(decoded), clear.subarray(offset));
  }
});
