import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AccountService } from '../account';

function response() {
  const headers = new Map<string, unknown>();
  return { getHeader: (key: string) => headers.get(key), setHeader: (key: string, value: unknown) => headers.set(key, value), headers };
}
const request = (cookie = '') => ({ headers: { cookie } }) as IncomingMessage;
const asResponse = (value: ReturnType<typeof response>) => value as unknown as ServerResponse;
const cookies = (value: ReturnType<typeof response>) => value.headers.get('set-cookie') as string[];
const signal = () => AbortSignal.timeout(10000);

test('default relay without environment configuration keeps secrets server-side, binds browser and survives restart without OAuth credentials', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'moewatch-relay-client-'));
  const names = ['MOEWATCH_AUTH_RELAY_URL', 'MOEWATCH_SESSION_FILE', 'ANILIST_CLIENT_ID', 'ANILIST_CLIENT_SECRET', 'ID', 'SECRET'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  names.forEach(name => delete process.env[name]);
  process.env.MOEWATCH_SESSION_FILE = join(directory, 'sessions.json');
  const original = globalThis.fetch; let challenge = ''; let claimed = 0;
  globalThis.fetch = (async (input, init) => {
    if (String(input) === 'https://moewatch-signin.mqt464.workers.dev/v1/login') { challenge = JSON.parse(String(init?.body)).challenge; return Response.json({ id: 'a'.repeat(43), authorizeUrl: 'https://moewatch-signin.mqt464.workers.dev/authorize?id=public', expiresAt: Date.now() + 600000 }); }
    if (String(input).endsWith('/claim')) {
      const verifier = JSON.parse(String(init?.body)).verifier;
      assert.equal(createHash('sha256').update(verifier).digest('base64url'), challenge); claimed++;
      return Response.json({ status: 'complete', accessToken: 'relay-private-token', expiresAt: Date.now() + 3600000 });
    }
    if (String(input) === 'https://graphql.anilist.co') return Response.json({ data: { Viewer: { id: 9, name: 'Relay Viewer' } } });
    throw new Error('Unexpected request');
  }) as typeof fetch;
  try {
    const service = new AccountService(); const res = response();
    const started = await service.startLogin(request(), asResponse(res), signal());
    assert.equal(JSON.stringify(started).includes('verifier'), false);
    const cookie = cookies(res).find(c => c.startsWith('moewatch_relay_login=') && !c.startsWith('moewatch_relay_login=;'))!.split(';')[0];
    assert.match(cookies(res).at(-1)!, /HttpOnly; SameSite=Lax/);
    await assert.rejects(service.pollLogin(request(), asResponse(response()), signal()), /expired/);
    const complete = response();
    assert.deepEqual(await service.pollLogin(request(cookie), asResponse(complete), signal()), { status: 'complete' });
    assert.equal(claimed, 1);
    await assert.rejects(service.pollLogin(request(cookie), asResponse(response()), signal()), /expired/);
    const session = cookies(complete).find(c => c.startsWith('moewatch_session='))!.split(';')[0];
    assert.equal(readFileSync(join(directory, 'sessions.json'), 'utf8').includes('relay-private-token'), false);
    assert.equal(readFileSync(join(directory, 'session-key.bin')).length, 32);
    assert.equal((await new AccountService().status(request(session))).user?.name, 'Relay Viewer');
    assert.equal(process.env.ANILIST_CLIENT_ID, undefined);
    const another = response();
    await service.startLogin(request(), asResponse(another), signal());
    const anotherCookie = cookies(another).at(-1)!.split(';')[0];
    service.cancelLogin(request(anotherCookie), asResponse(response()));
    await assert.rejects(service.pollLogin(request(anotherCookie), asResponse(response()), signal()), /expired/);
    assert.equal(claimed, 1);
  } finally {
    globalThis.fetch = original;
    for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('legacy direct sessions migrate atomically to installation key and survive credential removal', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'moewatch-relay-migration-'));
  const names = ['MOEWATCH_AUTH_RELAY_URL', 'MOEWATCH_SESSION_FILE', 'ANILIST_CLIENT_ID', 'ANILIST_CLIENT_SECRET'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  process.env.MOEWATCH_AUTH_RELAY_URL = 'https://relay.example'; process.env.MOEWATCH_SESSION_FILE = join(directory, 'sessions.json');
  process.env.ANILIST_CLIENT_ID = 'legacy-client'; process.env.ANILIST_CLIENT_SECRET = 'legacy-secret';
  const id = randomBytes(32).toString('base64url'); const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update('moewatch-sessions-v1:legacy-client:legacy-secret').digest(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify([[id, { accessToken: 'legacy-token', expiresAt: Date.now() + 3600000, user: { id: 77, name: 'Legacy', avatar: '' } }]])), cipher.final()]);
  const file = join(directory, 'sessions.json');
  writeFileSync(file, JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }));
  const old = readFileSync(file, 'utf8');
  try {
    assert.equal((await new AccountService().status(request(`moewatch_session=${id}`))).user?.name, 'Legacy');
    assert.notEqual(readFileSync(file, 'utf8'), old);
    delete process.env.ANILIST_CLIENT_ID; delete process.env.ANILIST_CLIENT_SECRET;
    assert.equal((await new AccountService().status(request(`moewatch_session=${id}`))).user?.name, 'Legacy');
  } finally {
    for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; }
    rmSync(directory, { recursive: true, force: true });
  }
});
