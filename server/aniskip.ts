import type { SkipTimesResponse } from '../shared/api';
import { TtlCache } from './infrastructure/cache';

// AniSkip uses MAL IDs; never pass an AniList ID as a fallback.
export function createSkipService(request: typeof fetch = fetch) {
  const ids = new TtlCache<number | null>(256, 24 * 60 * 60_000);
  const times = new TtlCache<SkipTimesResponse>(512, 60 * 60_000);
  return async (animeId: number, episode: number, duration: number, parent: AbortSignal): Promise<SkipTimesResponse> => {
    const key = `${animeId}:${episode}:${duration.toFixed(3)}`;
    const cached = times.get(key);
    if (cached) return cached;
    const signal = AbortSignal.any([parent, AbortSignal.timeout(6000)]);
    try {
      let malId = ids.get(String(animeId));
      if (malId === undefined) {
        const response = await request('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'query ($id: Int!) { Media(id: $id, type: ANIME) { idMal } }', variables: { id: animeId } }), signal });
        if (!response.ok) throw new Error('Mapping unavailable');
        const body = await response.json();
        if (body.errors || !body.data?.Media) throw new Error('Mapping unavailable');
        const value = body.data.Media.idMal;
        malId = Number.isSafeInteger(value) && value > 0 ? value : null;
        ids.set(String(animeId), malId ?? null);
      }
      if (!malId) return { status: 'unmapped' };
      const url = new URL(`https://api.aniskip.com/v2/skip-times/${malId}/${episode}`);
      url.searchParams.append('types[]', 'op'); url.searchParams.append('types[]', 'ed');
      url.searchParams.set('episodeLength', duration.toFixed(3));
      const response = await request(url, { signal });
      if (response.status === 404) return { status: 'not-found', malId };
      if (!response.ok) throw new Error('Timings unavailable');
      const body = await response.json();
      if (typeof body.found !== 'boolean' || (body.found && !Array.isArray(body.results))) throw new Error('Invalid timings');
      const result: SkipTimesResponse = { status: 'not-found', malId };
      for (const item of body.found ? body.results : []) {
        const start = item.interval?.startTime, end = item.interval?.endTime;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > duration || !Number.isFinite(item.episodeLength) || Math.abs(item.episodeLength - duration) > 2) continue;
        if (item.skipType === 'op' && !result.intro) result.intro = { start, end };
        if (item.skipType === 'ed' && !result.outro) result.outro = { start, end };
      }
      if (result.intro || result.outro) result.status = 'available';
      times.set(key, result);
      return result;
    } catch { return { status: 'unavailable' }; }
  };
}


