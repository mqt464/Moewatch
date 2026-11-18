import test from 'node:test';
import assert from 'node:assert/strict';
import { createEpisodeMetadata } from '../catalog/episodes';
import { normalizeAnime } from '../../src/catalog';

const signal = () => new AbortController().signal;
const anime = () => normalizeAnime({ id: 1, idMal: 1, episodes: 2, title: { english: 'Original catalogue title' }, streamingEpisodes: [{ title: 'Episode 1 - Original title', thumbnail: 'https://example.com/1.jpg' }] });
function fixture(calls: string[]) {
  return (async (input: string | URL | Request) => {
    const url = String(input); calls.push(url);
    if (url.includes('ani.zip')) return Response.json({ mappings: { anilist_id: 1, mal_id: 1, kitsu_id: 7 } });
    if (url.includes('kitsu.io')) return Response.json({ data: [
      { attributes: { number: 1, canonicalTitle: 'Kitsu first', thumbnail: { original: 'https://example.com/k1.jpg' } } },
      { attributes: { number: 2, canonicalTitle: 'Kitsu second', thumbnail: { original: 'https://example.com/k2.jpg' } } },
      { attributes: { number: 3, thumbnail: { original: 'https://example.com/outside.jpg' } } },
      { attributes: { number: 'S1', thumbnail: { original: 'https://example.com/special.jpg' } } },
    ] });
    return Response.json({ data: [{ mal_id: 1, title: 'MAL first' }, { mal_id: 2, title: 'MAL second' }], pagination: { has_next_page: false } });
  }) as typeof fetch;
}
test('episode wrapper fills individual fields without replacing catalogue or primary values, and caches', async () => {
  const calls: string[] = []; const enrich = createEpisodeMetadata(fixture(calls));
  const original = anime(); const result = await enrich(original, signal());
  assert.equal(result.title, original.title); assert.equal(result.episodes, 2);
  assert.deepEqual(result.episodeArtwork?.map(e => [e.number, e.title, e.thumbnail]), [[1, 'Original title', 'https://example.com/1.jpg'], [2, 'MAL second', 'https://example.com/k2.jpg']]);
  assert.equal(result.episodeArtwork?.[1].titleSource, 'jikan'); assert.equal(result.episodeArtwork?.[1].thumbnailSource, 'kitsu');
  assert.equal(original.episodeArtwork?.length, 1);
  await enrich(original, signal()); assert.equal(calls.length, 3);
});
test('complete primary episode data makes no secondary requests', async () => {
  const calls: string[] = []; const original = { ...anime(), episodes: 1 };
  assert.equal(await createEpisodeMetadata(fixture(calls))(original, signal()), original); assert.equal(calls.length, 0);
});
test('wrong identity mappings are rejected but canonical MAL ID remains usable', async () => {
  const calls: string[] = []; const base = fixture(calls);
  const result = await createEpisodeMetadata((async (url, init) => String(url).includes('ani.zip') ? Response.json({ mappings: { anilist_id: 99, mal_id: 9, kitsu_id: 9 } }) : base(url, init)) as typeof fetch)(anime(), signal());
  assert.ok(calls.every(url => !url.includes('kitsu.io')));
  assert.equal(result.episodeArtwork?.[1].title, 'MAL second'); assert.equal(result.episodeArtwork?.[1].thumbnail, '');
});
test('secondary outages preserve primary data and Kitsu titles survive a MAL outage', async () => {
  const calls: string[] = []; const base = fixture(calls);
  const result = await createEpisodeMetadata((async (url, init) => String(url).includes('jikan') ? new Response('', { status: 429 }) : base(url, init)) as typeof fetch)(anime(), signal());
  assert.equal(result.episodeArtwork?.[1].title, 'Kitsu second');
  const original = anime();
  const offline = await createEpisodeMetadata((async () => { throw Error('offline'); }) as typeof fetch)(original, signal());
  assert.equal(offline.episodeArtwork?.[0].thumbnail, original.episodeArtwork?.[0].thumbnail);
});
test('title-only primary metadata survives enrichment and unsafe fallback images are rejected', async () => {
  const primary = normalizeAnime({ id: 1, episodes: 1, streamingEpisodes: [{ title: 'Episode 1 - Title only' }] });
  const result = await createEpisodeMetadata((async (url) => String(url).includes('ani.zip') ? Response.json({ mappings: { anilist_id: 1, kitsu_id: 7 } }) : Response.json({ data: [{ attributes: { number: 1, thumbnail: { original: 'javascript:alert(1)' } } }] })) as typeof fetch)(primary, signal());
  assert.equal(result.episodeArtwork?.[0].title, 'Title only'); assert.equal(result.episodeArtwork?.[0].thumbnail, '');
});
