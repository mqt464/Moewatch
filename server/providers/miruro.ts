import { gunzipSync } from 'node:zlib';
import type { AnimeProvider } from './types';
import type { AnimeIdentity, ProviderEpisode, ProviderServer, ProviderTitle, ResolvedPlayback, TitleMatch } from '../../shared/api';
import { ApiError } from '../infrastructure/errors';
import { idDecode, idEncode, media, origin, record, request } from './common';

const configured = Boolean(process.env.MOEWATCH_MIRURO_ORIGIN);
const base = origin(process.env.MOEWATCH_MIRURO_ORIGIN || 'https://www.miruro.tv', 'miruro');
type EpisodeId = { anime: number; provider: string; category: 'sub' | 'dub'; episodeId: string; number: number };

export function decodeMiruroPipe(value: string): unknown {
  if (!/^[A-Za-z0-9_-]{1,4000000}$/.test(value)) throw new ApiError('UPSTREAM_ERROR', 'Invalid pipe payload', 502, 'miruro');
  try { return JSON.parse(gunzipSync(Buffer.from(value, 'base64url'), { maxOutputLength: 8000000 }).toString('utf8')) as unknown; }
  catch { throw new ApiError('UPSTREAM_ERROR', 'Invalid compressed pipe payload', 502, 'miruro'); }
}

async function pipe(path: string, query: Record<string, string | number>, signal: AbortSignal): Promise<unknown> {
  const payload = { path, method: 'GET', query, body: null, version: '0.1.0' };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const response = await request(`${base}/api/secure/pipe?e=${encoded}`, 'miruro', signal, `${base}/`);
  return decodeMiruroPipe((await response.text()).trim());
}

export function parseMiruroEpisodes(data: unknown, anime: number): ProviderEpisode[] {
  const providers = record(record(data)?.providers);
  if (!providers) throw new ApiError('UPSTREAM_ERROR', 'Invalid episode payload', 502, 'miruro');
  const merged = new Map<number, ProviderEpisode>();
  for (const [provider, value] of Object.entries(providers)) {
    if (!/^[a-z0-9_-]{1,80}$/i.test(provider)) continue;
    const lists = record(record(value)?.episodes);
    if (!lists) continue;
    for (const category of ['sub', 'dub'] as const) {
      if (!Array.isArray(lists[category])) continue;
      for (const item of lists[category]) {
        const entry = record(item);
        const number = Number(entry?.number);
        const episodeId = entry?.id;
        if (!Number.isInteger(number) || number < 1 || number > 10000 || typeof episodeId !== 'string' || episodeId.length > 2048) continue;
        const id = idEncode({ anime, number });
        const existing = merged.get(number);
        if (existing) { if (!existing.audio.includes(category)) existing.audio.push(category); }
        else merged.set(number, { id, number, kind: 'regular', audio: [category], ...(typeof entry?.title === 'string' ? { title: entry.title } : {}) });
      }
    }
  }
  return [...merged.values()].sort((a, b) => a.number - b.number);
}

export const miruro: AnimeProvider = {
  id: 'miruro', name: 'Miruro', configured,
  note: configured ? undefined : 'Miruro pipe is blocked from this environment; set MOEWATCH_MIRURO_ORIGIN to a verified first-party origin with accessible pipe.',
  async search(query, signal): Promise<ProviderTitle[]> {
    if (!query.trim() || query.length > 200) throw new ApiError('INVALID_REQUEST', 'Invalid search query', 400, 'miruro');
    const data = await pipe('search', { query: query.trim() }, signal);
    const body = record(data);
    const items = Array.isArray(body?.results) ? body.results : Array.isArray(data) ? data : [];
    return items.flatMap(item => {
      const entry = record(item);
      const id = Number(entry?.id ?? entry?.anilistId);
      const title = record(entry?.title);
      const name = title?.english ?? title?.romaji ?? entry?.name;
      if (!Number.isInteger(id) || id < 1 || typeof name !== 'string') return [];
      return [{ id: String(id), anilistId: id, title: name, ...(typeof title?.romaji === 'string' ? { aliases: [title.romaji] } : {}), ...(typeof entry?.format === 'string' ? { format: entry.format } : {}), ...(Number.isInteger(entry?.seasonYear) ? { year: entry?.seasonYear as number } : {}) }];
    });
  },
  async match(anime: AnimeIdentity, signal: AbortSignal): Promise<TitleMatch> {
    const data = await pipe('episodes', { anilistId: anime.id }, signal);
    const episodes = parseMiruroEpisodes(data, anime.id);
    return episodes.length ? { status: 'matched', title: { id: String(anime.id), anilistId: anime.id, title: anime.title, year: anime.year, format: anime.format } } : { status: 'not-found' };
  },
  async episodes(titleId, signal): Promise<ProviderEpisode[]> {
    const anime = Number(titleId);
    if (!Number.isInteger(anime) || anime < 1) throw new ApiError('INVALID_REQUEST', 'Invalid title ID', 400, 'miruro');
    return parseMiruroEpisodes(await pipe('episodes', { anilistId: anime }, signal), anime);
  },
  async servers(episodeId, signal): Promise<ProviderServer[]> {
    const episode = idDecode<{ anime: number; number: number }>(episodeId, 'miruro');
    if (!episode || !Number.isInteger(episode.anime) || episode.anime < 1 || !Number.isInteger(episode.number) || episode.number < 1 || episode.number > 10000) throw new ApiError('INVALID_REQUEST', 'Invalid episode ID', 400, 'miruro');
    const providers = record(record(await pipe('episodes', { anilistId: episode.anime }, signal))?.providers);
    if (!providers) throw new ApiError('UPSTREAM_ERROR', 'Invalid episode payload', 502, 'miruro');
    const servers: ProviderServer[] = [];
    for (const [provider, value] of Object.entries(providers)) {
      if (!/^[a-z0-9_-]{1,80}$/i.test(provider)) continue;
      const lists = record(record(value)?.episodes);
      for (const category of ['sub', 'dub'] as const) {
        if (!Array.isArray(lists?.[category])) continue;
        for (const item of lists[category]) {
          const entry = record(item);
          const rawId = entry?.id;
          if (Number(entry?.number) !== episode.number || typeof rawId !== 'string' || rawId.length > 2048) continue;
          servers.push({ id: idEncode({ ...episode, provider, category, episodeId: rawId } satisfies EpisodeId), name: provider, audio: category });
        }
      }
    }
    return servers;
  },
  async resolve(serverId, signal): Promise<ResolvedPlayback> {
    const episode = idDecode<EpisodeId>(serverId, 'miruro');
    if (!episode || !Number.isInteger(episode.anime) || !Number.isInteger(episode.number) || !/^[a-z0-9_-]{1,80}$/i.test(episode.provider) || !['sub', 'dub'].includes(episode.category) || typeof episode.episodeId !== 'string' || episode.episodeId.length > 2048) throw new ApiError('INVALID_REQUEST', 'Invalid server ID', 400, 'miruro');
    const data = await pipe('sources', { episodeId: Buffer.from(episode.episodeId).toString('base64url'), provider: episode.provider, category: episode.category, anilistId: episode.anime }, signal);
    return media(record(data)?.result ?? data, base, 'miruro');
  }
};
