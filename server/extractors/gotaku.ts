import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { ApiError } from '../infrastructure/errors';
import { record, request, userAgent } from '../providers/common';

export const gotakuOrigin = 'https://gotaku.to';
const playerOrigin = 'https://gotakuplay.nl';
export const gotakuApiVersion = 10;

// These public client constants come from Gotaku's main and player bundles.
const apiMaterial = Buffer.from('1e63ceecb01ae4933723987b06117eb328b5c5d2c25ae823f714822b47757b52', 'hex');
const playerKey = Buffer.from('458e5403c40a73332706df406193dd6b040a2ea97a6bb59b52b294a61006e6ef', 'hex');
const derive = (key: Uint8Array, salt: Uint8Array | string, info: string) =>
  Buffer.from(hkdfSync('sha256', key, salt, info, 32));
const apiKey = derive(apiMaterial, Buffer.alloc(0), 'api-seal|v1');

const unsupported = (message: string) => new ApiError('UNSUPPORTED_MEDIA', message, 502, 'gotaku');

function openGcm(packet: Buffer, key: Buffer): Buffer {
  if (packet.length <= 28) throw Error('Invalid AES-GCM frame');
  const decipher = createDecipheriv('aes-256-gcm', key, packet.subarray(0, 12));
  decipher.setAuthTag(packet.subarray(-16));
  return Buffer.concat([decipher.update(packet.subarray(12, -16)), decipher.final()]);
}

export function decodeGotakuApi(packet: Buffer): unknown {
  try {
    if (packet[0] !== gotakuApiVersion) throw Error('Unknown version');
    const body = inflateSync(openGcm(packet.subarray(1), apiKey), { maxOutputLength: 8 * 1024 * 1024 });
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new ApiError('UPSTREAM_ERROR', 'Invalid Gotaku API envelope', 502, 'gotaku');
  }
}

function safeHttps(value: unknown): URL | undefined {
  if (typeof value !== 'string' || value.length > 4096 || !/^https:\/\//i.test(value)) return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash) return url;
  } catch {}
}

export function gotakuEmbedUrl(value: unknown): URL {
  const url = safeHttps(value);
  if (!url || url.origin !== playerOrigin || !/^\/embed\/[A-Za-z0-9_-]{1,256}$/.test(url.pathname)) {
    throw unsupported('Unsupported Gotaku embed host or URL');
  }
  return url;
}

export function gotakuManifestAttributes(html: string): { endpoint: URL; stamp: string } {
  const body = html.match(/<body\b[^>]*>/i)?.[0] ?? '';
  const endpoint = safeHttps(body.match(/\bdata-manifest-base="([^"]+)"/)?.[1]);
  const stamp = body.match(/\bdata-manifest-stamp="([^"]+)"/)?.[1];
  if (!endpoint || endpoint.origin !== playerOrigin || endpoint.search ||
      !/^\/embed\/\d{1,12}\/manifest$/.test(endpoint.pathname) ||
      !stamp || !/^\d{10}\.[A-Za-z0-9_-]{16,128}$/.test(stamp)) {
    throw unsupported('Invalid Gotaku player manifest attributes');
  }
  return { endpoint, stamp };
}

export function gotakuManifestRequest(stamp: string, nonce: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', playerKey, iv);
  const body = Buffer.from(JSON.stringify({ nonce: nonce.toString('base64url'), stamp }));
  return Buffer.concat([iv, cipher.update(body), cipher.final(), cipher.getAuthTag()]).toString('base64url');
}

export type GotakuManifest = {
  source: string;
  keySeed: string;
  token: string;
  expiresAt: number;
  segmentBytes: 8192;
};

const playlistPath = /^\/p\/\d+\/\d{10}\/([A-Za-z0-9_-]{22})\/[A-Za-z0-9_-]+$/;
const segmentPath = /^\/s\/\d+\/([A-Za-z0-9_-]+)(?:\.[A-Za-z0-9]+)?$/;

export function decodeGotakuManifest(encoded: string, nonce: Buffer): GotakuManifest {
  try {
    const packet = encoded.trim();
    if (!/^[A-Za-z0-9_-]{39,65536}$/.test(packet) || nonce.length !== 16) throw Error('Invalid manifest frame');
    const key = derive(playerKey, nonce, 'manifest-resp|v1');
    const data = record(JSON.parse(openGcm(Buffer.from(packet, 'base64url'), key).toString('utf8')));
    const source = safeHttps(data?.source);
    const seed = data?.keySeed;
    const token = data?.token;
    const expiresAt = data?.expiresAt;
    const obf = record(data?.obf);
    if (!source || !source.hostname.endsWith('.top') || !playlistPath.test(source.pathname) ||
        typeof seed !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(seed) ||
        typeof token !== 'string' || playlistPath.exec(source.pathname)?.[1] !== token ||
        typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt <= 0 || expiresAt > 9_999_999_999 ||
        obf?.version !== 1 || obf.segmentBytes !== 8192) throw Error('Unknown media format');
    return { source: source.href, keySeed: seed, token, expiresAt: expiresAt * 1000, segmentBytes: obf.segmentBytes };
  } catch {
    throw unsupported('Invalid Gotaku media manifest');
  }
}

export function decodeGotakuPlaylist(packet: Buffer, url: URL, manifest: Pick<GotakuManifest, 'keySeed'>): string {
  const token = playlistPath.exec(url.pathname)?.[1];
  if (!token) throw unsupported('Invalid Gotaku playlist URL');
  try {
    const key = derive(Buffer.from(manifest.keySeed, 'base64url'), token, 'pl|v1');
    const text = openGcm(packet, key).toString('utf8');
    if (!/^#EXTM3U(?:\r?\n|$)/.test(text)) throw Error('Missing HLS signature');
    return text;
  } catch {
    throw unsupported('Invalid Gotaku playlist');
  }
}

export function decodeGotakuSegment(packet: Buffer, url: URL, offset: number, manifest: Pick<GotakuManifest, 'keySeed' | 'segmentBytes'>): Buffer {
  const asset = segmentPath.exec(url.pathname)?.[1];
  if (!asset || !Number.isSafeInteger(offset) || offset < 0) throw unsupported('Invalid Gotaku segment');
  if (offset >= manifest.segmentBytes) return packet;
  const iv = Buffer.alloc(16);
  createHash('sha256').update(asset).digest().copy(iv, 0, 0, 8);
  const cipher = createCipheriv('aes-256-ctr', Buffer.from(manifest.keySeed, 'base64url'), iv);
  cipher.update(Buffer.alloc(offset));
  const length = Math.min(packet.length, manifest.segmentBytes - offset);
  return Buffer.concat([cipher.update(packet.subarray(0, length)), packet.subarray(length)]);
}

export async function resolveGotakuEmbed(value: unknown, signal: AbortSignal): Promise<{ manifest: GotakuManifest; headers: Record<string, string> }> {
  signal.throwIfAborted();
  const embed = gotakuEmbedUrl(value);
  const html = await (await request(embed.href, 'gotaku', signal, gotakuOrigin + '/')).text();
  const { endpoint, stamp } = gotakuManifestAttributes(html);
  const nonce = randomBytes(16);
  endpoint.pathname += '/' + gotakuManifestRequest(stamp, nonce);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
      redirect: 'error',
      headers: { Accept: 'text/plain', Referer: embed.href, 'User-Agent': userAgent },
    });
  } catch {
    signal.throwIfAborted();
    throw new ApiError('UPSTREAM_ERROR', 'Gotaku player manifest request failed', 502, 'gotaku');
  }
  const reader = response.body?.getReader();
  if (!response.ok || !reader) {
    await reader?.cancel();
    throw new ApiError('UPSTREAM_ERROR', `Gotaku player manifest returned HTTP ${response.status}`, 502, 'gotaku');
  }
  const parts: Buffer[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 65536) {
        await reader.cancel();
        throw unsupported('Gotaku media manifest is too large');
      }
      parts.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  signal.throwIfAborted();
  const manifest = decodeGotakuManifest(Buffer.concat(parts).toString('utf8'), nonce);
  if (manifest.expiresAt <= Date.now()) throw new ApiError('SOURCE_EXPIRED', 'Gotaku media session expired', 410, 'gotaku');
  return { manifest, headers: { Referer: playerOrigin + '/', Origin: playerOrigin, 'User-Agent': userAgent } };
}
