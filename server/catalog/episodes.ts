import type { Anime } from '../../src/catalog';
import { TtlCache } from '../infrastructure/cache';
import { setTimeout as delay } from 'node:timers/promises';

type Episode = NonNullable<Anime['episodeArtwork']>[number];
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
function imageUrl(value: unknown): string {
  try { const url = new URL(text(value)); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}

// Enrich individual episode fields only; the catalogue identity and episode count stay authoritative.
export function createEpisodeMetadata(request: typeof fetch = fetch) {
  const cache = new TtlCache<Episode[]>(256, 60 * 60_000);
  return async (anime: Anime, parent: AbortSignal): Promise<Anime> => {
    const count = positive(anime.episodes) ? Math.min(anime.episodes, 10000) : 0;
    const primary = anime.episodeArtwork ?? [];
    if (count && Array.from({ length: count }, (_, i) => primary.find(e => e.number === i + 1)).every(e => e?.title && e.thumbnail)) return anime;
    const key = String(anime.id);
    let fallback = cache.get(key);
    if (!fallback) {
      const signal = AbortSignal.any([parent, AbortSignal.timeout(5000)]);
      const episodes = new Map<number, Episode>();
      let failed = false;
      async function json(url: string) {
        const response = await request(url, { signal, headers: { Accept: url.startsWith('https://kitsu.io/') ? 'application/vnd.api+json' : 'application/json' } });
        if (!response.ok) throw new Error(`Episode metadata HTTP ${response.status}`);
        return response.json();
      }
      function add(number: unknown, title: unknown, thumbnail: unknown, source: 'kitsu' | 'jikan') {
        if (!positive(number) || (count && number > count)) return;
        const old = episodes.get(number);
        const useTitle = text(title) && (source === 'jikan' || !old?.title);
        episodes.set(number, { number, title: useTitle ? text(title) : old?.title || '', thumbnail: old?.thumbnail || imageUrl(thumbnail),
          titleSource: useTitle ? source : old?.titleSource,
          thumbnailSource: old?.thumbnail ? old.thumbnailSource : imageUrl(thumbnail) ? source : undefined });
      }
      let mapping: { mal_id?: number; kitsu_id?: number } = {};
      try {
        const result = await json(`https://api.ani.zip/mappings?anilist_id=${anime.id}`);
        // Reject a mapping to a different series; never use fuzzy title matching.
        if (result.mappings?.anilist_id === anime.id && (!anime.malId || result.mappings.mal_id === anime.malId)) mapping = result.mappings;
      } catch { failed = true; }
      const malId = anime.malId || mapping.mal_id;
      const limit = count || 100;
      const missingTitles = !count || Array.from({ length: count }, (_, i) => primary.find(e => e.number === i + 1)).some(e => !e?.title);
      const missingImages = !count || Array.from({ length: count }, (_, i) => primary.find(e => e.number === i + 1)).some(e => !e?.thumbnail);
      await Promise.allSettled([
        (async () => {
          if (!missingImages || !positive(mapping.kitsu_id)) return;
          for (let offset = 0; offset < limit; offset += 20) {
            const result = await json(`https://kitsu.io/api/edge/episodes?filter[media_id]=${mapping.kitsu_id}&page[limit]=20&page[offset]=${offset}&sort=number`);
            if (!Array.isArray(result.data)) throw new Error('Invalid Kitsu episodes');
            for (const entry of result.data) {
              const e = entry?.attributes;
              if (e) add(e.number, e.titles?.en_us || e.canonicalTitle || e.titles?.en_jp, e.thumbnail?.original, 'kitsu');
            }
            if (result.data.length < 20) break;
          }
        })().catch(() => { failed = true; }),
        (async () => {
          if (!missingTitles || !positive(malId)) return;
          for (let page = 1; page <= Math.ceil(limit / 100); page++) {
            if (page > 1) await delay(500, undefined, { signal });
            const result = await json(`https://api.jikan.moe/v4/anime/${malId}/episodes?page=${page}`);
            if (!Array.isArray(result.data)) throw new Error('Invalid MAL episodes');
            for (const e of result.data) add(e?.mal_id, e?.title || e?.title_romanji, '', 'jikan');
            if (!result.pagination?.has_next_page) break;
          }
        })().catch(() => { failed = true; }),
      ]);
      parent.throwIfAborted();
      fallback = [...episodes.values()];
      // Unknown-length series fetch at most 100 records per source; add range requests if needed.
      cache.set(key, fallback, failed || !fallback.length ? 60_000 : 60 * 60_000);
    }
    const merged = new Map(fallback.map(e => [e.number, { ...e }]));
    for (const e of primary) {
      const secondary = merged.get(e.number);
      merged.set(e.number, { ...secondary, ...e, title: e.title || secondary?.title || '', thumbnail: e.thumbnail || secondary?.thumbnail || '',
        titleSource: e.title ? e.titleSource || 'anilist' : secondary?.titleSource,
        thumbnailSource: e.thumbnail ? e.thumbnailSource || 'anilist' : secondary?.thumbnailSource });
    }
    return { ...anime, episodeArtwork: [...merged.values()].sort((a, b) => a.number - b.number) };
  };
}

