import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { reanime, parseReanimeSearch, parseReanimeEpisodes, parseReanimeServers } from './reanime';
import { idDecode } from './common';

test('ReAnime current API payloads retain exact IDs, playable episodes and audio', () => {
  assert.deepEqual(parseReanimeSearch({ results: [{ anime_id: 'frieren-show', anilist_id: 154587, title: { english: 'Frieren', romaji: 'Sousou no Frieren' }, season_year: 2023, format: 'TV' }] }), [{ id: 'frieren-show', anilistId: 154587, title: 'Frieren', aliases: ['Sousou no Frieren'], year: 2023, format: 'TV' }]);
  const episodes = parseReanimeEpisodes({ data: [{ episode_number: 1, subbed: true, dubbed: true, playable: true }, { episode_number: 2, subbed: false, dubbed: true, playable: true }, { episode_number: 3, subbed: true, playable: false }] }, 'frieren-show');
  assert.deepEqual(episodes.map(e => e.audio), [['sub', 'dub'], ['dub']]);
  const servers = parseReanimeServers({ success: true, servers: [{ dataType: 'dub', serverName: 'HD-2', dataLink: 'https://flixcloud.cc/e/test?v=2' }, { dataType: 'sub', dataLink: 'http://127.0.0.1/private' }] });
  assert.equal(servers.length, 1);
  assert.equal(idDecode<{url: string}>(servers[0].id, 'reanime').url, 'https://flixcloud.cc/e/test?v=2');
});

test('ReAnime requests current search, episode and AniList server routes', async () => {
  const paths: string[] = [];
  const fetch = mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(String(input)); paths.push(url.pathname + url.search);
    let data: unknown;
    if (url.pathname === '/api/v1/search') data = { results: [{ anime_id: 'show', anilist_id: 10, title: { english: 'Show' } }] };
    else if (url.pathname === '/api/v1/anime/show/episodes') data = { data: [{ episode_number: 1, subbed: true, dubbed: true, playable: true }] };
    else if (url.pathname === '/api/v1/anime/show') data = { anilist_id: 10, mal_id: 20 };
    else if (url.pathname === '/api/flix/10/1') data = { success: true, servers: [] };
    else throw new Error(`Unexpected path ${url.pathname}`);
    return Response.json(data);
  });
  try {
    const signal = new AbortController().signal;
    const titles = await reanime.search('Show', signal);
    const episodes = await reanime.episodes(titles[0].id, signal);
    await reanime.servers(episodes[0].id, signal);
    assert.ok(paths.includes('/api/v1/search?q=Show&limit=30&offset=0'));
    assert.ok(paths.includes('/api/flix/10/1?mal=20'));
  } finally { fetch.mock.restore(); }
});
