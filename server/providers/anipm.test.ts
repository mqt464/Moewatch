import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { anipm } from './anipm';
import { idEncode, providerBrowser } from './common';

const signal = () => new AbortController().signal;
const future = () => Math.floor(Date.now()/1000)+3600;
function pipeline(change: Record<string, unknown> = {}) {
  const browser = mock.method(providerBrowser, 'available', () => false);
  const calls: URL[] = [];
  const fetch = mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const u = new URL(String(input)); calls.push(u);
    let body: unknown;
    if (u.pathname === '/api/anime/search') body = { items: [{ id: 6351, source: 'settlar', routeId: 'frieren-6351', title: 'Frieren', anilistId: '154587', year: 2023, type: 'TV', providerTitles: ['Sousou no Frieren'] }] };
    else if (/\/api\/anime\/(series|ani)\//.test(u.pathname)) body = { routeId: 'frieren-6351', episodes: [{ number: 1, routeId: 'e1.signed-episode-route', sub: true, dub: true, subExact: true, dubExact: true, title: 'Departure' }] };
    else if (u.pathname.includes('playback-bootstrap')) body = { episode: 1, effectiveLanguage: u.searchParams.get('lang'), availability: { sub: true, dub: true }, settlarSelection: 'fixture-selection', skip: { op: { start: 1, end: 91 }, ed: { start: 1300, end: 1390 } }, ...change.boot as object };
    else if (u.pathname === '/api/anime/settlar/session') body = { provider: 'anipm', embedUrl: 'https://embed.settlar.io/embed/v1?t=fixture-token', expiresAt: future(), ...change.session as object };
    else if (u.pathname === '/api/embed/session') {
      if (change.blocked) return new Response('blocked', { status: 403 });
      body = { source: 'https://media.settlar.io/v1/object/fixture', kind: 'hls', audioLang: change.dub ? 'en' : 'ja', expiresAt: future()-100, keyProof: 'fixture-proof', subtitles: [{ url: 'https://media.settlar.io/sub/1', assUrl: 'https://media.settlar.io/sub/1-ass', label: 'Other', srclang: 'en', pick: 'both', default: false }, { url: 'https://media.settlar.io/sub/2', assUrl: 'https://media.settlar.io/sub/ass', label: 'English', srclang: 'en', pick: 'ass', default: true }], ...change.media as object };
    } else throw Error('Unexpected fixture route');
    return Response.json(body);
  });
  return { calls, restore: () => { fetch.mock.restore(); browser.mock.restore(); } };
}
async function server(audio = 'sub') {
  const [title] = await anipm.search('Frieren', signal());
  const [ep] = await anipm.episodes(title.id, signal());
  return (await anipm.servers(ep.id, signal())).find(s => s.audio === audio)!;
}
test('Ani.pm exact mock pipeline retains HLS proof, audio, subtitles, skips and expiry', async () => {
  for (const audio of ['sub', 'dub']) {
    const p = pipeline({ dub: audio === 'dub' });
    try {
      const selected = await server(audio), result = await anipm.resolve(selected.id, signal());
      assert.equal(result.sources[0].type, 'hls');
      assert.equal(result.audioLanguage, audio === 'dub' ? 'en' : 'ja');
      assert.deepEqual(result.headers, { Origin: 'https://embed.settlar.io', 'X-Settlar-Key-Proof': 'fixture-proof' });
      assert.deepEqual(result.intro, { start: 1, end: 91 });
      assert.equal(result.subtitles[0].format, 'ass');
      assert.equal(result.subtitles[1].format, 'vtt');
      assert.equal(result.subtitles[1].url, 'https://media.settlar.io/sub/1');
      assert.ok(result.expiresAt! <= (future()-100)*1000);
      assert.equal(p.calls[1].pathname+p.calls[1].search, '/api/anime/series/6351?routes=e4');
      assert.equal(p.calls[2].searchParams.get('lang'), audio);
      assert.equal(p.calls[3].searchParams.get('channel'), audio);
      assert.equal(p.calls[3].searchParams.get('selection'), 'fixture-selection');
      assert.equal(p.calls[4].host, 'embed.settlar.io');
      assert.equal(p.calls[4].searchParams.get('t'), 'fixture-token');
      assert.ok(!selected.id.includes('fixture-token'));
    } finally { p.restore(); }
  }
});
test('Ani.pm rejects fallback, unsafe URLs, malformed media, expired and blocked sessions', async () => {
  for (const change of [
    { boot: { effectiveLanguage: 'sub' } },
    { session: { embedUrl: 'https://embed.settlar.io.evil.test/embed/v1?t=x' } },
    { session: { embedUrl: 'https://embed.settlar.io/other?t=x' } },
    { session: { embedUrl: 'https://embed.settlar.io/embed/v1?t=x&t=y' } },
    { session: { expiresAt: 1 } },
    { media: { source: 'https://other.test/media' } },
    { media: { keyProof: 'bad\r\nproof' } },
    { media: { audioLang: 'ja' } },
    { blocked: true }
  ]) {
    const p = pipeline({ dub: true, ...change });
    try { await assert.rejects(anipm.resolve((await server('dub')).id, signal())); }
    finally { p.restore(); }
  }
});
test('Ani.pm supports AniList routes, conservative matching, cancellation and invalid IDs', async () => {
  const p = pipeline();
  try {
    await anipm.episodes(idEncode({ source: 'anilist', id: 154587 }), signal());
    assert.equal(p.calls[0].pathname, '/api/anime/ani/154587');
    assert.equal((await anipm.match({ id: 1, title: 'Frieren', romaji: '', year: 2023, format: 'TV', episodes: 28 }, signal())).status, 'not-found');
    const controller = new AbortController(); controller.abort();
    const before = p.calls.length;
    await assert.rejects(anipm.search('Frieren', controller.signal));
    assert.equal(p.calls.length, before);
    await assert.rejects(anipm.episodes(idEncode(null), signal()));
  } finally { p.restore(); }
});
