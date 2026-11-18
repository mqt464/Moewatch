import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createAniListCatalog } from '../catalog/anilist';

test('backend fetches AniList directly, normalizes data and caches successful responses', async () => {
  const calls: string[] = [];
  const request = mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls.push(url);
    const query = JSON.parse(String(options.body));
    assert.equal(query.variables.id, 123);
    assert.match(query.query, /popularity/);
    return Response.json({ data: { Media: { id: 123, title: { romaji: 'Example' } } } });
  });
  try {
    const catalog = createAniListCatalog();
    const signal = new AbortController().signal;
    assert.equal((await catalog.anime(123, signal))?.title, 'Example');
    assert.equal((await catalog.anime(123, signal))?.id, 123);
    assert.deepEqual(calls, ['https://graphql.anilist.co']);
  } finally { request.mock.restore(); }
});
