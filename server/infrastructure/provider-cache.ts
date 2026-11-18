import type { ProviderEpisode, ProviderServer, TitleMatch } from '../../shared/api';
import type { AnimeProvider } from '../providers/types';
import { TtlCache } from './cache';

export function cacheProvider(provider: AnimeProvider): AnimeProvider {
  const matches = new TtlCache<TitleMatch>(256, 60_000);
  const episodes = new TtlCache<ProviderEpisode[]>(256, 60_000);
  const servers = new TtlCache<ProviderServer[]>(512, 30_000);
  return {
    ...provider,
    async match(anime, signal) {
      const key = JSON.stringify([anime.id, anime.title, anime.romaji, anime.year, anime.format]);
      const existing = matches.get(key);
      if (existing) return existing;
      const result = await provider.match(anime, signal);
      if (!signal.aborted) matches.set(key, result);
      return result;
    },
    async episodes(titleId, signal) {
      const existing = episodes.get(titleId);
      if (existing) return existing;
      const result = await provider.episodes(titleId, signal);
      if (!signal.aborted) episodes.set(titleId, result);
      return result;
    },
    async servers(episodeId, signal) {
      const existing = servers.get(episodeId);
      if (existing) return existing;
      const result = await provider.servers(episodeId, signal);
      if (!signal.aborted) servers.set(episodeId, result);
      return result;
    },
  };
}
