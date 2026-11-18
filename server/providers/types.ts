import type { AnimeIdentity, ProviderEpisode, ProviderId, ProviderServer, ProviderTitle, ResolvedPlayback, TitleMatch } from '../../shared/api';

export interface AnimeProvider {
  id: ProviderId;
  name: string;
  configured: boolean;
  note?: string;
  search(query: string, signal: AbortSignal): Promise<ProviderTitle[]>;
  match(anime: AnimeIdentity, signal: AbortSignal): Promise<TitleMatch>;
  episodes(titleId: string, signal: AbortSignal): Promise<ProviderEpisode[]>;
  servers(episodeId: string, signal: AbortSignal): Promise<ProviderServer[]>;
  resolve(serverId: string, signal: AbortSignal): Promise<ResolvedPlayback>;
}
