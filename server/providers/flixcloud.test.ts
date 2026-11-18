import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCipheriv, createHash, pbkdf2Sync } from 'node:crypto';
import { decryptFlixcloud, flixcloudFields, parseFlixcloudData, resolveFlixcloud } from '../extractors/flixcloud.js';

const wasm = Buffer.from(JSON.parse(readFileSync(new URL('./fixtures/flixcloud-mixer.json', import.meta.url), 'utf8')).wasm, 'base64');
const seed = '1234567890abcdef1234567890abcdef';
const token = 'abcdef0123456789abcdef01';
const hash = (x: string | Uint8Array) => createHash('sha256').update(x).digest('hex');
const b64 = (x: Uint8Array) => Buffer.from(x).toString('base64');
const signal = () => new AbortController().signal;

async function fixture(url = 'https://cdn.example/video.m3u8') {
  const fields = flixcloudFields(seed);
  const parts = [0, 1, 2].map(n => Buffer.alloc(32, n + 1));
  const { instance } = await WebAssembly.instantiate(wasm);
  const { memory, _s, _r, _c } = instance.exports as unknown as { memory: WebAssembly.Memory; _s: (n: number) => void; _r: (...n: number[]) => void; _c: () => number };
  parts.forEach((part, i) => new Uint8Array(memory.buffer).set(part, 1000 + 32 * i));
  _s(parseInt(seed.slice(0, 8), 16)); _r(1000, 1032, 1064, 1096, 32);
  const mixed = new Uint8Array(memory.buffer).slice(1096, 1128);
  const playlistKey = b64(new Uint8Array(memory.buffer).slice(_c(), _c() + 32));
  const derived = pbkdf2Sync(mixed, seed, 1000, 32, 'sha256');
  for (let i = 0; i < 32; i++) derived[i] ^= seed.charCodeAt(i % seed.length);
  const iv = Buffer.alloc(16, 7);
  const cipher = createCipheriv('aes-256-cbc', Buffer.from(hash(derived), 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(url), cipher.final()]);
  const data: Record<string, any> = { obfuscation_seed: seed, w_payload: b64(wasm), [fields.token]: token, [fields.fragment]: b64(parts[1]), obfuscated_crypto_data: { [fields.container]: { [fields.array]: [{ [fields.object]: { [fields.key]: b64(parts[0]), [fields.iv]: b64(iv) } }] } } };
  const response: Record<string, string> = { [hash(token + 'vid').slice(0, 10)]: b64(encrypted), [hash(token + 'key').slice(0, 10)]: b64(parts[2]) };
  return { data, response, playlistKey, fields };
}

test('decrypts an independently encrypted URL and returns the playlist key', async () => {
  const { data, response, playlistKey } = await fixture();
  assert.deepEqual(await decryptFlixcloud(data, response, signal()), { url: 'https://cdn.example/video.m3u8', playlistKey });
  assert.equal(Buffer.from(playlistKey, 'base64').length, 32);
});

test('rejects malformed crypto fields, unsafe URLs and cancellation', async () => {
  for (const mutation of [
    (f: any) => { f.data.obfuscation_seed = 'bad'; },
    (f: any) => { f.data[f.fields.token] = 'bad'; },
    (f: any) => { f.response[hash(token + 'vid').slice(0, 10)] = '!'; },
    (f: any) => { f.data.obfuscated_crypto_data[f.fields.container][f.fields.array][0][f.fields.object][f.fields.iv] = 'AA=='; },
  ]) { const f = await fixture(); mutation(f); await assert.rejects(decryptFlixcloud(f.data, f.response, signal()), { code: 'UNSUPPORTED_MEDIA' }); }
  const unsafe = await fixture('http://example.com/video.m3u8');
  await assert.rejects(decryptFlixcloud(unsafe.data, unsafe.response, signal()), { code: 'UNSUPPORTED_MEDIA' });
  const controller = new AbortController(); const reason = new Error('cancelled'); controller.abort(reason);
  const f = await fixture(); await assert.rejects(decryptFlixcloud(f.data, f.response, controller.signal), e => e === reason);
});

test('rejects invalid reference tables', () => {
  for (const data of [[{ obfuscation_seed: 1 }, { loop: 1 }], [{ obfuscation_seed: 5 }], [{ obfuscation_seed: 0 }]]) {
    assert.throws(() => parseFlixcloudData({ nodes: [{ data }] }), { code: 'UNSUPPORTED_MEDIA' });
  }
});

test('rejects unsupported embeds before fetching', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = (async () => { calls++; throw Error('unexpected'); }) as typeof fetch;
  try { await assert.rejects(resolveFlixcloud('https://example.com/e/abc?v=1', 'sub', signal()), { code: 'UNSUPPORTED_MEDIA' }); assert.equal(calls, 0); }
  finally { globalThis.fetch = original; }
});

test('resolves data and token routes with subtitles and chapters', async () => {
  const f = await fixture();
  Object.assign(f.data, { subtitles: [{ language: 'English', url: 'https://cdn.example/sub.ass' }], intro_chapter: { start: 10, end: 20 }, outro_chapter: { start: 80, end: 90 } });
  const table: any[] = [];
  function add(value: any): number {
    const index = table.length; table.push(null);
    table[index] = Array.isArray(value) ? value.map(add) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, add(v)])) : value;
    return index;
  }
  add(f.data);
  const original = globalThis.fetch; const urls: string[] = [];
  globalThis.fetch = (async (input: any) => { const url = String(input); urls.push(url); return new Response(JSON.stringify(url.includes('__data.json') ? { nodes: [{ data: table }] } : f.response), { headers: { 'content-type': 'application/json' } }); }) as typeof fetch;
  try {
    const result = await resolveFlixcloud('https://flixcloud.cc/e/abc?v=1', 'sub', signal());
    assert.equal(urls.length, 2);
    assert.match(urls[0], /\/e\/abc\/__data\.json\?v=1&audio=sub/);
    assert.equal(urls[1], `https://flixcloud.cc/api/m3u8/${token}`);
    assert.equal(result.playlistKey, f.playlistKey);
    assert.deepEqual(result.subtitles, [{ url: 'https://cdn.example/sub.ass', label: 'English', language: 'en', format: 'ass' }]);
    assert.deepEqual(result.intro, { start: 10, end: 20 });
    assert.deepEqual(result.outro, { start: 80, end: 90 });
    assert.equal(result.audioLanguage, 'ja');
  } finally { globalThis.fetch = original; }
});
