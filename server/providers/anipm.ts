import type { AudioPreference, ProviderEpisode, ResolvedPlayback } from '../../shared/api';
import { ApiError } from '../infrastructure/errors';
import { idDecode, idEncode, json, matching, origin, record } from './common';
import type { AnimeProvider } from './types';

const provider = 'anipm';
const base = origin(process.env.MOEWATCH_ANIPM_ORIGIN || 'https://ani.pm', provider);
type TitleId = { source: 'settlar' | 'anilist'; id: number; routeId?: string };
type EpisodeId = TitleId & { routeId: string; number: number; audio: AudioPreference[] };
const fail = () => new ApiError('UPSTREAM_ERROR', 'Invalid Ani.pm response', 502, provider);
const invalid = () => new ApiError('INVALID_REQUEST', 'Invalid Ani.pm ID', 400, provider);
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const route = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9-]{1,250}$/i.test(v);
function titleId(value: string): TitleId {
  const id = idDecode<TitleId>(value, provider);
  if (!id || !['settlar', 'anilist'].includes(id.source) || !positive(id.id) || (id.routeId !== undefined && !route(id.routeId))) throw invalid();
  return id;
}
function episodeId(value: string): EpisodeId {
  const title = titleId(value), ep = idDecode<EpisodeId>(value, provider);
  if (!positive(ep.number) || ep.number > 10000 || !route(ep.routeId) || !Array.isArray(ep.audio) || !ep.audio.length || ep.audio.some(a => a !== 'sub' && a !== 'dub')) throw invalid();
  return { ...title, routeId: ep.routeId, number: ep.number, audio: ep.audio };
}
async function api(path: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const body = record(await json(`${base}/api/anime/${path}`, provider, signal, `${base}/`));
  if (!body) throw fail();
  return body;
}
function trustedUrl(value: unknown, host: string): URL {
  try {
    if (typeof value !== 'string' || value.length > 8192) throw Error();
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.host !== host || url.username || url.password || url.hash) throw Error();
    return url;
  } catch { throw fail(); }
}
function expiry(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= Date.now() / 1000) throw new ApiError('SOURCE_EXPIRED', 'Ani.pm session expired or invalid', 410, provider);
  return value * 1000;
}
function interval(value: unknown) {
  const v = record(value);
  return typeof v?.start === 'number' && typeof v.end === 'number' && Number.isFinite(v.start) && Number.isFinite(v.end) && v.start >= 0 && v.end > v.start ? { start: v.start, end: v.end } : undefined;
}
export const anipm: AnimeProvider = {
  id: provider, name: 'Ani.pm', configured: true,
  async search(query, signal) {
    if (!query.trim() || query.length > 200) throw new ApiError('INVALID_REQUEST', 'Invalid search query', 400, provider);
    const body = await api(`search?${new URLSearchParams({ q: query.trim() })}`, signal);
    if (!Array.isArray(body.items)) throw fail();
    return body.items.flatMap(value => {
      const v = record(value);
      if (!v || !positive(v.id) || !['settlar', 'anilist'].includes(String(v.source)) || typeof v.title !== 'string' || !v.title.trim() || (v.routeId !== undefined && !route(v.routeId))) return [];
      const anilistId = Number(v.anilistId);
      return [{ id: idEncode({ source: v.source, id: v.id, ...(v.routeId ? { routeId: v.routeId } : {}) }), title: v.title,
        aliases: Array.isArray(v.providerTitles) ? v.providerTitles.filter((v): v is string => typeof v === 'string') : [],
        ...(positive(anilistId) ? { anilistId } : {}), ...(positive(v.year) ? { year: v.year } : {}), ...(typeof v.type === 'string' ? { format: v.type } : {}) }];
    });
  },
  async match(anime, signal) {
    const titles = (await Promise.all([...new Set([anime.title, anime.romaji].filter(Boolean))].map(q => this.search(q, signal)))).flat();
    return matching(anime, [...new Map(titles.filter(t => !t.anilistId || t.anilistId === anime.id).map(t => [t.id, t])).values()]);
  },
  async episodes(value, signal): Promise<ProviderEpisode[]> {
    const title = titleId(value);
    const body = await api(`${title.source === 'anilist' ? 'ani' : 'series'}/${title.id}?routes=e4`, signal);
    if (!Array.isArray(body.episodes)) throw fail();
    return body.episodes.flatMap(value => {
      const v = record(value), routeId = body.routeId ?? title.routeId ?? (title.source === 'anilist' ? String(title.id) : undefined);
      if (!v || !positive(v.number) || v.number > 10000) throw fail();
      const audio = (['sub', 'dub'] as const).filter(a => v[a] === true);
      if (!audio.length) return [];
      if (!route(routeId)) throw fail();
      return [{ id: idEncode({ ...title, routeId, number: v.number, audio }), number: v.number, kind: 'regular' as const, audio, ...(typeof v.title === 'string' ? { title: v.title } : {}) }];
    }).sort((a,b) => a.number-b.number);
  },
  async servers(value, signal) {
    signal.throwIfAborted();
    const ep = episodeId(value);
    return ep.audio.map(audio => ({ id: idEncode({ ...ep, selectedAudio: audio }), name: `Settlar (${audio})`, audio }));
  },
  async resolve(value, signal): Promise<ResolvedPlayback> {
    const ep = episodeId(value), audio = idDecode<{ selectedAudio: AudioPreference }>(value, provider).selectedAudio;
    if (!ep.audio.includes(audio)) throw invalid();
    const boot = await api(`playback-bootstrap/${ep.source}/${ep.routeId}?${new URLSearchParams({ ep: String(ep.number), lang: audio, core: '0' })}`, signal);
    if (boot.effectiveLanguage !== audio || record(boot.availability)?.[audio] !== true) throw new ApiError('UNAVAILABLE', 'Requested Ani.pm audio is unavailable', 404, provider);
    if (boot.episode !== ep.number || typeof boot.settlarSelection !== 'string' || !boot.settlarSelection || boot.settlarSelection.length > 16000) throw fail();
    const session = await api(`settlar/session?${new URLSearchParams({ selection: boot.settlarSelection, provider, ep: String(ep.number), channel: audio, telemetry: '0' })}`, signal);
    if (session.provider !== provider) throw fail();
    const sessionExpiry = expiry(session.expiresAt), embed = trustedUrl(session.embedUrl, 'embed.settlar.io');
    const tokens = embed.searchParams.getAll('t');
    if (embed.pathname !== '/embed/v1' || tokens.length !== 1 || !tokens[0] || [...embed.searchParams.keys()].some(k => k !== 't')) throw fail();
    signal.throwIfAborted();
    const data = record(await json(`https://embed.settlar.io/api/embed/session?${new URLSearchParams({ t: tokens[0] })}`, provider, signal));
    if (!data || data.kind !== 'hls' || data.audioLang !== (audio === 'dub' ? 'en' : 'ja') || typeof data.keyProof !== 'string' || !data.keyProof || data.keyProof.length > 8192 || /[\r\n]/.test(data.keyProof) || !Array.isArray(data.subtitles)) throw fail();
    const source = trustedUrl(data.source, 'media.settlar.io').href;
    const subtitles = [...data.subtitles].sort((a,b) => Number(record(b)?.default === true)-Number(record(a)?.default === true)).map(value => {
      const t = record(value);
      if (!t || t.pick !== undefined && !['plain', 'ass', 'both'].includes(String(t.pick)) || typeof t.label !== 'string' || typeof t.srclang !== 'string') throw fail();
      return { url: trustedUrl(t.pick === 'ass' ? t.assUrl : t.url, 'media.settlar.io').href, format: t.pick === 'ass' ? 'ass' as const : 'vtt' as const, label: t.label, language: t.srclang };
    });
    const skip = record(boot.skip), intro = interval(skip?.op), outro = interval(skip?.ed);
    return { sources: [{ url: source, type: 'hls' }], subtitles, audioLanguage: audio === 'dub' ? 'en' : 'ja', headers: { Origin: embed.origin, 'X-Settlar-Key-Proof': data.keyProof }, expiresAt: Math.min(sessionExpiry, expiry(data.expiresAt)), ...(intro ? { intro } : {}), ...(outro ? { outro } : {}) };
  }
};
