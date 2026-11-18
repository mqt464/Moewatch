import type { AnimeIdentity, ProviderEpisode, ProviderServer, ProviderTitle, ResolvedPlayback, TitleMatch } from '../../shared/api';
import { ApiError } from '../infrastructure/errors';
import { decryptMegaplay } from '../extractors/megaplay';
import type { AnimeProvider } from './types';
import { absoluteUrl, idDecode, idEncode, json, matching, media, origin, record, request, userAgent } from './common';

const base = origin(process.env.MOEWATCH_ANIKOTO_ORIGIN || 'https://anikototv.bz', 'anikoto');
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'))?.[1];
const text = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').trim();

export function parseAnikotoSearch(html: string): ProviderTitle[] {
  const found: ProviderTitle[] = [];
  for (const match of html.matchAll(/<a\b([^>]*class="[^"]*\bitem\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(match[1], 'href');
    const slug = href?.match(/\/watch\/([a-z0-9-]+)/i)?.[1];
    const name = match[2].match(/<div\b([^>]*class="[^"]*\bd-title\b[^"]*"[^>]*)>([\s\S]*?)<\/div>/i);
    if (!slug || !name) continue;
    const title = text(name[2]);
    const alias = attr(name[1], 'data-jp');
    const dots = [...match[2].matchAll(/<span class="dot">([^<]*)<\/span>/g)].map(item => text(item[1]));
    const year = dots.find(value => /^\d{4}$/.test(value));
    const format = dots.find(value => /^(TV|Movie|OVA|ONA|Special)$/i.test(value));
    if (title) found.push({ id: slug, title, ...(alias && alias !== title ? { aliases: [alias] } : {}), ...(year ? { year: Number(year) } : {}), ...(format ? { format: format.toUpperCase() } : {}) });
  }
  return found;
}

type EpisodeId = { slug: string; ids: string; number: number };
type ServerId = { link: string; audio: 'sub' | 'dub' };

export function parseAnikotoEpisodes(html: string, slug: string): ProviderEpisode[] {
  const episodes: ProviderEpisode[] = [];
  for (const match of html.matchAll(/<li\b([^>]*)>\s*<a\b([^>]*)>/gi)) {
    const number = Number(attr(match[2], 'data-num'));
    const ids = attr(match[2], 'data-ids');
    if (!Number.isInteger(number) || number < 1 || number > 10000 || !ids || ids.length > 2048) continue;
    const audio: ('sub' | 'dub')[] = [];
    if (attr(match[2], 'data-sub') === '1') audio.push('sub');
    if (attr(match[2], 'data-dub') === '1') audio.push('dub');
    if (audio.length) episodes.push({ id: idEncode({ slug, ids, number } satisfies EpisodeId), number, kind: 'regular', audio, ...(attr(match[1], 'title') ? { title: text(attr(match[1], 'title')!) } : {}) });
  }
  return episodes;
}

export function parseAnikotoServers(html: string): { link: string; name: string; audio: 'sub' | 'dub' }[] {
  const servers: { link: string; name: string; audio: 'sub' | 'dub' }[] = [];
  for (const group of html.matchAll(/<div class="type" data-type="(sub|dub)">([\s\S]*?)<\/ul>\s*<\/div>/gi)) {
    for (const item of group[2].matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi)) {
      const link = attr(item[1], 'data-link-id');
      if (link && link.length <= 512) servers.push({ link, name: text(item[2]) || 'Server', audio: group[1].toLowerCase() as 'sub' | 'dub' });
    }
  }
  return servers;
}

export const anikoto: AnimeProvider = {
  id: 'anikoto', name: 'KotoPlay / AniKoto', configured: true,
  async search(query, signal): Promise<ProviderTitle[]> {
    if (!query.trim() || query.length > 200) throw new ApiError('INVALID_REQUEST', 'Invalid search query', 400, 'anikoto');
    const data = record(await json(`${base}/ajax/anime/search?keyword=${encodeURIComponent(query.trim())}`, 'anikoto', signal, `${base}/`));
    const html = record(data?.result)?.html;
    if (typeof html !== 'string') throw new ApiError('UPSTREAM_ERROR', 'Invalid search payload', 502, 'anikoto');
    return parseAnikotoSearch(html);
  },
  async match(anime: AnimeIdentity, signal: AbortSignal): Promise<TitleMatch> {
    const queries = [...new Set([anime.title, anime.romaji].filter(Boolean))];
    const results = await Promise.all(queries.map(query => this.search(query, signal)));
    const titles = [...new Map(results.flat().map(title => [title.id, title])).values()];
    return matching(anime, titles);
  },
  async episodes(titleId, signal): Promise<ProviderEpisode[]> {
    if (!/^[a-z0-9-]{1,200}$/i.test(titleId)) throw new ApiError('INVALID_REQUEST', 'Invalid title ID', 400, 'anikoto');
    const page = await (await request(`${base}/watch/${titleId}`, 'anikoto', signal, `${base}/`)).text();
    const showId = page.match(/<div\b[^>]*id="watch-main"[^>]*>/i)?.[0].match(/\bdata-id="(\d+)"/)?.[1];
    if (!showId) throw new ApiError('UPSTREAM_ERROR', 'Show ID missing', 502, 'anikoto');
    const data = record(await json(`${base}/ajax/episode/list/${showId}`, 'anikoto', signal, `${base}/watch/${titleId}`));
    if (typeof data?.result !== 'string') throw new ApiError('UPSTREAM_ERROR', 'Invalid episode payload', 502, 'anikoto');
    return parseAnikotoEpisodes(data.result, titleId);
  },
  async servers(episodeId, signal): Promise<ProviderServer[]> {
    const episode = idDecode<EpisodeId>(episodeId, 'anikoto');
    if (!episode || !/^[a-z0-9-]{1,200}$/i.test(episode.slug) || typeof episode.ids !== 'string' || episode.ids.length > 2048 || !Number.isInteger(episode.number)) throw new ApiError('INVALID_REQUEST', 'Invalid episode ID', 400, 'anikoto');
    const data = record(await json(`${base}/ajax/server/list?servers=${encodeURIComponent(episode.ids)}`, 'anikoto', signal, `${base}/watch/${episode.slug}/ep-${episode.number}`));
    if (typeof data?.result !== 'string') throw new ApiError('UPSTREAM_ERROR', 'Invalid server payload', 502, 'anikoto');
    return parseAnikotoServers(data.result).map(server => ({ id: idEncode({ link: server.link, audio: server.audio } satisfies ServerId), name: server.name, audio: server.audio }));
  },
  async resolve(serverId, signal): Promise<ResolvedPlayback> {
    const server = idDecode<ServerId>(serverId, 'anikoto');
    if (!server || typeof server.link !== 'string' || server.link.length > 512 || !['sub', 'dub'].includes(server.audio)) throw new ApiError('INVALID_REQUEST', 'Invalid server ID', 400, 'anikoto');
    const data = record(await json(`${base}/ajax/server?get=${encodeURIComponent(server.link)}`, 'anikoto', signal, `${base}/`));
    const result = record(data?.result);
    const embed = absoluteUrl(result?.url, base);
    if (!embed) throw new ApiError('UNSUPPORTED_MEDIA', 'Provider supplied no embed URL', 502, 'anikoto');
    const embedUrl = new URL(embed);
    if (!['megaplay.buzz', 'vidwish.live'].includes(embedUrl.hostname)) throw new ApiError('UNSUPPORTED_MEDIA', 'Unknown embed host', 502, 'anikoto');
    const page = await (await request(embed, 'anikoto', signal, `${base}/`)).text();
    const fileId = page.match(/data-id="([^"]{1,512})"/)?.[1];
    if (!fileId) throw new ApiError('UNSUPPORTED_MEDIA', 'Embed source ID missing', 502, 'anikoto');
    const sourceUrl = `${embedUrl.origin}/stream/getSources?id=${encodeURIComponent(fileId)}&id=${encodeURIComponent(fileId)}`;
    const source = await json(sourceUrl, 'anikoto', signal, `${embedUrl.origin}/`);
    const sourceBody = record(source);
    const decrypted = sourceBody?.enc ? decryptMegaplay(sourceBody.enc) : undefined;
    const playback = media({ ...sourceBody, sources: sourceBody?.sources ?? decrypted }, embedUrl.origin, 'anikoto');
    const skip = record(result?.skip_data);
    const interval = (value: unknown) => {
      if (!Array.isArray(value)) return;
      const start = Number(value[0]), end = Number(value[1]);
      return Number.isFinite(start) && Number.isFinite(end) && end > start && start >= 0 ? { start, end } : undefined;
    };
    return { ...playback, intro: playback.intro ?? interval(skip?.intro), outro: playback.outro ?? interval(skip?.outro), headers: { ...playback.headers, Referer: `${embedUrl.origin}/`, Origin: embedUrl.origin, 'User-Agent': userAgent } };
  }
};
