import test, { mock } from 'node:test'; import assert from 'node:assert/strict'; import {cachedAnime,curated,normalizeAnime,stripHtml,fetchCatalog,fetchAnime} from './catalog';
test('curated titles',()=>{assert.equal(curated.length,8);assert.equal(curated[0].id,154587);assert.equal(curated[1].title,'Cowboy Bebop');});

test('normalizer strips HTML',()=>{assert.equal(stripHtml('<i>Hello</i><br>world &amp; friends'),'Hello\nworld & friends');const a=normalizeAnime({id:7,title:{english:'Test',romaji:'Tesuto'},description:'<b>Plot</b>',startDate:{year:2024},studios:{nodes:[{name:'Studio'}]}});assert.deepEqual({id:a.id,title:a.title,description:a.description,year:a.year,studios:a.studios},{id:7,title:'Test',description:'Plot',year:2024,studios:['Studio']});});

test('metadata failure is not misrepresented as live data', async () => {
  const request = mock.method(globalThis, 'fetch', async () => new Response('', { status: 429 }));
  try { await assert.rejects(fetchCatalog(), /429/); } finally { request.mock.restore(); }
});

test('API errors surface to the offline UI', async () => {
  const request = mock.method(globalThis, 'fetch', async () => Response.json({ error: { code: 'UPSTREAM_ERROR', message: 'AniList could not complete the request' } }, { status: 502 }));
  try { await assert.rejects(fetchCatalog(), /could not complete/); } finally { request.mock.restore(); }
});

test('successful live metadata is normalized', async () => {
  const request = mock.method(globalThis, 'fetch', async () => Response.json({ anime: [normalizeAnime({ id: 7, title: { romaji: 'Example' }, coverImage: { large: '/cover.jpg' } })] }));
  try { const [anime] = await fetchCatalog(); assert.equal(anime.title, 'Example'); assert.equal(anime.banner, '/cover.jpg'); } finally { request.mock.restore(); }
});

test('invalid IDs never make a request', async () => {
  assert.equal(await fetchAnime(-1), null);
  assert.equal(await fetchAnime(NaN), null);
});

test('audience counts are normalized without inventing missing or invalid values', () => {
  const anime = normalizeAnime({ id: 8, popularity: 123456 });
  assert.equal(anime.popularity, 123456);
  for (const invalid of [undefined, 0, -1, NaN, Infinity, 1.5]) {
    const missing = normalizeAnime({ id: 8, popularity: invalid });
    assert.equal(missing.popularity, undefined);
  }
});

test('catalog metadata is available immediately for navigation without hiding request failures', async () => {
  const request = mock.method(globalThis, 'fetch', async () => Response.json({ anime: [normalizeAnime({ id: 900001, title: { english: 'Cached title' } })] }));
  try {
    const [anime] = await fetchCatalog();
    assert.equal(cachedAnime(anime.id), anime);
    assert.equal(cachedAnime(154587)?.id, 154587);
    assert.equal(cachedAnime(-1), undefined);
  } finally { request.mock.restore(); }
  const failure = mock.method(globalThis, 'fetch', async () => new Response('', { status: 429 }));
  try {
    await assert.rejects(fetchAnime(900001), /429/);
    assert.equal(cachedAnime(900001)?.title, 'Cached title');
  } finally { failure.mock.restore(); }
});

test('episode artwork matches explicit numbers and ignores unsafe or unnumbered entries', () => {
  const anime = normalizeAnime({ id: 9, streamingEpisodes: [
    { title: 'Episode 3 - Killing Magic', thumbnail: 'https://example.com/3.jpg' },
    { title: 'Special - Behind the scenes', thumbnail: 'https://example.com/special.jpg' },
    { title: 'Episode 1 - First', thumbnail: 'javascript:alert(1)' },
  ] });
  assert.deepEqual(anime.episodeArtwork, [{ number: 3, title: 'Killing Magic', thumbnail: 'https://example.com/3.jpg' }, { number: 1, title: 'First', thumbnail: '' }]);
  assert.deepEqual(normalizeAnime({ id: 10 }).episodeArtwork, []);
});
