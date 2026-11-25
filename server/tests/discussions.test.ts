import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createServer } from '../app';

test('discussions filter by media, paginate comments, and require sign-in for likes', async () => {
  const server = createServer({ providers: [], catalog: { async search() { return []; }, async anime() { return null; } }, discordParty: false });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const original = globalThis.fetch;
  const queries: { query: string; variables: Record<string, unknown> }[] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input) === 'https://graphql.anilist.co') {
      assert.equal(new Headers(init?.headers).has('Authorization'), false);
      queries.push(JSON.parse(String(init?.body)));
      return Response.json({ data: { Page: { pageInfo: { hasNextPage: false }, threads: [] } } });
    }
    return original(input, init);
  };
  try {
    const list = await original(`${root}/discussions/154587?page=2&sort=new`);
    assert.equal(list.status, 200);
    assert.deepEqual(queries[0].variables, { id: 154587, page: 2, sort: ['CREATED_AT_DESC'] });
    assert.match(queries[0].query, /mediaCategoryId: \$id/);
    const replies = await original(`${root}/discussions/154587?thread=123&page=3`);
    assert.equal(replies.status, 200);
    assert.equal(queries[1].variables.id, 123);
    assert.equal(queries[1].variables.page, 3);
    assert.match(queries[1].query, /childComments/);
    const invalid = await original(`${root}/discussions/154587?page=-1`);
    assert.equal(invalid.status, 400);
    const post = await original(`${root}/discussions/like`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 123, type: 'THREAD' }) });
    assert.equal(post.status, 401);
    assert.equal(queries.length, 2);
    globalThis.fetch = async (input, init) => String(input) === 'https://graphql.anilist.co' ? Response.json({ errors: [{ message: 'Rate limited' }] }) : original(input, init);
    const failure = await original(`${root}/discussions/154587`);
    assert.equal(failure.status, 502);
  } finally { globalThis.fetch = original; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
