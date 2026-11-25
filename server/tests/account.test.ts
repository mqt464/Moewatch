import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createServer } from '../app';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sessionDirectory = mkdtempSync(join(tmpdir(), 'moewatch-account-'));
process.env.MOEWATCH_SESSION_FILE = join(sessionDirectory, 'sessions.json');

const server = createServer({ providers: [], catalog: { async search() { return []; }, async anime() { return null; } } });
let root = '';
const originalFetch = globalThis.fetch;
before(async () => {
  process.env.ANILIST_CLIENT_ID = 'test-client';
  process.env.ANILIST_CLIENT_SECRET = 'test-secret';
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/account`;
});
after(() => { globalThis.fetch = originalFetch; server.closeAllConnections(); server.close(); delete process.env.ANILIST_CLIENT_ID; delete process.env.ANILIST_CLIENT_SECRET; delete process.env.MOEWATCH_SESSION_FILE; rmSync(sessionDirectory, { recursive: true, force: true }); });

test('login moves to the configured origin before setting OAuth cookies', async () => {
  const previous = process.env.MOEWATCH_PUBLIC_ORIGIN;
  process.env.MOEWATCH_PUBLIC_ORIGIN = 'http://localhost:5173';
  try {
    const response = await originalFetch(`${root}/login`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'http://localhost:5173/api/v1/account/login');
    assert.equal(response.headers.get('set-cookie'), null);
  } finally {
    if (previous === undefined) delete process.env.MOEWATCH_PUBLIC_ORIGIN;
    else process.env.MOEWATCH_PUBLIC_ORIGIN = previous;
  }
});

test('OAuth callback permits cross-site navigation, binds state to cookie and stores token only server-side', async () => {
  const login = await originalFetch(`${root}/login`, { redirect: 'manual' });
  assert.equal(login.status, 302);
  const location = new URL(login.headers.get('location')!);
  assert.equal(location.origin, 'https://anilist.co');
  assert.equal(location.searchParams.get('redirect_uri'), `${root}/callback`);
  assert.equal(location.searchParams.get('response_type'), 'code');
  const state = location.searchParams.get('state')!;
  const stateCookie = login.headers.get('set-cookie')!.split(';')[0];
  let exchanges = 0;
  let liked = false;
  let favourite = false;
  let favouriteToggles = 0;
  let graphReads = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://anilist.co/api/v2/oauth/token') { exchanges++; const body = JSON.parse(String(init?.body)); assert.equal(body.redirect_uri, `${root}/callback`); return Response.json({ access_token: 'private-token', expires_in: 3600 }); }
    if (url === 'https://graphql.anilist.co') {
      graphReads++;
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer private-token');
      const body = JSON.parse(String(init?.body));
      if (body.query.includes('favourites { anime')) return Response.json({ data: { Viewer: { favourites: { anime: { nodes: [{ id: 10 }] } } } } });
      if (body.query.includes('recommendations(perPage:')) {
        const rec = (id: number, rating: number, isAdult = false) => ({ rating, mediaRecommendation: { id, type: 'ANIME', isAdult, title: { romaji: `Anime ${id}` } } });
        return Response.json({ data: {
          seed10: { recommendations: { nodes: [rec(20, 10), rec(21, 20), rec(10, 99), rec(22, 99, true), rec(23, -1)] } },
          seed11: { recommendations: { nodes: [rec(20, 10)] } },
        } });
      }
      if (body.query.includes('Viewer')) return Response.json({ data: { Viewer: { id: 55, name: 'Viewer', avatar: { large: 'https://example.org/avatar.png' } } } });
      if (body.query.includes('ToggleLikeV2')) {
        assert.ok(['THREAD', 'THREAD_COMMENT'].includes(body.variables.type));
        assert.equal(body.variables.id, 123);
        liked = !liked;
        return Response.json({ data: { ToggleLikeV2: { isLiked: liked, likeCount: liked ? 4 : 3 } } });
      }
      if (body.query.includes('ToggleFavourite')) { favourite = !favourite; favouriteToggles++; return Response.json({ data: { ToggleFavourite: { __typename: 'Favourites' } } }); }
      if (body.query.includes('isFavourite')) return Response.json({ data: { Media: { isFavourite: favourite, isFavouriteBlocked: false } } });
      if (body.query.includes('SaveMediaListEntry')) return Response.json({ data: { SaveMediaListEntry: { id: 1, mediaId: 10, status: 'CURRENT', progress: 2, updatedAt: 100, media: { id: 10, title: { romaji: 'Title' }, coverImage: {}, startDate: {} } } } });
      if (body.query.includes('DeleteMediaListEntry')) return Response.json({ data: { DeleteMediaListEntry: { deleted: true } } });
      if (body.variables.mediaId === 11) return Response.json({ errors: [{ message: 'Not Found.', status: 404 }] }, { status: 404 });
      if (body.variables.mediaId === 12) return Response.json({ data: { MediaList: null }, errors: [{ message: 'Not Found.', status: 404 }] });
      if (body.variables.mediaId === 13) return Response.json({ errors: [{ status: 500 }] });
      return Response.json({ data: { MediaList: null } });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  try {
    const callback = await originalFetch(`${root}/callback?code=code&state=${state}`, { redirect: 'manual', headers: { Cookie: stateCookie, 'sec-fetch-site': 'cross-site' } });
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get('location'), '/settings/account?result=connected');
    assert.equal(exchanges, 1);
    const cookies = callback.headers.getSetCookie();
    const session = cookies.find(value => value.startsWith('moewatch_session='))!;
    assert.ok(session.includes('HttpOnly'));
    assert.ok(!session.includes('private-token'));
    const auth = { Cookie: session.split(';')[0] };
    assert.equal(readFileSync(process.env.MOEWATCH_SESSION_FILE!, 'utf8').includes('private-token'), false);
    const account = await (await originalFetch(root, { headers: auth })).json();
    assert.equal(account.user.avatar, 'https://example.org/avatar.png');
    const likeUrl = root.replace(/account$/, 'discussions/like');
    for (const type of ['THREAD', 'THREAD_COMMENT']) {
      for (const expected of [true, false]) {
        const result = await originalFetch(likeUrl, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', 'X-Moewatch-Account': '55' }, body: JSON.stringify({ id: 123, type }) });
        assert.equal(result.status, 200);
        assert.deepEqual(await result.json(), { isLiked: expected, likeCount: expected ? 4 : 3 });
      }
    }
    const invalidLike = await originalFetch(likeUrl, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', 'X-Moewatch-Account': '55' }, body: JSON.stringify({ id: 123, type: 'ACTIVITY' }) });
    assert.equal(invalidLike.status, 400);
    const wrongLikeAccount = await originalFetch(likeUrl, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', 'X-Moewatch-Account': '99' }, body: JSON.stringify({ id: 123, type: 'THREAD' }) });
    assert.equal(wrongLikeAccount.status, 409);
    const restarted = createServer({ providers: [], catalog: { async search() { return []; }, async anime() { return null; } } });
    await new Promise<void>(resolve => restarted.listen(0, '127.0.0.1', resolve));
    const restartedRoot = `http://127.0.0.1:${(restarted.address() as AddressInfo).port}/api/v1/account`;
    try {
      const restored = await (await originalFetch(restartedRoot, { headers: auth })).json();
      assert.equal(restored.user?.id, 55, 'session must survive a new server instance');
    } finally { restarted.closeAllConnections(); restarted.close(); }
    assert.ok(!JSON.stringify(account).includes('private-token'));
    const replay = await originalFetch(`${root}/callback?code=code&state=${state}`, { redirect: 'manual', headers: { Cookie: stateCookie } });
    assert.equal(replay.headers.get('location'), '/settings/account?result=error');
    assert.equal(exchanges, 1);
    const wrongAccount = await originalFetch(`${root}/list`, { method: 'PUT', headers: { ...auth, 'content-type': 'application/json', 'x-moewatch-account': '99' }, body: JSON.stringify({ mediaId: 10, progress: 2, status: 'CURRENT' }) });
    assert.equal(wrongAccount.status, 409);
    const headers = { ...auth, 'content-type': 'application/json', 'x-moewatch-account': '55' };
    const recommendations = await originalFetch(`${root}/recommendations?seeds=11`, { headers });
    assert.equal(recommendations.status, 200);
    assert.deepEqual((await recommendations.json()).anime.map((anime: { id: number }) => anime.id), [20, 21]);
    const cachedReads = graphReads;
    const repeated = await Promise.all(Array.from({ length: 4 }, () => originalFetch(`${root}/recommendations?seeds=11`, { headers })));
    assert.ok(repeated.every(response => response.status === 200));
    assert.equal(graphReads, cachedReads, 'homepage remounts must reuse cached AniList recommendations');
    assert.equal((await originalFetch(`${root}/recommendations?seeds=bad`, { headers })).status, 400);
    assert.equal((await originalFetch(`${root}/recommendations?seeds=11`)).status, 401);
    const favouriteUrl = root + '/favourites/10';
    assert.equal((await originalFetch(favouriteUrl)).status, 401);
    assert.equal((await originalFetch(favouriteUrl, { headers: { ...headers, 'x-moewatch-account': '99' } })).status, 409);
    assert.equal((await (await originalFetch(favouriteUrl, { headers })).json()).isFavourite, false);
    for (const isFavourite of [true, true, false]) {
      const response = await originalFetch(favouriteUrl, { method: 'PUT', headers, body: JSON.stringify({ isFavourite }) });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).isFavourite, isFavourite);
    }
    assert.equal(favouriteToggles, 2, 'retrying a desired state must not toggle it off');
    assert.equal((await originalFetch(favouriteUrl, { method: 'PUT', headers, body: JSON.stringify({ isFavourite: 'yes' }) })).status, 400);
    const invalid = await originalFetch(`${root}/list`, { method: 'PUT', headers, body: JSON.stringify({ mediaId: 10, progress: null, status: 'CURRENT' }) });
    assert.equal(invalid.status, 400);
    const saved = await originalFetch(`${root}/list`, { method: 'PUT', headers, body: JSON.stringify({ mediaId: 10, progress: 2, status: 'CURRENT' }) });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).entry.progress, 2);
    assert.equal((await originalFetch(`${root}/list/10`, { method: 'DELETE', headers })).status, 200);
    assert.equal((await originalFetch(`${root}/list/11`, { method: 'DELETE', headers })).status, 200);
    assert.equal((await originalFetch(`${root}/list/12`, { method: 'DELETE', headers })).status, 200);
    assert.equal((await originalFetch(`${root}/list/13`, { method: 'DELETE', headers })).status, 502);
    assert.equal((await originalFetch(`${root}/logout`, { method: 'POST', headers: auth })).status, 200);
    assert.equal((await originalFetch(`${root}/list`, { headers: auth })).status, 401);
    const afterLogout = createServer({ providers: [], catalog: { async search() { return []; }, async anime() { return null; } } });
    await new Promise<void>(resolve => afterLogout.listen(0, '127.0.0.1', resolve));
    try {
      const result = await originalFetch(`http://127.0.0.1:${(afterLogout.address() as AddressInfo).port}/api/v1/account`, { headers: auth });
      assert.equal((await result.json()).user, null, 'signed-out sessions must stay revoked after restart');
    } finally { afterLogout.closeAllConnections(); afterLogout.close(); }
  } finally { globalThis.fetch = originalFetch; }
});

test('OAuth state mismatch never exchanges code and mutations reject cross-site requests', async () => {
  const login = await originalFetch(`${root}/login`, { redirect: 'manual' });
  const state = new URL(login.headers.get('location')!).searchParams.get('state');
  const response = await originalFetch(`${root}/callback?code=code&state=${state}`, { redirect: 'manual', headers: { Cookie: 'moewatch_oauth_state=wrong' } });
  assert.equal(response.headers.get('location'), '/settings/account?result=error');
  const logout = await originalFetch(`${root}/logout`, { method: 'POST', headers: { Origin: 'https://evil.example' } });
  assert.equal(logout.status, 403);
});
