import type { ProviderEpisode, ProviderTitle } from '../../shared/api';
import { ApiError } from '../infrastructure/errors';
import { idDecode, idEncode, json, matching, record } from './common';
import type { AnimeProvider } from './types';

const provider = 'mkissa';
const site = 'https://mkissa.to/';
const endpoint = 'https://api.mkissa.net/api';
const searchHash = '8b319a0fda488e4319f1b6d99093ba12802f3fc039572f39bcc02d5f9b9d9b02';
const titleHash = 'c6c067496f962fba87c7aaf6c215a40a6d3933c69012bd15e4d8949e58f3c010';
const titleIdPattern = /^[a-z0-9]{1,64}$/i;
const episodePattern = /^(?:0|[1-9][0-9]{0,4})(?:\.[0-9]{1,5})?$/;
const audioTypes = ['sub', 'dub'] as const;
const playbackNote = 'MKissa playback is blocked by a provider CAPTCHA; direct player resolution is pending.';

type EpisodeId = { titleId: string; episode: string };

async function query(hash: string, variables: unknown, signal: AbortSignal) {
  signal.throwIfAborted();
  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    extensions: JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hash } })
  });
  const body = record(await json(`${endpoint}?${params}`, provider, signal, site));
  const data = record(body?.data);
  if (!data || (Array.isArray(body?.errors) && body.errors.length)) {
    throw new ApiError('UPSTREAM_ERROR', 'MKissa returned an invalid catalog response', 502, provider);
  }
  return data;
}

function parseTitle(value: unknown): ProviderTitle | undefined {
  const show = record(value);
  if (!show || typeof show._id !== 'string' || !titleIdPattern.test(show._id)) return;
  const aliases = [...new Set([show.englishName, show.name, show.nativeName, ...(Array.isArray(show.altNames) ? show.altNames : [])]
    .flatMap(name => typeof name === 'string' && name.trim() ? [name.trim()] : []))];
  const [title, ...otherNames] = aliases;
  if (!title) return;
  const year = Number(record(show.season)?.year ?? record(show.airedStart)?.year);
  const anilistId = Number(show.aniListId);
  return {
    id: show._id,
    title,
    ...(otherNames.length ? { aliases: otherNames } : {}),
    ...(Number.isInteger(year) && year > 1900 ? { year } : {}),
    ...(Number.isSafeInteger(anilistId) && anilistId > 0 ? { anilistId } : {}),
    ...(typeof show.type === 'string' ? { format: show.type } : {})
  };
}

async function getShow(titleId: string, signal: AbortSignal) {
  if (!titleIdPattern.test(titleId)) throw new ApiError('INVALID_REQUEST', 'Invalid MKissa title ID', 400, provider);
  const data = await query(titleHash, {
    _id: titleId,
    search: { allowAdult: false, allowUnknown: false, denyEcchi: false, lite: false, forMe: false }
  }, signal);
  if (data.show === null) throw new ApiError('NOT_FOUND', 'MKissa title not found', 404, provider);
  const show = record(data.show);
  if (show?._id !== titleId) throw new ApiError('UPSTREAM_ERROR', 'Invalid MKissa title response', 502, provider);
  return show;
}

export const mkissa: AnimeProvider = {
  id: provider,
  name: 'MKissa',
  configured: false,
  note: playbackNote,

  async search(term, signal) {
    const cleaned = term.trim();
    if (!cleaned || cleaned.length > 200) throw new ApiError('INVALID_REQUEST', 'Invalid MKissa search query', 400, provider);
    const data = await query(searchHash, {
      search: { sortBy: 'Top', query: cleaned, listProfile: 'browse' }, limit: 26, page: 1, translationType: 'sub'
    }, signal);
    const edges = record(data.shows)?.edges;
    if (!Array.isArray(edges)) throw new ApiError('UPSTREAM_ERROR', 'Invalid MKissa search results', 502, provider);
    return edges.flatMap(edge => parseTitle(edge) ?? []);
  },

  async match(anime, signal) {
    const names = [...new Set([anime.title.trim(), anime.romaji.trim()].filter(Boolean))];
    const results = (await Promise.all(names.map(name => mkissa.search(name, signal)))).flat();
    const titles = [...new Map(results.map(title => [title.id, title])).values()];
    // Search results omit AniList IDs, so verify title candidates against the detail query.
    const candidates = matching({ ...anime, year: 0, format: '' }, titles);
    if (candidates.status === 'not-found') return candidates;
    const possible = candidates.status === 'matched' ? [candidates.title] : candidates.candidates;
    const details = await Promise.all(possible.map(async title => parseTitle(await getShow(title.id, signal)) ?? title));
    return matching(anime, details.filter(title => !title.anilistId || title.anilistId === anime.id));
  },

  async episodes(titleId, signal) {
    const show = await getShow(titleId, signal);
    const available = record(show.availableEpisodesDetail);
    if (!available) throw new ApiError('UPSTREAM_ERROR', 'Invalid MKissa episode list', 502, provider);
    const episodes = new Map<string, ProviderEpisode>();
    for (const audio of audioTypes) {
      const list = available[audio];
      if (!Array.isArray(list)) continue;
      for (const episode of list) {
        if (typeof episode !== 'string' || !episodePattern.test(episode)) continue;
        const existing = episodes.get(episode);
        if (existing) {
          if (!existing.audio.includes(audio)) existing.audio.push(audio);
        } else {
          const number = Number(episode);
          episodes.set(episode, {
            id: idEncode({ titleId, episode } satisfies EpisodeId),
            number,
            kind: number > 0 && Number.isInteger(number) ? 'regular' : 'special',
            audio: [audio]
          });
        }
      }
    }
    return [...episodes.values()].sort((a, b) => a.number - b.number);
  },

  async servers(episodeId, signal) {
    signal.throwIfAborted();
    const episode = idDecode<Partial<EpisodeId>>(episodeId, provider);
    if (typeof episode?.titleId !== 'string' || !titleIdPattern.test(episode.titleId) ||
        typeof episode.episode !== 'string' || !episodePattern.test(episode.episode)) {
      throw new ApiError('INVALID_REQUEST', 'Invalid MKissa episode ID', 400, provider);
    }
    throw new ApiError('UPSTREAM_BLOCKED', playbackNote, 502, provider);
  },

  async resolve(_serverId, signal) {
    signal.throwIfAborted();
    throw new ApiError('UPSTREAM_BLOCKED', playbackNote, 502, provider);
  }
};
