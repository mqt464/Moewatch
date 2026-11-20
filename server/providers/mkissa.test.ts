import assert from 'node:assert/strict';
import { test } from 'node:test';
import { idDecode, idEncode } from './common';
import { mkissa } from './mkissa';

const titleId = 'Qwi4hM3qzcwv9Rbaa';
const anime = {
  id: 159322,
  title: 'BLEACH: Thousand-Year Blood War - The Separation',
  romaji: 'BLEACH: Sennen Kessen-hen - Ketsubetsu-tan',
  year: 2023, format: 'TV', episodes: 13
};
const show = {
  _id: titleId, englishName: anime.title, name: anime.romaji, type: 'TV', season: { year: 2023 }
};

test('MKissa searches catalog and verifies candidate AniList IDs via title detail', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    const url = new URL(input);
    assert.equal(url.origin + url.pathname, 'https://api.mkissa.net/api');
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get('Referer'), 'https://mkissa.to/');
    const variables = JSON.parse(url.searchParams.get('variables')!);
    if (variables.search.query) {
      assert.equal(variables.translationType, 'sub');
      return Response.json({ data: { shows: { edges: [show, { ...show, _id: 'other' }] } } });
    }
    return Response.json({
      data: { show: { ...show, _id: variables._id, aniListId: variables._id === titleId ? '159322' : '123' } }
    });
  });
  const signal = new AbortController().signal;
  assert.equal((await mkissa.search('Bleach', signal))[0].id, titleId);
  assert.deepEqual(await mkissa.match(anime, signal), {
    status: 'matched',
    title: { id: titleId, title: anime.title, aliases: [anime.romaji], anilistId: anime.id, year: 2023, format: 'TV' }
  });
  assert.deepEqual(await mkissa.match({ ...anime, id: 555 }, signal), { status: 'not-found' });
  assert.equal(fetchMock.mock.callCount(), 9);
});

test('MKissa merges verified sub and dub episode lists and excludes unsupported entries', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    data: { show: {
      _id: titleId,
      availableEpisodesDetail: { sub: ['2', '1', '1', '1.5', 'path/3'], dub: ['3', '1'], raw: ['4'] }
    } }
  }));
  const episodes = await mkissa.episodes(titleId, new AbortController().signal);
  assert.deepEqual(episodes.map(({ number, kind, audio }) => [number, kind, audio]), [
    [1, 'regular', ['sub', 'dub']], [1.5, 'special', ['sub']], [2, 'regular', ['sub']], [3, 'regular', ['dub']]
  ]);
  assert.deepEqual(idDecode(episodes[0].id, 'mkissa'), { titleId, episode: '1' });
});

test('MKissa keeps playback disabled and honors aborts and unsafe input', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected fetch'); });
  const signal = new AbortController().signal;
  const aborted = AbortSignal.abort(new Error('Cancelled'));
  const episode = idEncode({ titleId, episode: '1' });
  assert.equal(mkissa.configured, false);
  await assert.rejects(mkissa.search('Bleach', aborted), { message: 'Cancelled' });
  await assert.rejects(mkissa.episodes('https://127.0.0.1', signal), { code: 'INVALID_REQUEST', provider: 'mkissa' });
  await assert.rejects(mkissa.servers(idEncode({ titleId, episode: '../1' }), signal), { code: 'INVALID_REQUEST' });
  const bootstrapError = {
    code: 'UPSTREAM_BLOCKED',
    message: 'MKissa playback is blocked by a provider CAPTCHA; direct player resolution is pending.',
    provider: 'mkissa'
  };
  await assert.rejects(mkissa.servers(episode, signal), bootstrapError);
  await assert.rejects(mkissa.resolve('https://127.0.0.1/a.m3u8', signal), bootstrapError);
  await assert.rejects(mkissa.resolve('unused', aborted), { message: 'Cancelled' });
  assert.equal(fetchMock.mock.callCount(), 0);
});
