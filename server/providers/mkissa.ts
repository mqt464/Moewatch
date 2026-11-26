import type { AudioPreference, ProviderEpisode, ProviderTitle } from '../../shared/api';
import { ApiError } from '../infrastructure/errors';
import { decodeMkissaBootstrap, decodeMkissaPayload, mkissaBootstrapProof, mkissaBuild, mkissaEpochMs, mkissaRequestEnvelope } from '../extractors/mkissa-crypto';
import { mkissaMp4UploadEmbed, resolveMkissaMp4Upload } from '../extractors/mkissa-player';
import { idDecode, idEncode, json, matching, record } from './common';
import type { AnimeProvider } from './types';

const provider = 'mkissa';
const site = 'https://mkissa.to/';
const endpoint = 'https://api.mkissa.net/api';
const searchHash = '8b319a0fda488e4319f1b6d99093ba12802f3fc039572f39bcc02d5f9b9d9b02';
const titleHash = 'c6c067496f962fba87c7aaf6c215a40a6d3933c69012bd15e4d8949e58f3c010';
const episodeHash = '670bbf38d0868f446e2346c1e956ca2c40c416e733ca248fd54e04f1c8b99145';
const playbackSite = 'https://youtu-chan.com/';
const titleIdPattern = /^[a-z0-9]{1,64}$/i;
const episodePattern = /^(?:0|[1-9][0-9]{0,4})(?:\.[0-9]{1,5})?$/;
const audioTypes = ['sub', 'dub'] as const;

type EpisodeId = { titleId: string; episode: string };
type MkissaSource = { kind: 'direct'; name: 'Yt-mp4'; url: string; expiresAt: number | undefined }
  | { kind: 'mp4upload'; name: 'Mp4'; url: string };

function checkedEpisode(value: string): EpisodeId {
  const episode = record(idDecode<unknown>(value, provider));
  if (typeof episode?.titleId !== 'string' || !titleIdPattern.test(episode.titleId) ||
      typeof episode.episode !== 'string' || !episodePattern.test(episode.episode)) {
    throw new ApiError('INVALID_REQUEST', 'Invalid MKissa episode ID', 400, provider);
  }
  return { titleId: episode.titleId, episode: episode.episode };
}

async function directSources(episode: EpisodeId, audio: AudioPreference, signal: AbortSignal) {
  signal.throwIfAborted();
  const epoch = Math.floor(Date.now() / mkissaEpochMs);
  const headers = { Origin: 'https://youtu-chan.com', 'x-build-id': mkissaBuild };
  const bootstrap = await json(`https://api.mkissa.net/client-crypto/v1/bootstrap?buildId=${mkissaBuild}&k=k7`,
    provider, signal, playbackSite, { ...headers, 'x-aa-boot': mkissaBootstrapProof(epoch) });
  const session = decodeMkissaBootstrap(bootstrap, epoch);
  const params = new URLSearchParams({
    variables: JSON.stringify({ showId: episode.titleId, translationType: audio, episodeString: episode.episode }),
    extensions: JSON.stringify({ persistedQuery: { version: 1, sha256Hash: episodeHash }, k: 'k7',
      aaReq: mkissaRequestEnvelope(session.key, session.epoch, episodeHash) })
  });
  const body = record(await json(`${endpoint}?${params}`, provider, signal, playbackSite, headers));
  if (Array.isArray(body?.errors) && body.errors.length) {
    const captcha = body.errors.some(error => String(record(error)?.message).includes('NEED_CAPTCHA'));
    throw new ApiError(captcha ? 'UPSTREAM_BLOCKED' : 'UPSTREAM_ERROR',
      captcha ? 'MKissa requires upstream verification' : 'MKissa episode query failed', 502, provider);
  }
  const decoded = record(decodeMkissaPayload(record(body?.data)?.tobeparsed, session.key));
  const entry = record(decoded?.episode);
  const pageId = record(entry?.pageStatus)?.pageId;
  // Some titles retain a legacy page ID; the returned show ID remains authoritative.
  const page = typeof pageId === 'string' ? /^anime-([a-z0-9]{1,64})_(sub|dub)_([\d.]+)$/i.exec(pageId) : null;
  if (entry === undefined || entry.episodeString !== episode.episode || record(entry.show)?._id !== episode.titleId ||
      page?.[2] !== audio || page[3] !== episode.episode || !Array.isArray(entry.sourceUrls)) {
    throw new ApiError('UPSTREAM_ERROR', 'Invalid MKissa episode identity', 502, provider);
  }
  return entry.sourceUrls.flatMap<MkissaSource>(value => {
    const source = record(value);
    if (source?.sourceName === 'Mp4' && source.type === 'iframe') {
      const url = mkissaMp4UploadEmbed(source.sourceUrl);
      return url ? [{ kind: 'mp4upload', name: 'Mp4', url }] : [];
    }
    if (source?.sourceName !== 'Yt-mp4' || source.type !== 'player' || source.fileExtenstion !== 'mp4' ||
        typeof source.sourceUrl !== 'string' || source.sourceUrl.length > 8192) return [];
    let url: URL;
    try { url = new URL(source.sourceUrl); } catch { return []; }
    if (url.origin !== 'https://tools.fast4speed.rsvp' || url.username || url.password || url.hash ||
        !/^\/media\d{1,2}\/videos\/[A-Za-z0-9_-]{1,128}\/(sub|dub)\/[\d.]+$/.test(url.pathname) ||
        !url.pathname.endsWith(`/${audio}/${episode.episode}`) || url.searchParams.getAll('Authorization').length !== 1 ||
        !url.searchParams.get('Authorization')) return [];
    let expiresAt: number | undefined;
    try {
      const token = url.searchParams.get('Authorization') ?? '';
      const payload = record(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')));
      if (typeof payload?.exp === 'number' && Number.isSafeInteger(payload.exp) && payload.exp > 0) expiresAt = payload.exp * 1000;
    } catch { /* Source tokens need not use JWT; unknown expiry stays unknown. */ }
    if (expiresAt !== undefined && expiresAt <= Date.now()) return [];
    return [{ kind: 'direct', name: 'Yt-mp4', url: url.href, expiresAt }];
  }).sort((a, b) => Number(a.kind !== 'direct') - Number(b.kind !== 'direct'));
}

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
  configured: true,

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
    const episode = checkedEpisode(episodeId);
    const show = await getShow(episode.titleId, signal);
    const available = record(show.availableEpisodesDetail);
    const servers = [];
    for (const audio of audioTypes) {
      const episodes = available?.[audio];
      if (!Array.isArray(episodes) || !episodes.includes(episode.episode)) continue;
      for (const source of await directSources(episode, audio, signal)) {
        servers.push({ id: idEncode({ ...episode, audio, source: source.name }), name: `MKissa ${source.name} (${audio})`, audio });
      }
    }
    return servers;
  },

  async resolve(serverId, signal) {
    signal.throwIfAborted();
    const episode = checkedEpisode(serverId);
    const server = record(idDecode<unknown>(serverId, provider));
    if ((server?.audio !== 'sub' && server?.audio !== 'dub') || (server.source !== 'Yt-mp4' && server.source !== 'Mp4')) {
      throw new ApiError('INVALID_REQUEST', 'Invalid MKissa server ID', 400, provider);
    }
    const source = (await directSources(episode, server.audio, signal)).find(source => source.name === server.source);
    if (!source) throw new ApiError('SOURCE_EXPIRED', 'MKissa direct source is no longer available', 410, provider);
    if (source.kind === 'mp4upload') return resolveMkissaMp4Upload(source.url, signal);
    return { sources: [{ url: source.url, type: 'mp4' }], subtitles: [], headers: { Referer: 'https://filelotion.fyi/' },
      ...(source.expiresAt === undefined ? {} : { expiresAt: source.expiresAt }) };
  }
};
