import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AniListClient } from '../infrastructure/anilist';

const signal = () => AbortSignal.timeout(5000);

test('concurrent readers share requests, have independent bodies, and remain account-isolated', async () => {
  const original = globalThis.fetch;
  let now = 1000;
  const client = new AniListClient(() => now);
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ data: { value: calls } }); };
  try {
    const request = (token = 'a') => client.request('query { Viewer { id } }', {}, { signal: signal(), token, ttlMs: 100 });
    const responses = await Promise.all([request(), request(), request()]);
    assert.equal(calls, 1);
    assert.deepEqual(await Promise.all(responses.map(response => response.json())), Array(3).fill({ data: { value: 1 } }));
    await request();
    assert.equal(calls, 1);
    await request('b');
    assert.equal(calls, 2);
    now += 101;
    await request();
    assert.equal(calls, 3);
  } finally { globalThis.fetch = original; }
});

test('429 shares Retry-After cooldown across account and public reads, serves stale data, then recovers', async () => {
  const original = globalThis.fetch;
  let now = 1000;
  const client = new AniListClient(() => now);
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 2 ? new Response('', { status: 429, headers: { 'Retry-After': '120' } }) : Response.json({ data: { value: calls } });
  };
  try {
    const request = (query = 'query { Viewer { id } }', token = 'a') => client.request(query, {}, { signal: signal(), token, ttlMs: 100 });
    await request();
    now += 101;
    assert.deepEqual(await (await request()).json(), { data: { value: 1 } });
    assert.equal(calls, 2);
    assert.equal((await request('query { Media { id } }', '')).status, 429);
    assert.equal((await request('query { Viewer { id } }', 'b')).status, 429);
    assert.equal(calls, 2);
    now += 120001;
    assert.deepEqual(await (await request()).json(), { data: { value: 3 } });
    assert.equal(calls, 3);
  } finally { globalThis.fetch = original; }
});

test('successful mutations invalidate account reads; failed writes are never retried or served from cache', async () => {
  const original = globalThis.fetch;
  const client = new AniListClient();
  let calls = 0;
  let fail = false;
  globalThis.fetch = async () => { calls++; return fail ? new Response('', { status: 429 }) : Response.json({ data: { value: calls } }); };
  try {
    const request = (query = 'query { Media { isFavourite } }') => client.request(query, {}, { signal: signal(), token: 'a' });
    await request();
    await request('mutation { ToggleFavourite { id } }');
    assert.equal(calls, 2);
    assert.deepEqual(await (await request()).json(), { data: { value: 3 } });
    fail = true;
    assert.equal((await request('mutation { ToggleFavourite { id } }')).status, 429);
    assert.equal((await request('mutation { ToggleFavourite { id } }')).status, 429);
    assert.equal(calls, 4);
    assert.equal((await request()).status, 200);
  } finally { globalThis.fetch = original; }
});

test('manual refresh bypasses freshness without deleting stale data for other views', async () => {
  const original = globalThis.fetch;
  const client = new AniListClient();
  let fail = false;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return fail ? new Response('', { status: 429 }) : Response.json({ data: { value: 1 } }); };
  try {
    const query = 'query { Page { mediaList { id } } }';
    await client.request(query, {}, { signal: signal(), token: 'a' });
    client.expire('a');
    fail = true;
    assert.equal((await client.request(query, {}, { signal: signal(), token: 'a', fresh: true })).status, 429);
    assert.equal((await client.request(query, {}, { signal: signal(), token: 'a' })).status, 200);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test('aborting one reader does not cancel the request another reader needs', async () => {
  const original = globalThis.fetch;
  const client = new AniListClient();
  let finish: (response: Response) => void = () => {};
  let calls = 0;
  globalThis.fetch = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  try {
    const controller = new AbortController();
    const first = client.request('query { Viewer { id } }', {}, { signal: controller.signal });
    const second = client.request('query { Viewer { id } }', {}, { signal: signal() });
    controller.abort();
    finish(Response.json({ data: { Viewer: { id: 1 } } }));
    await assert.rejects(first, { name: 'AbortError' });
    assert.equal((await second).status, 200);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('GraphQL failures are not cached and stale data is never used to mask authentication failure', async () => {
  const original = globalThis.fetch;
  let now = 1000;
  const client = new AniListClient(() => now);
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return Response.json({ errors: [{ message: 'bad' }] });
    if (calls === 3) return new Response('', { status: 401 });
    return Response.json({ data: { value: calls } });
  };
  try {
    const request = () => client.request('query { Viewer { id } }', {}, { signal: signal(), ttlMs: 100 });
    await request();
    await request();
    assert.equal(calls, 2);
    now += 101;
    assert.equal((await request()).status, 401);
    assert.equal(calls, 3);
  } finally { globalThis.fetch = original; }
});

test('an older in-flight read cannot restore stale cache after a mutation', async () => {
  const original = globalThis.fetch;
  const client = new AniListClient();
  let finish: (response: Response) => void = () => {};
  let calls = 0;
  globalThis.fetch = () => {
    calls++;
    if (calls === 1) return new Promise(resolve => { finish = resolve; });
    return Promise.resolve(Response.json({ data: { value: calls } }));
  };
  try {
    const options = { signal: signal(), token: 'a' };
    const old = client.request('query { Media { isFavourite } }', {}, options);
    await client.request('mutation { ToggleFavourite { id } }', {}, options);
    finish(Response.json({ data: { value: 'old' } }));
    await old;
    const fresh = await client.request('query { Media { isFavourite } }', {}, options);
    assert.deepEqual(await fresh.json(), { data: { value: 3 } });
    assert.equal(calls, 3);
  } finally { globalThis.fetch = original; }
});
