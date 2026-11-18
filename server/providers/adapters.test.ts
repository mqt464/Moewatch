import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCipheriv } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { parseAnikotoSearch, parseAnikotoEpisodes, parseAnikotoServers } from './anikoto';
import { parseReanimeSearch, parseReanimeEpisodes, parseReanimeServers } from './reanime';
import { decodeMiruroPipe, parseMiruroEpisodes } from './miruro';
import { idDecode, idEncode, matching, media } from './common';
import { decryptMegaplay } from '../extractors/megaplay';

test('AniKoto parses search, sub and dub, and server links', () => {
  const titles = parseAnikotoSearch('<a class="item" href="https://anikototv.bz/watch/show-1"><div class="name d-title" data-jp="Show JP">Show</div><span class="dot">TV</span><span class="dot">2024</span></a>');
  assert.deepEqual(titles, [{ id: 'show-1', title: 'Show', aliases: ['Show JP'], year: 2024, format: 'TV' }]);
  const episodes = parseAnikotoEpisodes('<li title="Pilot"><a data-id="1" data-num="1" data-ids="encoded" data-sub="1" data-dub="1"></a></li>', 'show-1');
  assert.deepEqual(episodes[0].audio, ['sub', 'dub']);
  assert.equal(episodes[0].title, 'Pilot');
  assert.equal(idDecode<{ slug: string }>(episodes[0].id, 'anikoto').slug, 'show-1');
  assert.deepEqual(parseAnikotoServers('<div class="type" data-type="sub"><ul><li data-link-id="a">HD-1</li></ul></div>'), [{ link: 'a', name: 'HD-1', audio: 'sub' }]);
});

test('matching prefers AniList ID and keeps ambiguous title matches ambiguous', () => {
  const anime = { id: 10, title: 'Show', romaji: 'Show', year: 2024, format: 'TV', episodes: 12 };
  const titles = [{ id: 'a', title: 'Show', year: 2024, format: 'TV' }, { id: 'b', title: 'Show', year: 2024, format: 'TV' }];
  assert.equal(matching(anime, titles).status, 'ambiguous');
  assert.deepEqual(matching(anime, [...titles, { id: 'c', title: 'Other', anilistId: 10 }]), { status: 'matched', title: { id: 'c', title: 'Other', anilistId: 10 } });
  assert.equal(matching(anime, [{ id: 'a', title: 'Show', year: 2023 }]).status, 'not-found');
});

test('media preserves MIME, subtitles and skips while excluding unsupported files', () => {
  const value = media({ image: 'https://cdn.example/episode.jpg', sources: [{ file: 'https://cdn.example/a.mkv' }, { file: 'https://cdn.example/a.m3u8' }], tracks: [{ file: 'https://cdn.example/en.srt', label: 'English' }, { file: 'https://cdn.example/thumb.vtt', kind: 'thumbnails' }], intro: [10, 20] }, 'https://example.com', 'anikoto');
  assert.equal(value.thumbnail, 'https://cdn.example/episode.jpg');
  assert.deepEqual(value.sources, [{ url: 'https://cdn.example/a.m3u8', type: 'hls' }]);
  assert.deepEqual(value.subtitles, [{ url: 'https://cdn.example/en.srt', format: 'srt', language: 'en', label: 'English' }]);
  assert.deepEqual(value.intro, { start: 10, end: 20 });
  assert.throws(() => media({ sources: { file: 'https://cdn.example/a.mkv' } }, 'https://example.com', 'anikoto'), { code: 'UNSUPPORTED_MEDIA' });
  assert.throws(() => idDecode('!bad', 'anikoto'), { code: 'INVALID_REQUEST' });
});

test('Megaplay static token decoder rejects invalid data and decodes known format', () => {
  const padded = (value: string, length: number) => Buffer.from(value.padEnd(length, '\0')).subarray(0, length);
  const cipher = createCipheriv('aes-256-cbc', padded('i?LMTAx0Q6,:}50U', 32), padded("W0;27ToaUpl_P%'c", 16));
  const token = Buffer.concat([cipher.update(JSON.stringify({ file: 'https://cdn.example/master.m3u8' })), cipher.final()]).toString('base64url');
  assert.equal(decryptMegaplay(token).file, 'https://cdn.example/master.m3u8');
  assert.throws(() => decryptMegaplay('broken'), { code: 'UNSUPPORTED_MEDIA' });
});

test('ReAnime and Miruro parse direct site payloads', () => {
  assert.deepEqual(parseReanimeSearch({ data: [{ slug: 'show', title: 'Show', anilist: 10 }] }), [{ id: 'show', title: 'Show', anilistId: 10 }]);
  assert.equal(parseReanimeEpisodes([{ number: 1, title: 'Pilot' }], 'show')[0].number, 1);
  assert.equal(parseReanimeServers({ episode_links: [{ dataType: 'dub', serverName: 'HD-1', url: 'https://flixcloud.cc/e/id?v=2' }] })[0].audio, 'dub');
  const raw = { providers: { kiwi: { episodes: { sub: [{ id: 'k:1', number: 1 }], dub: [{ id: 'k:2', number: 1 }] } } } };
  assert.deepEqual(parseMiruroEpisodes(raw, 10)[0].audio, ['sub', 'dub']);
  assert.deepEqual(decodeMiruroPipe(gzipSync(JSON.stringify(raw)).toString('base64url')), raw);
});
