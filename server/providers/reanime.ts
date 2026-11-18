import type { AnimeProvider } from './types';
import type { AnimeIdentity, ProviderEpisode, ProviderServer, ProviderTitle, ResolvedPlayback, TitleMatch } from '../../shared/api';
import { ApiError } from '../infrastructure/errors';
import { absoluteUrl, idDecode, idEncode, json, matching, media, origin, record } from './common';
import { resolveFlixcloud } from '../extractors/flixcloud';

const base = origin(process.env.MOEWATCH_REANIME_ORIGIN || 'https://reanime.cz', 'reanime');
type EpisodeId = { slug: string; number: number; anilistId?: number };
type ServerId = { url: string; audio: 'sub' | 'dub' };

function slug(value: string): string {
  if (!/^[a-z0-9-]{1,200}$/i.test(value)) throw new ApiError('INVALID_REQUEST', 'Invalid title ID', 400, 'reanime');
  return value;
}

export function parseReanimeSearch(data: unknown): ProviderTitle[] {
  const body = record(data);
  const items = Array.isArray(data) ? data : Array.isArray(body?.data) ? body.data : Array.isArray(body?.results) ? body.results : [];
  return items.flatMap(item => {
    const entry = record(item);
    const id = entry?.anime_id ?? entry?.slug ?? entry?.id;
    const names = record(entry?.title);
    const title = names?.english || names?.romaji || entry?.title || entry?.name;
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,200}$/i.test(id) || typeof title !== 'string' || !title.trim()) return [];
    const anilistId = Number(entry?.anilist ?? entry?.anilist_id);
    const year = Number(entry?.season_year ?? entry?.year);
    return [{ id, title: title.trim(), ...(typeof names?.romaji === 'string' ? { aliases: [names.romaji] } : {}), ...(Number.isInteger(anilistId) && anilistId > 0 ? { anilistId } : {}), ...(Number.isInteger(year) && year > 1900 ? { year } : {}), ...(typeof entry?.format === 'string' ? { format: entry.format } : {}) }];
  });
}

export function parseReanimeEpisodes(data: unknown, titleId: string): ProviderEpisode[] {
  const body = record(data);
  const items = Array.isArray(data) ? data : Array.isArray(body?.data) ? body.data : Array.isArray(body?.episodes) ? body.episodes : [];
  return items.flatMap(item => {
    const entry = record(item);
    const number = Number(entry?.number ?? entry?.episode ?? entry?.episode_number);
    if (!Number.isInteger(number) || number < 1 || number > 10000 || entry?.playable === false) return [];
    const audio: ('sub' | 'dub')[] = [];
    if (entry?.subbed !== false && entry?.hasSub !== false && entry?.sub !== false) audio.push('sub');
    if (entry?.dubbed === true || entry?.hasDub === true || entry?.dub === true) audio.push('dub');
    if (!audio.length) return [];
    return [{ id: idEncode({ slug: titleId, number } satisfies EpisodeId), number, kind: 'regular' as const, audio, ...(typeof entry?.title === 'string' ? { title: entry.title } : {}) }];
  });
}

export function parseReanimeServers(data: unknown): ProviderServer[] {
  const body = record(data);
  const watch = record(body?.result) ?? body;
  const links = Array.isArray(watch?.servers) ? watch.servers : Array.isArray(watch?.episode_links) ? watch.episode_links : [];
  return links.flatMap(item => {
    const entry = record(item);
    const kind = entry?.dataType;
    const audio = kind === 'sub' || kind === 's-sub' ? 'sub' : kind === 'dub' || kind === 's-dub' ? 'dub' : undefined;
    const url = absoluteUrl(entry?.dataLink ?? entry?.url ?? entry?.link, base);
    if (!audio || !url) return [];
    return [{ id: idEncode({ url, audio } satisfies ServerId), name: String(entry?.serverName ?? 'Server'), audio }];
  });
}

export const reanime: AnimeProvider = {
  id: 'reanime', name: 'Re:Anime', configured: true,
  async search(query, signal): Promise<ProviderTitle[]> {
    if (!query.trim() || query.length > 200) throw new ApiError('INVALID_REQUEST', 'Invalid search query', 400, 'reanime');
    const data = await json(`${base}/api/v1/search?q=${encodeURIComponent(query.trim())}&limit=30&offset=0`, 'reanime', signal, `${base}/`);
    if (!Array.isArray(data) && !record(data)) throw new ApiError('UPSTREAM_ERROR', 'Invalid search payload', 502, 'reanime');
    return parseReanimeSearch(data);
  },
  async match(anime: AnimeIdentity, signal: AbortSignal): Promise<TitleMatch> {
    const queries = [...new Set([anime.title, anime.romaji].filter(Boolean))];
    const titles = [...new Map((await Promise.all(queries.map(query => this.search(query, signal)))).flat().map(title => [title.id, title])).values()];
    return matching(anime, titles);
  },
  async episodes(titleId, signal): Promise<ProviderEpisode[]> {
    const data = await json(`${base}/api/v1/anime/${slug(titleId)}/episodes`, 'reanime', signal, `${base}/`);
    if (!Array.isArray(data) && !record(data)) throw new ApiError('UPSTREAM_ERROR', 'Invalid episode payload', 502, 'reanime');
    return parseReanimeEpisodes(data, titleId);
  },
  async servers(episodeId, signal): Promise<ProviderServer[]> {
    const episode = idDecode<EpisodeId>(episodeId, 'reanime');
    if (!episode || !Number.isInteger(episode.number) || episode.number < 1 || episode.number > 10000) throw new ApiError('INVALID_REQUEST', 'Invalid episode ID', 400, 'reanime');
    const title = record(await json(`${base}/api/v1/anime/${slug(episode.slug)}`, 'reanime', signal, `${base}/`));
    const anilistId = Number(title?.anilist_id), malId = Number(title?.mal_id);
    if (!Number.isSafeInteger(anilistId) || anilistId < 1) throw new ApiError('UPSTREAM_ERROR', 'Provider title has no AniList ID', 502, 'reanime');
    const query = Number.isSafeInteger(malId) && malId > 0 ? `?mal=${malId}` : '';
    const data = await json(`${base}/api/flix/${anilistId}/${episode.number}${query}`, 'reanime', signal, `${base}/`);
    return parseReanimeServers(data);
  },
  async resolve(serverId, signal): Promise<ResolvedPlayback> {
    const server = idDecode<ServerId>(serverId, 'reanime');
    const url = absoluteUrl(server?.url, base);
    if (!url || !['sub', 'dub'].includes(server.audio)) throw new ApiError('INVALID_REQUEST', 'Invalid server ID', 400, 'reanime');
    if (/\.(m3u8|mp4|webm)(?:\?|$)/i.test(url)) return { ...media({ sources: { file: url } }, base, 'reanime'), headers: { Referer: `${base}/` } };
    return resolveFlixcloud(url, server.audio, signal);
  }
};
