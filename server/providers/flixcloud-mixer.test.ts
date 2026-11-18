import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mixFlixcloudKey } from '../extractors/flixcloud-mixer.js';

const wasm = Buffer.from(JSON.parse(readFileSync(new URL('./fixtures/flixcloud-mixer.json', import.meta.url), 'utf8')).wasm, 'base64');
const fragments = [0, 1, 2].map(n => Uint8Array.from({ length: 32 }, (_, i) => i + n)) as [Uint8Array, Uint8Array, Uint8Array];

test('mixes the fixture like the original module', async () => {
  const { instance } = await WebAssembly.instantiate(wasm);
  const { memory, _s, _r, _c } = instance.exports as unknown as { memory: WebAssembly.Memory; _s: (seed: number) => void; _r: (...args: number[]) => void; _c: () => number };
  fragments.forEach((part, i) => new Uint8Array(memory.buffer).set(part, 1000 + i * 32));
  _s(123); _r(1000, 1032, 1064, 1096, 32);
  const mixed = new Uint8Array(memory.buffer).slice(1096, 1128);
  const playlistKey = new Uint8Array(memory.buffer).slice(_c(), _c() + 32);
  assert.deepEqual(await mixFlixcloudKey(wasm, fragments, 123, new AbortController().signal), { mixed, playlistKey });
});

test('rejects malformed inputs and preserves abort reason', async () => {
  await assert.rejects(mixFlixcloudKey(new Uint8Array(4097), fragments, 0, new AbortController().signal), { code: 'UNSUPPORTED_MEDIA', provider: 'reanime' });
  await assert.rejects(mixFlixcloudKey(wasm, [new Uint8Array(1), fragments[1], fragments[2]], 0, new AbortController().signal), { code: 'UNSUPPORTED_MEDIA' });
  const controller = new AbortController();
  const reason = new Error('cancelled');
  const pending = mixFlixcloudKey(wasm, fragments, 0, controller.signal);
  controller.abort(reason);
  await assert.rejects(pending, e => e === reason);
});

test('terminates a mixer that loops forever', async () => {
  // One exported function loops; all required function exports point to it.
  const loop = Uint8Array.from([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,5,3,1,0,1,7,25,4,6,109,101,109,111,114,121,2,0,2,95,115,0,0,2,95,114,0,0,2,95,99,0,0,10,9,1,7,0,3,64,12,0,11,11]);
  const start = Date.now();
  await assert.rejects(mixFlixcloudKey(loop, fragments, 0, new AbortController().signal), { code: 'UNSUPPORTED_MEDIA' });
  assert.ok(Date.now() - start >= 900);
});

test('rejects imports, shared memory and oversized initial memory before execution', async () => {
  // Locate the fixture's single-page memory declaration and change only its flags or minimum.
  const memory = wasm.indexOf(Buffer.from([5, 3, 1, 0, 1]));
  assert.ok(memory > 0);
  const shared = Buffer.from(wasm); shared[memory + 3] = 3;
  const huge = Buffer.from(wasm); huge[memory + 4] = 127;
  const imports = Buffer.concat([wasm.subarray(0, 8), Buffer.from([2, 1, 0]), wasm.subarray(8)]);
  for (const input of [shared, huge, imports]) await assert.rejects(mixFlixcloudKey(input, fragments, 0, new AbortController().signal), { code: 'UNSUPPORTED_MEDIA' });
});

