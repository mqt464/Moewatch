import type { ProviderEpisode, ProviderTitle } from '../../shared/api';
import { ApiError } from '../infrastructure/errors';
import { decodeGotakuApi, gotakuApiVersion, gotakuOrigin, resolveGotakuEmbed } from '../extractors/gotaku';
import { idDecode, idEncode, json, matching, record, request } from './common';
import type { AnimeProvider } from './types';

const id = 'gotaku';
const api = gotakuOrigin + '/api/v1';
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9]{6}$/.test(value);
const typeToAudio = { soft_sub: 'sub', hard_sub: 'sub', dub: 'dub' } as const;
const tracks = ['soft_sub', 'hard_sub', 'dub'] as const;
type Track = typeof tracks[number];

function checkedId(value: unknown): string {
  if (!validId(value)) throw new ApiError('INVALID_REQUEST', 'Invalid Gotaku resource ID', 400, id);
  return value;
}

function list(value: unknown): unknown[] {
  const data = record(value)?.data;
  if (!Array.isArray(data)) throw new ApiError('UPSTREAM_ERROR', 'Invalid Gotaku list response', 502, id);
  return data;
}

function parseTitle(value: unknown): ProviderTitle | undefined {
  const data = record(value);
  if (!data || !validId(data.id) || typeof data.name !== 'string' || !data.name.trim()) return;
  const aliases = Array.isArray(data.alt_names) ? data.alt_names.filter((name): name is string => typeof name === 'string') : [];
  return {
    id: data.id, title: data.name,
    ...(aliases.length ? { aliases } : {}),
    ...(typeof data.anilist_id === 'number' && Number.isSafeInteger(data.anilist_id) && data.anilist_id > 0 ? { anilistId: data.anilist_id } : {}),
    ...(typeof data.year === 'number' && Number.isInteger(data.year) && data.year > 1900 ? { year: data.year } : {}),
    ...(typeof data.format === 'string' ? { format: data.format } : {}),
  };
}

export function parseGotakuEpisodes(value: unknown): ProviderEpisode[] {
  return list(value).flatMap(item => {
    const row = record(item);
    if (!row || !validId(row.id) || typeof row.number !== 'number' || !Number.isFinite(row.number) || row.number < 0) return [];
    const audio: ProviderEpisode['audio'] = [];
    if (row.sub === true) audio.push('sub');
    if (row.dub === true) audio.push('dub');
    if (!audio.length) return [];
    const kind = Number.isInteger(row.number) && row.number > 0 ? 'regular' as const : 'special' as const;
    return [{ id: row.id, number: row.number, kind, audio, ...(typeof row.name === 'string' ? { title: row.name } : {}) }];
  });
}

async function sealed(path: string, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  const url = new URL(api + path);
  url.searchParams.set('k', String(gotakuApiVersion));
  const response = await request(url.href, id, signal, gotakuOrigin + '/');
  signal.throwIfAborted();
  return decodeGotakuApi(Buffer.from(await response.arrayBuffer()));
}

export async function resolveGotakuServer(serverId: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const server = idDecode<{ episode?: unknown; track?: Track }>(serverId, id);
  const episode = checkedId(server?.episode);
  const track = server?.track;
  if (!track || !tracks.includes(track)) throw new ApiError('INVALID_REQUEST', 'Invalid Gotaku track', 400, id);
  const data = record(record(await sealed(`/episodes/${episode}/embed?type=${track}`, signal))?.data);
  const playback = await resolveGotakuEmbed(data?.url, signal);
  const skip = record(data?.skip);
  const interval = (value: unknown) => Array.isArray(value) && value.length === 2 &&
    value.every(item => typeof item === 'number' && Number.isFinite(item)) && value[0] >= 0 && value[1] > value[0]
    ? { start: value[0] as number, end: value[1] as number } : undefined;
  return { sources: [{ url: playback.manifest.source, type: 'hls' as const }], subtitles: [], headers: playback.headers, expiresAt: playback.manifest.expiresAt, mediaEncryption: { type: 'gotaku' as const, keySeed: playback.manifest.keySeed, segmentBytes: playback.manifest.segmentBytes }, intro: interval(skip?.intro), outro: interval(skip?.outro) };
}

export const gotaku: AnimeProvider = {
  id, name: 'Gotaku', configured: true,
  async search(query, signal) {
    signal.throwIfAborted();
    const q = query.trim();
    if (!q || q.length > 200) throw new ApiError('INVALID_REQUEST', 'Invalid Gotaku search query', 400, id);
    const url = new URL(api + '/titles');
    url.searchParams.set('q', q);
    url.searchParams.set('limit', '6');
    return list(await json(url.href, id, signal, gotakuOrigin + '/')).flatMap(item => parseTitle(item) ?? []);
  },
  async match(anime, signal) {
    const queries = [...new Set([anime.title, anime.romaji].map(title => title.trim()).filter(Boolean))];
    const result = (await Promise.all(queries.map(query => this.search(query, signal)))).flat();
    const ids = [...new Set(result.map(title => title.id))];
    const detailed = await Promise.all(ids.map(async titleId => {
      const data = record(record(await json(`${api}/titles/${titleId}`, id, signal, gotakuOrigin + '/'))?.data);
      const title = parseTitle(data?.title);
      if (!title || title.id !== titleId) throw new ApiError('UPSTREAM_ERROR', 'Invalid Gotaku title detail', 502, id);
      return title;
    }));
    return matching(anime, detailed.filter(title => title.anilistId === anime.id ||
      title.anilistId === undefined && title.year === anime.year && title.format?.toLowerCase() === anime.format.toLowerCase()));
  },
  async episodes(titleId, signal) {
    return parseGotakuEpisodes(await sealed(`/titles/${checkedId(titleId)}/episodes`, signal));
  },
  async servers(episodeId, signal) {
    const episode = checkedId(episodeId);
    const details = record(record(await sealed(`/episodes/${episode}`, signal))?.data);
    if (!details || details.id !== episode) throw new ApiError('UPSTREAM_ERROR', 'Invalid Gotaku episode detail', 502, id);
    const labels = { soft_sub: 'Soft sub', hard_sub: 'Hard sub', dub: 'Dub' };
    return tracks.filter(track => track !== 'soft_sub' && details[track] === true).map(track => ({
      id: idEncode({ episode, track }), name: `Gotaku ${labels[track]}`, audio: typeToAudio[track],
    }));
  },
  resolve: resolveGotakuServer,
};
