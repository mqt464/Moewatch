import { Worker } from 'node:worker_threads';
import { ApiError } from '../infrastructure/errors.js';

const unsupported = () => new ApiError('UNSUPPORTED_MEDIA', 'Invalid FlixCloud mixer', 502, 'reanime');

// Only the memory section is rewritten; WebAssembly validates the remaining sections in the worker.
function boundedModule(bytes: Uint8Array): Uint8Array {
  if (bytes.length > 4096 || bytes.length < 8 || ![0,97,115,109,1,0,0,0].every((v, i) => bytes[i] === v)) throw unsupported();
  let pos = 8, memory = false;
  const result = Array.from(bytes.slice(0, 8));
  const read = (end: number) => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      if (pos >= end) throw unsupported();
      const b = bytes[pos++];
      if (i === 4 && (b & 0xf0)) throw unsupported();
      value += (b & 127) * 2 ** (7 * i);
      if (!(b & 128)) return value;
    }
    throw unsupported();
  };
  while (pos < bytes.length) {
    const start = pos, id = bytes[pos++], size = read(bytes.length), body = pos, end = body + size;
    if (end > bytes.length || id > 12 || id === 2 || id === 4 || id === 8) throw unsupported();
    if (id === 5) {
      if (memory || read(end) !== 1) throw unsupported();
      memory = true;
      const flags = read(end), min = read(end);
      if (flags > 1 || min > 1) throw unsupported();
      if (flags === 1 && read(end) < min) throw unsupported();
      if (pos !== end) throw unsupported();
      result.push(5, 4, 1, 1, min, 2);
    } else result.push(...bytes.slice(start, end));
    pos = end;
  }
  if (!memory) throw unsupported();
  return Uint8Array.from(result);
}

const workerSource = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const { instance } = await WebAssembly.instantiate(workerData.wasm, {});
  const { memory, _s, _r, _c } = instance.exports;
  if (!(memory instanceof WebAssembly.Memory) || typeof _s !== 'function' || typeof _r !== 'function' || typeof _c !== 'function') throw Error('exports');
  const data = new Uint8Array(memory.buffer);
  workerData.fragments.forEach((part, i) => data.set(part, 1000 + i * 32));
  _s(workerData.seed);
  _r(1000, 1032, 1064, 1096, 32);
  const mixed = new Uint8Array(memory.buffer).slice(1096, 1128);
  const offset = _c();
  if (!Number.isInteger(offset) || offset < 0 || offset + 32 > memory.buffer.byteLength) throw Error('key');
  parentPort.postMessage({ mixed, playlistKey: new Uint8Array(memory.buffer).slice(offset, offset + 32) });
})().catch(() => { throw Error('mixer failed'); });
`;

export async function mixFlixcloudKey(wasm: Uint8Array, fragments: [Uint8Array, Uint8Array, Uint8Array], seed: number, signal: AbortSignal): Promise<{ mixed: Uint8Array; playlistKey: Uint8Array }> {
  if (signal.aborted) throw signal.reason;
  if (!(wasm instanceof Uint8Array) || !Array.isArray(fragments) || fragments.length !== 3 || fragments.some(f => !(f instanceof Uint8Array) || f.length !== 32) || !Number.isInteger(seed)) throw unsupported();
  const bounded = boundedModule(wasm);
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerSource, { eval: true, execArgv: [], workerData: { wasm: bounded, fragments, seed }, resourceLimits: { maxOldGenerationSizeMb: 16, maxYoungGenerationSizeMb: 4, stackSizeMb: 1 } });
    let settled = false;
    const finish = (error?: unknown, value?: { mixed: Uint8Array; playlistKey: Uint8Array }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      void worker.terminate();
      if (error !== undefined) reject(error); else resolve(value!);
    };
    const abort = () => finish(signal.reason);
    const timer = setTimeout(() => finish(unsupported()), 1000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    worker.once('message', value => finish(undefined, value));
    worker.once('error', () => finish(unsupported()));
    worker.once('exit', () => finish(unsupported()));
  });
}
