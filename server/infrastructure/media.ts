import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { once } from 'node:events';
import { ApiError } from './errors';
import { TtlCache } from './cache';

type PlaylistOptions = { playlistKey?: string; audioLanguage?: 'ja' | 'en' };
type Token = { url: string; origin: string; headers: Record<string, string>; expires: number; key: string; playlist: PlaylistOptions };
export const mediaTokenTtlMs = 2 * 60 * 60_000;
const dnsCache = new TtlCache<{ address: string; family: 4 | 6 }>(256, 30_000);

export function pinnedLookup(pinned: { address: string; family: 4 | 6 }): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [pinned]);
    else callback(null, pinned.address, pinned.family);
  };
}

function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 88 && c === 99) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (isIP(address) === 6) {
    const first = Number.parseInt(address.split(':')[0], 16);
    return first >= 0x2000 && first <= 0x3fff && !/^2001:(?:db8|0):|^2002:/i.test(address);
  }
  return false;
}

async function validated(url: URL): Promise<{ address: string; family: 4 | 6 }> {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname || url.port && !/^\d+$/.test(url.port)) {
    throw new ApiError('UNSUPPORTED_MEDIA', 'Unsafe media URL', 400);
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const cached = dnsCache.get(hostname);
  if (cached) return cached;
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await Promise.race([
    lookup(hostname, { all: true, verbatim: true }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new ApiError('TIMEOUT', 'Media DNS timed out', 504)), 3000).unref()),
  ]);
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new ApiError('UPSTREAM_BLOCKED', 'Media host is not public', 403);
  const first = addresses[0];
  const result = { address: first.address, family: first.family as 4 | 6 };
  dnsCache.set(hostname, result);
  return result;
}

function safeHeaders(input: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(input)) {
    if (/^[!#$%&'*+.^_`|~\w-]+$/.test(name) && !/^(host|connection|transfer-encoding|content-length|proxy-authorization)$/i.test(name) && !/[\r\n]/.test(value)) result[name] = value;
  }
  return result;
}

function crossHostHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => /^(referer|origin|user-agent|accept)$/i.test(name)));
}

export async function rewritePlaylist(text: string, base: URL, issue: (url: URL) => Promise<string>): Promise<string> {
  const lines = text.split(/\r?\n/);
  let references = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith('#')) {
      for (const reference of line.matchAll(/URI=("|')(.*?)\1/g)) {
        if (++references > 8192) throw new ApiError('UNSUPPORTED_MEDIA', 'Too many playlist assets', 502);
        const target = await issue(new URL(reference[2], base));
        lines[index] = lines[index].replace(reference[0], `URI=${reference[1]}${target}${reference[1]}`);
      }
    } else if (line.trim()) {
      if (++references > 8192) throw new ApiError('UNSUPPORTED_MEDIA', 'Too many playlist assets', 502);
      lines[index] = await issue(new URL(line.trim(), base));
    }
  }
  return lines.join('\n');
}

export function preparePlaylist(text: string, options: PlaylistOptions): string {
  if (!text.startsWith('#EXTM3U') && options.playlistKey) {
    const encoded = text.trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new ApiError('UNSUPPORTED_MEDIA', 'Invalid encrypted playlist', 502);
    const data = Buffer.from(encoded, 'base64'), key = Buffer.from(options.playlistKey, 'base64');
    if (key.length !== 32) throw new ApiError('UNSUPPORTED_MEDIA', 'Invalid playlist key', 502);
    for (let i = 0; i < data.length; i++) data[i] ^= key[i % key.length];
    text = data.toString('utf8');
  }
  if (!text.startsWith('#EXTM3U')) throw new ApiError('UNSUPPORTED_MEDIA', 'Invalid HLS playlist', 502);
  if (!options.audioLanguage) return text;
  const lines = text.split(/\r?\n/);
  const audio = lines.filter(line => /^#EXT-X-MEDIA:.*\bTYPE=AUDIO(?:,|$)/.test(line));
  if (!audio.length) return text;
  const language = options.audioLanguage === 'ja' ? /\bLANGUAGE="(?:ja|jpn)"/i : /\bLANGUAGE="(?:en|eng)"/i;
  const selected = audio.filter(line => language.test(line));
  const groups = new Set(audio.map(line => line.match(/\bGROUP-ID="([^"]+)"/)?.[1]));
  if ([...groups].some(group => !selected.some(line => line.includes(`GROUP-ID="${group}"`)))) throw new ApiError('UNSUPPORTED_MEDIA', 'Requested audio language is unavailable', 502);
  return lines.filter(line => !audio.includes(line) || selected.includes(line)).map(line => selected.includes(line) ? line.replace(/\bDEFAULT=(?:YES|NO)/, 'DEFAULT=YES') : line).join('\n');
}

async function upstream(url: URL, headers: Record<string, string>, method: 'GET' | 'HEAD', signal: AbortSignal, redirects = 0): Promise<{ response: IncomingMessage; url: URL }> {
  if (redirects > 5) throw new ApiError('UPSTREAM_BLOCKED', 'Too many media redirects', 502);
  const pinned = await validated(url);
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method, headers, signal, timeout: 12_000,
      lookup: pinnedLookup(pinned),
    }, resolve);
    request.on('timeout', () => request.destroy(new ApiError('TIMEOUT', 'Media upstream timed out', 504)));
    request.on('error', reject);
    request.end();
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
    const location = response.headers.location;
    response.destroy();
    if (!location) throw new ApiError('UPSTREAM_ERROR', 'Media redirect lacks location');
    const next = new URL(location, url);
    await validated(next);
    return upstream(next, next.origin === url.origin ? headers : crossHostHeaders(headers), method, signal, redirects + 1);
  }
  return { response, url };
}

export function createMediaProxy() {
  const tokens = new Map<string, Token>();
  const tokenKeys = new Map<string, string>();
  function remove(token: string) {
    const entry = tokens.get(token);
    if (entry) tokenKeys.delete(entry.key);
    tokens.delete(token);
  }
  async function issue(rawUrl: string, rawHeaders: Record<string, string> = {}, expiresAt?: number, playlist: PlaylistOptions = {}): Promise<string> {
    let url: URL;
    try { url = new URL(rawUrl); } catch { throw new ApiError('UNSUPPORTED_MEDIA', 'Invalid media URL', 400); }
    if (expiresAt !== undefined && !Number.isFinite(expiresAt)) throw new ApiError('UNSUPPORTED_MEDIA', 'Invalid media expiry', 502);
    const headers = safeHeaders(rawHeaders);
    const key = JSON.stringify([url.href, Object.entries(headers).sort(([first], [second]) => first.localeCompare(second)), expiresAt ?? null, playlist]);
    const existing = tokenKeys.get(key);
    if (existing && (tokens.get(existing)?.expires ?? 0) > Date.now()) return `/media/${existing}`;
    await validated(url);
    const token = randomBytes(24).toString('base64url');
    const expires = Math.min(Date.now() + mediaTokenTtlMs, expiresAt ?? Infinity);
    if (expires <= Date.now()) throw new ApiError('SOURCE_EXPIRED', 'Media source expired', 410);
    for (const [tokenId, item] of tokens) if (item.expires <= Date.now()) remove(tokenId);
    while (tokens.size >= 16384) remove(tokens.keys().next().value!);
    tokens.set(token, { url: url.href, origin: url.origin, headers, expires, key, playlist });
    tokenKeys.set(key, token);
    return `/media/${token}`;
  }

  async function handle(token: string, method: 'GET' | 'HEAD', range: string | undefined, response: ServerResponse, signal: AbortSignal): Promise<void> {
    const item = tokens.get(token);
    if (!item || item.expires <= Date.now()) throw new ApiError('SOURCE_EXPIRED', 'Media token expired', 410);
    const headers: Record<string, string> = { ...item.headers, 'Accept-Encoding': 'identity' };
    if (range) {
      if (!/^bytes=\d*-\d*(?:,\d*-\d*){0,4}$/.test(range)) throw new ApiError('INVALID_REQUEST', 'Invalid Range header', 400);
      headers.Range = range;
    }
    const { response: source, url } = await upstream(new URL(item.url), headers, method, signal);
    const status = source.statusCode ?? 502;
    if (status < 200 || status >= 300) {
      source.destroy();
      throw new ApiError(status === 403 ? 'UPSTREAM_BLOCKED' : 'UPSTREAM_ERROR', `Media upstream HTTP ${status}`, 502);
    }
    const playlist = method === 'GET' && (url.pathname.toLowerCase().endsWith('.m3u8') || /mpegurl/i.test(String(source.headers['content-type'] ?? '')));
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control']) {
      const value = source.headers[name];
      if (value && !(playlist && name === 'content-length')) response.setHeader(name, value);
    }
    response.setHeader('x-content-type-options', 'nosniff');
    if (!playlist) {
      response.writeHead(status);
      if (method === 'HEAD') { source.resume(); response.end(); return; }
      let bytes = 0;
      for await (const chunk of source) {
        if (signal.aborted) break;
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024 * 1024) { source.destroy(); response.destroy(); return; }
        if (!response.write(chunk)) await once(response, 'drain', { signal });
      }
      response.end();
      return;
    }
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of source) {
      length += chunk.length;
      if (length > 2 * 1024 * 1024) { source.destroy(); throw new ApiError('UNSUPPORTED_MEDIA', 'Playlist too large', 502); }
      chunks.push(chunk);
    }
    const text = preparePlaylist(Buffer.concat(chunks).toString('utf8'), item.playlist);
    const rewritten = await rewritePlaylist(text, url, child => issue(child.href, child.origin === item.origin ? item.headers : crossHostHeaders(item.headers), item.expires, item.playlist));
    response.setHeader('content-type', 'application/vnd.apple.mpegurl');
    response.writeHead(status);
    response.end(rewritten);
  }
  async function read(path: string, signal: AbortSignal) {
    const item = tokens.get(path.replace(/^\/media\//, ''));
    if (!item || item.expires <= Date.now()) throw new ApiError('SOURCE_EXPIRED', 'Media token expired', 410);
    const { response, url } = await upstream(new URL(item.url), { ...item.headers, 'Accept-Encoding': 'identity' }, 'GET', signal);
    if (response.statusCode !== 200) { response.destroy(); throw new ApiError('UPSTREAM_ERROR', `Download source HTTP ${response.statusCode}`, 502); }
    const type = String(response.headers['content-type'] || 'application/octet-stream');
    if (url.pathname.toLowerCase().endsWith('.m3u8') || /mpegurl/i.test(type)) {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) { response.destroy(); throw new ApiError('UNSUPPORTED_MEDIA', 'Playlist too large', 502); }
        chunks.push(chunk);
      }
      const text = preparePlaylist(Buffer.concat(chunks).toString('utf8'), item.playlist);
      const playlist = await rewritePlaylist(text, url, child => issue(child.href, child.origin === item.origin ? item.headers : crossHostHeaders(item.headers), item.expires, item.playlist));
      return { body: (async function* () { yield Buffer.from(playlist); })(), type: 'application/vnd.apple.mpegurl', length: Buffer.byteLength(playlist) };
    }
    return { body: response as AsyncIterable<Buffer>, type, length: Number(response.headers['content-length']) || 0 };
  }
  return { issue, handle, read };
}
