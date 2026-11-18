import { createHash, createDecipheriv, pbkdf2Sync } from 'node:crypto';
import type { AudioPreference, ResolvedPlayback } from '../../shared/api';
import { ApiError } from '../infrastructure/errors';
import { absoluteUrl, json, media, record, userAgent } from '../providers/common';
import { mixFlixcloudKey } from './flixcloud-mixer';

const base = 'https://flixcloud.cc';
const unsupported = () => new ApiError('UNSUPPORTED_MEDIA', 'Unsupported FlixCloud player payload', 502, 'reanime');

// SvelteKit data is a JSON table of references. Never evaluate the page's JavaScript.
export function parseFlixcloudData(payload: unknown): Record<string, unknown> {
  const nodes = record(payload)?.nodes;
  if (!Array.isArray(nodes)) throw unsupported();
  for (const node of nodes) {
    const raw = record(node)?.data;
    if (!Array.isArray(raw) || raw.length > 10000 || !record(raw[0])?.obfuscation_seed) continue;
    const table: unknown[] = raw;
    let budget = 50000;
    const active = new Set<number>();
    function read(index: unknown, depth = 0): unknown {
      if (--budget < 0 || depth > 32 || !Number.isInteger(index)) throw unsupported();
      if (index === -1) return undefined;
      const n = index as number;
      if (n < 0 || n >= table.length || active.has(n)) throw unsupported();
      const value: unknown = table[n];
      if (!value || typeof value !== 'object') return value;
      active.add(n);
      const result = Array.isArray(value) ? value.map(ref => read(ref, depth + 1)) : Object.fromEntries(Object.entries(value).map(([key, ref]) => [key, read(ref, depth + 1)]));
      active.delete(n);
      return result;
    }
    return record(read(0))!;
  }
  throw unsupported();
}

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export function flixcloudFields(seed: string) {
  if (!/^[a-f0-9]{16,128}$/i.test(seed)) throw unsupported();
  let first = seed;
  for (let i = 0; i < 3; i++) first = hash(first + i);
  let second = first;
  for (let i = 0; i < 3; i++) second = hash(second + i);
  return { container: `cd_${first.slice(24, 32)}`, array: `ad_${first.slice(32, 40)}`, object: `od_${first.slice(40, 48)}`, key: `kf_${first.slice(8, 16)}`, iv: `ivf_${first.slice(16, 24)}`, token: `${first.slice(48, 64)}_${first.slice(56, 64)}`, fragment: `${second.slice(0, 16)}_${second.slice(16, 24)}` };
}

function bytes(value: unknown, length?: number): Buffer {
  if (typeof value !== 'string' || value.length > 8192 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw unsupported();
  const result = Buffer.from(value, 'base64');
  if (length !== undefined && result.length !== length) throw unsupported();
  return result;
}

export async function decryptFlixcloud(data: Record<string, unknown>, tokenResponse: unknown, signal: AbortSignal): Promise<{ url: string; playlistKey: string }> {
  signal.throwIfAborted();
  const seed = String(data.obfuscation_seed ?? '');
  const fields = flixcloudFields(seed);
  const container = record(record(data.obfuscated_crypto_data)?.[fields.container]);
  const array = container?.[fields.array];
  const crypto = record(Array.isArray(array) ? record(array[0])?.[fields.object] : undefined);
  const token = data[fields.token];
  if (typeof token !== 'string' || !/^[a-f0-9]{24}$/i.test(token)) throw unsupported();
  const response = record(tokenResponse);
  const encrypted = bytes(response?.[hash(token + 'vid').slice(0, 10)]);
  const { mixed, playlistKey } = await mixFlixcloudKey(bytes(data.w_payload), [bytes(crypto?.[fields.key], 32), bytes(data[fields.fragment], 32), bytes(response?.[hash(token + 'key').slice(0, 10)], 32)], parseInt(seed.slice(0, 8), 16), signal);
  signal.throwIfAborted();
  const derived = pbkdf2Sync(mixed, seed, 1000, 32, 'sha256');
  for (let i = 0; i < derived.length; i++) derived[i] ^= seed.charCodeAt(i % seed.length);
  try {
    const decipher = createDecipheriv('aes-256-cbc', Buffer.from(hash(derived), 'hex'), bytes(crypto?.[fields.iv], 16));
    const url = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    const safe = absoluteUrl(url, base);
    if (!safe || !/^https:\/\//.test(url) || !new URL(safe).pathname.endsWith('.m3u8')) throw unsupported();
    return { url: safe, playlistKey: Buffer.from(playlistKey).toString('base64') };
  } catch { throw unsupported(); }
}

export async function resolveFlixcloud(rawUrl: string, audio: AudioPreference, signal: AbortSignal): Promise<ResolvedPlayback> {
  const url = new URL(rawUrl);
  if (url.origin !== base || !/^\/e\/[a-z0-9]{1,64}$/i.test(url.pathname) || !['1', '2', '3'].includes(url.searchParams.get('v') ?? '')) throw unsupported();
  const dataUrl = new URL(`${url.pathname}/__data.json`, base);
  dataUrl.searchParams.set('v', url.searchParams.get('v')!);
  dataUrl.searchParams.set('audio', audio);
  const data = parseFlixcloudData(await json(dataUrl.href, 'reanime', signal, `${base}/`));
  const fields = flixcloudFields(String(data.obfuscation_seed ?? ''));
  const token = data[fields.token];
  if (typeof token !== 'string' || !/^[a-f0-9]{24}$/i.test(token)) throw unsupported();
  const response = await json(`${base}/api/m3u8/${token}`, 'reanime', signal, url.href);
  const source = await decryptFlixcloud(data, response, signal);
  const tracks = Array.isArray(data.subtitles) ? data.subtitles.map(item => {
    const track = record(item);
    const label = String(track?.language ?? 'Unknown');
    return { file: track?.url, label, language: /^English\b/i.test(label) ? 'en' : label };
  }) : [];
  const interval = (value: unknown) => { const entry = record(value); return [entry?.start, entry?.end]; };
  return { ...media({ sources: { file: source.url }, tracks, image: data.thumbnail, intro: interval(data.intro_chapter), outro: interval(data.outro_chapter) }, base, 'reanime'), playlistKey: source.playlistKey, audioLanguage: audio === 'dub' ? 'en' : 'ja', headers: { Referer: `${base}/`, Origin: base, 'User-Agent': userAgent } };
}
