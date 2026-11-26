import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkissaMp4UploadEmbed, resolveMkissaMp4Upload } from '../extractors/mkissa-player';

const signal = new AbortController().signal;
const mp4Embed = 'https://mp4upload.com/embed-abcdefgh1234.html';
const media = `https://a1.mp4upload.com:183/d/${'a'.repeat(64)}/video.mp4`;

test('MKissa Mp4 extracts a literal source through the canonical embed without executing scripts', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://www.mp4upload.com/embed-abcdefgh1234.html');
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get('Referer'), 'https://filelotion.fyi/');
    return new Response(`<script>throw Error('never run'); player.src({type:'video/mp4',src:"${media}"});</script>`);
  });
  assert.deepEqual(await resolveMkissaMp4Upload(mp4Embed, signal), {
    sources: [{ url: media, type: 'mp4' }], subtitles: [], headers: { Referer: 'https://www.mp4upload.com/' }
  });
  assert.equal(fetch.mock.callCount(), 1);
});

test('MKissa Mp4 rejects unsafe embeds before fetching', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw Error('unexpected fetch'); });
  for (const value of [null, 'http://mp4upload.com/embed-abcdefgh1234.html',
    mp4Embed + '?url=https://127.0.0.1', mp4Embed.replace('mp4upload.com', 'mp4upload.com.evil.test')]) {
    assert.equal(mkissaMp4UploadEmbed(value), undefined);
    await assert.rejects(resolveMkissaMp4Upload(value, signal), { code: 'INVALID_REQUEST' });
  }
  await assert.rejects(resolveMkissaMp4Upload(mp4Embed, AbortSignal.abort(Error('cancelled'))), { message: 'cancelled' });
  assert.equal(fetch.mock.callCount(), 0);
});

test('MKissa Mp4 rejects deleted files, missing sources and unsafe CDN URLs', async t => {
  let html = '';
  t.mock.method(globalThis, 'fetch', async () => new Response(html));
  html = 'File was deleted';
  await assert.rejects(resolveMkissaMp4Upload(mp4Embed, signal), { code: 'UNAVAILABLE' });
  for (const source of [undefined, media.replace('a1.mp4upload.com', '127.0.0.1'),
    media.replace('a1.mp4upload.com', 'a1.mp4upload.com.evil.test'), media.replace(':183', ':8443'),
    media.replace('https://', 'https://user@'), media + '#fragment', media.replace('/video.mp4', '/other.mp4')]) {
    html = source ? `player.src({src:"${source}"})` : 'eval(packedScript)';
    await assert.rejects(resolveMkissaMp4Upload(mp4Embed, signal), { code: 'UNSUPPORTED_MEDIA' });
  }
});
