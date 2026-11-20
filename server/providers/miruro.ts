import { gunzipSync } from 'node:zlib';
import type { AnimeProvider } from './types';
import type { ProviderEpisode, ProviderServer, ProviderTitle, ResolvedPlayback } from '../../shared/api';
import { ApiError } from '../infrastructure/errors';
import { absoluteUrl, idDecode, idEncode, matching, media, origin, record, request } from './common';

const base = origin(process.env.MOEWATCH_MIRURO_ORIGIN || 'https://www.miruro.tv', 'miruro');
const fail = () => new ApiError('UPSTREAM_ERROR', 'Invalid Miruro catalogue payload', 502, 'miruro');
const validTitle = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{32}$/.test(value);
const validNumber = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 10000;
const rows = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.flatMap(item => record(item) ? [record(item)!] : []) : [];

// Shipped Button-BTdICcI9.js: XOR miruro/catalog, then gzip, then JSON.
export function decodeMiruroCatalog(value: Uint8Array): unknown {
  if (value.length > 8_000_000) throw fail();
  const bytes = Buffer.from(value), key = Buffer.from('miruro/catalog');
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= key[i % key.length];
  try { return JSON.parse(gunzipSync(bytes, { maxOutputLength: 8_000_000 }).toString('utf8')); }
  catch { throw fail(); }
}
async function catalog(path: string, query: Record<string, string>, signal: AbortSignal): Promise<Record<string, unknown>> {
  signal.throwIfAborted();
  const response = await request(`${base}/api/v1/anime${path}?${new URLSearchParams(query)}`, 'miruro', signal, `${base}/`);
  let data: unknown;
  try { data = response.headers.get('content-type')?.split(';')[0] === 'application/octet-stream' ? decodeMiruroCatalog(new Uint8Array(await response.arrayBuffer())) : await response.json(); }
  catch { throw fail(); }
  signal.throwIfAborted();
  if (!record(data)) throw fail();
  return record(data)!;
}
function titleId(value: unknown): string {
  if (!validTitle(value)) throw new ApiError('INVALID_REQUEST', 'Invalid Miruro title ID', 400, 'miruro');
  return value;
}
type Episode = { anime: string; number: number };
function episodeId(value: string): Episode {
  const data = idDecode<Episode>(value, 'miruro');
  if (!data || !validTitle(data.anime) || !validNumber(data.number)) throw new ApiError('INVALID_REQUEST', 'Invalid Miruro episode ID', 400, 'miruro');
  return data;
}
export function parseMiruroEpisodes(data: unknown, anime: string): ProviderEpisode[] {
  const body = record(data);
  if (!Array.isArray(body?.data)) throw fail();
  return rows(body.data).flatMap(e => validNumber(e.episode_number) ? [{ id: idEncode({ anime, number: e.episode_number }), number: e.episode_number, kind: e.kind === 'special' ? 'special' as const : 'regular' as const, audio: [], audioStatus: 'unknown' as const, ...(typeof e.title === 'string' ? { title: e.title } : {}) }] : []).sort((a,b) => a.number-b.number);
}
function selections(data: Record<string, unknown>) {
  if (!Array.isArray(data.tracks)) throw fail();
  return rows(data.tracks).filter(t => ['sub', 'ssub', 'dub'].includes(String(t.track))).flatMap(t => rows(t.providers).flatMap(p => rows(p.servers).filter(s => rows(s.streams).some(v => ['hls','mp4','webm'].includes(String(v.format)) && absoluteUrl(v.url, base))).map(s => ({ track: String(t.track), provider: String(p.provider), server: String(s.server), p, s }))));
}
export const miruro: AnimeProvider = {
  id: 'miruro', name: 'Miruro', configured: true,
  async search(query, signal): Promise<ProviderTitle[]> {
    if (!query.trim() || query.length > 200) throw new ApiError('INVALID_REQUEST', 'Invalid search query', 400, 'miruro');
    const body = await catalog('', { q: query.trim(), limit: '15' }, signal);
    if (!Array.isArray(body.data)) throw fail();
    return rows(body.data).flatMap(e => {
      const title = record(e.title), name = title?.english || title?.romaji;
      const ids = record(e.external_ids)?.anilist;
      const anilistId = Array.isArray(ids) ? Number(ids[0]) : NaN;
      return validTitle(e.id) && typeof name === 'string' ? [{ id: e.id, title: name, ...(Number.isSafeInteger(anilistId) && anilistId > 0 ? { anilistId } : {}), aliases: Object.values(title!).filter((v): v is string => typeof v === 'string'), ...(typeof e.format === 'string' ? { format: e.format } : {}), ...(typeof e.season_year === 'number' ? { year: e.season_year } : {}) }] : [];
    });
  },
  async match(anime, signal) { return matching(anime, await this.search(anime.title, signal)); },
  async episodes(id, signal) {
    const anime = titleId(id);
    const data = await catalog(`/${anime}/episodes`, { limit: '10000' }, signal);
    if (data.has_more === true) throw fail();
    // Catalogue episodes carry no per-episode audio availability; playback is authoritative.
    return parseMiruroEpisodes(data, anime);
  },
  async servers(id, signal): Promise<ProviderServer[]> {
    const ep = episodeId(id);
    // Prefer the direct HLS paths verified through playback and the download proxy.
    const priority = ['aniwaves', 'icarus', 'anikoto', 'kickassanime'];
    const rank = (provider: string) => { const index = priority.indexOf(provider); return index < 0 ? priority.length : index; };
    return selections(await catalog(`/${ep.anime}/episodes/${ep.number}/play`, {}, signal))
      .sort((a, b) => rank(a.provider) - rank(b.provider))
      .map(s => ({ id: idEncode({ ...ep, track: s.track, provider: s.provider, server: s.server }), name: `${s.provider} / ${s.server} (${s.track})`, audio: s.track === 'dub' ? 'dub' : 'sub' }));
  },
  async resolve(id, signal): Promise<ResolvedPlayback> {
    const ep = episodeId(id), selected = idDecode<{ track: string; provider: string; server: string }>(id, 'miruro');
    if (!['sub','ssub','dub'].includes(selected.track) || typeof selected.provider !== 'string' || typeof selected.server !== 'string' || selected.provider.length > 100 || selected.server.length > 200) throw new ApiError('INVALID_REQUEST', 'Invalid Miruro server ID', 400, 'miruro');
    const entry = selections(await catalog(`/${ep.anime}/episodes/${ep.number}/play`, {}, signal)).find(s => s.track === selected.track && s.provider === selected.provider && s.server === selected.server);
    if (!entry) throw new ApiError('SOURCE_EXPIRED', 'Miruro server is no longer available', 410, 'miruro');
    const result = media({ ...entry.p, headers: entry.s.headers, sources: rows(entry.s.streams).map(s => ({ url: s.url, type: s.format, label: s.quality })) }, base, 'miruro');
    // A single HLS master can back both track entries; select its actual audio rendition.
    return { ...result, audioLanguage: selected.track === 'dub' ? 'en' : 'ja' };
  }
};
