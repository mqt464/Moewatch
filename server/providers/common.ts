import type { AnimeIdentity, ProviderId, ProviderTitle, ResolvedPlayback, TitleMatch } from '../../shared/api';
import { ApiError } from '../infrastructure/errors';

export const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export function origin(value: string, provider: ProviderId): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error();
    return url.origin;
  } catch { throw new ApiError('INVALID_REQUEST', 'Invalid provider origin', 500, provider); }
}

export function absoluteUrl(value: unknown, base: string): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return;
  try {
    const url = new URL(value, base);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch {}
}

export function idEncode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function idDecode<T>(value: string, provider: ProviderId): T {
  if (!/^[A-Za-z0-9_-]{1,8192}$/.test(value)) throw new ApiError('INVALID_REQUEST', 'Invalid provider ID', 400, provider);
  try {
    const json = Buffer.from(value, 'base64url').toString('utf8');
    if (json.length > 8192) throw Error();
    return JSON.parse(json) as T;
  } catch { throw new ApiError('INVALID_REQUEST', 'Invalid provider ID', 400, provider); }
}

export function sameOriginUrl(value: unknown, base: string, provider: ProviderId): URL {
  const url = absoluteUrl(value, base);
  if (!url || new URL(url).origin !== base) throw new ApiError('INVALID_REQUEST', 'Invalid provider URL', 400, provider);
  return new URL(url);
}

export async function request(url: string, provider: ProviderId, signal: AbortSignal, referer?: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]), redirect: 'error', headers: { 'User-Agent': userAgent, Accept: 'application/json, text/html, */*', ...(referer ? { Referer: referer } : {}), 'X-Requested-With': 'XMLHttpRequest' } });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiError(error instanceof DOMException && error.name === 'TimeoutError' ? 'TIMEOUT' : 'UPSTREAM_ERROR', 'Provider request failed', 502, provider);
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 404) throw new ApiError('NOT_FOUND', 'Provider resource not found', 404, provider);
    if (response.status === 429) throw new ApiError('RATE_LIMITED', 'Provider rate limited request', 429, provider);
    if (response.status === 401 || response.status === 403) throw new ApiError('UPSTREAM_BLOCKED', 'Provider blocked request', 502, provider);
    throw new ApiError('UPSTREAM_ERROR', `Provider returned HTTP ${response.status}`, 502, provider);
  }
  if (!response.body) return response;
  if (Number(response.headers.get('content-length')) > 8 * 1024 * 1024) { await response.body.cancel(); throw new ApiError('UPSTREAM_ERROR', 'Provider response is too large', 502, provider); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 8 * 1024 * 1024) { await reader.cancel(); throw new ApiError('UPSTREAM_ERROR', 'Provider response is too large', 502, provider); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  const headers = new Headers(response.headers);
  headers.delete('content-encoding'); headers.delete('content-length');
  return new Response(body, { status: response.status, headers });
}

export async function json(url: string, provider: ProviderId, signal: AbortSignal, referer?: string): Promise<unknown> {
  const response = await request(url, provider, signal, referer);
  if (!response.headers.get('content-type')?.includes('json')) throw new ApiError('UPSTREAM_ERROR', 'Provider returned non-JSON response', 502, provider);
  try { return await response.json(); } catch { throw new ApiError('UPSTREAM_ERROR', 'Provider returned invalid JSON', 502, provider); }
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function matching(anime: AnimeIdentity, titles: ProviderTitle[]): TitleMatch {
  const byId = titles.filter(title => title.anilistId === anime.id);
  if (byId.length === 1) return { status: 'matched', title: byId[0] };
  if (byId.length > 1) return { status: 'ambiguous', candidates: byId };
  const normalize = (value: string) => value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
  const wanted = [anime.title, anime.romaji].map(normalize).filter(Boolean);
  const candidates = titles.filter(title => [title.title, ...(title.aliases ?? [])].some(value => wanted.includes(normalize(value))) && (!title.year || !anime.year || title.year === anime.year) && (!title.format || !anime.format || title.format.toLowerCase() === anime.format.toLowerCase()));
  return candidates.length === 1 ? { status: 'matched', title: candidates[0] } : candidates.length ? { status: 'ambiguous', candidates } : { status: 'not-found' };
}

export function media(data: unknown, base: string, provider: ProviderId): ResolvedPlayback {
  const body = record(data);
  if (!body) throw new ApiError('UPSTREAM_ERROR', 'Invalid source payload', 502, provider);
  const raw = Array.isArray(body.sources) ? body.sources : body.sources ? [body.sources] : [];
  const sources: ResolvedPlayback['sources'] = [];
  for (const item of raw) {
    const entry = typeof item === 'string' ? { file: item } : record(item);
    const url = absoluteUrl(entry?.file ?? entry?.url, base);
    if (!url) continue;
    const mime = String(entry?.type ?? '').toLowerCase();
    const type = /m3u8(?:\?|$)/i.test(url) || mime.includes('mpegurl') || mime === 'hls' ? 'hls' : /\.webm(?:\?|$)/i.test(url) || mime.includes('webm') ? 'webm' : /\.mp4(?:\?|$)/i.test(url) || mime.includes('mp4') ? 'mp4' : undefined;
    if (type) sources.push({ url, type, ...(typeof entry?.label === 'string' ? { quality: entry.label } : {}) });
  }
  if (!sources.length) throw new ApiError('UNSUPPORTED_MEDIA', 'No supported direct media source', 502, provider);
  const rawTracks = Array.isArray(body.tracks) ? body.tracks : Array.isArray(body.subtitles) ? body.subtitles : [];
  const subtitles: ResolvedPlayback['subtitles'] = [];
  for (const item of rawTracks) {
    const track = record(item);
    const url = absoluteUrl(track?.file ?? track?.url, base);
    const format = url?.match(/\.(vtt|srt|ass)(?:\?|$)/i)?.[1]?.toLowerCase();
    if (url && track?.kind !== 'thumbnails' && (format === 'vtt' || format === 'srt' || format === 'ass')) {
      const label = String(track?.label ?? track?.language ?? 'Unknown');
      const language = String(track?.language ?? track?.lang ?? ({ english: 'en', japanese: 'ja', spanish: 'es', french: 'fr', german: 'de' } as Record<string, string>)[label.toLowerCase()] ?? 'und');
      subtitles.push({ url, format, language, label });
    }
  }
  const interval = (value: unknown) => {
    const pair = Array.isArray(value) ? value : record(value) ? [record(value)?.start, record(value)?.end] : [];
    const start = Number(pair[0]), end = Number(pair[1]);
    return Number.isFinite(start) && Number.isFinite(end) && end > start && start >= 0 ? { start, end } : undefined;
  };
  const intro = interval(body.intro), outro = interval(body.outro);
  const headers = record(body.headers);
  const safeHeaders: Record<string, string> = {};
  for (const key of ['Referer', 'Origin', 'User-Agent']) if (typeof headers?.[key] === 'string') safeHeaders[key] = headers[key] as string;
  const expiry = Number(body.expiresAt ?? body.expires_at);
  const expiresAt = Number.isFinite(expiry) && expiry > 0 ? (expiry < 100_000_000_000 ? expiry * 1000 : expiry) : undefined;
  return { sources, subtitles, ...(absoluteUrl(body.image ?? body.thumbnail, base) ? { thumbnail: absoluteUrl(body.image ?? body.thumbnail, base) } : {}), ...(intro ? { intro } : {}), ...(outro ? { outro } : {}), ...(expiresAt ? { expiresAt } : {}), ...(Object.keys(safeHeaders).length ? { headers: safeHeaders } : {}) };
}
