import snapshot from './curated.json' with { type: 'json' };
import { apiRequest } from './api';

export type Anime = {
  id: number;
  malId?: number;
  title: string;
  romaji: string;
  description: string;
  cover: string;
  banner: string;
  year: number;
  format: string;
  episodes: number | null;
  duration: number;
  score: number;
  popularity?: number;
  genres: string[];
  status: string;
  studios: string[];
  episodeArtwork?: { number: number; title: string; thumbnail: string; titleSource?: 'anilist' | 'jikan' | 'kitsu'; thumbnailSource?: 'anilist' | 'jikan' | 'kitsu' }[];
  characters: { name: string; image: string; role: string }[];
  related: { id: number; title: string; cover: string; relation: string }[];
};

export const curated = snapshot as Anime[];
const sessionCatalog = new Map<number, Anime>(curated.map(anime => [anime.id, anime]));
export const cachedAnime = (id: number): Anime | undefined => sessionCatalog.get(id);
export const stripHtml = (value: string | null | undefined): string => (value ?? '')
  .replace(/<br\s*\/?\s*>/gi, '\n')
  .replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '“')
  .replace(/&#39;|&apos;/gi, '’')
  .replace(/\n\s*\n(?:\s*\n)+/g, '\n\n')
  .trim();

type Media = {
  id: number; idMal?: number; title?: { english?: string; native?: string; romaji?: string };
  description?: string; coverImage?: { extraLarge?: string; large?: string }; bannerImage?: string;
  startDate?: { year?: number }; format?: string; episodes?: number; duration?: number;
  averageScore?: number; popularity?: number; genres?: string[]; status?: string;
  streamingEpisodes?: { title?: string; thumbnail?: string }[];
  studios?: { nodes: { name: string }[] };
  characters?: { edges: { role: string; node: { name: { full: string }; image: { large: string } } }[] };
  relations?: { edges: { relationType: string; node: { id: number; type: string; isAdult: boolean; title: { english?: string; romaji?: string }; coverImage: { large: string } } }[] };
};

export function normalizeAnime(media: Media): Anime {
  const title = media.title?.english || media.title?.romaji || media.title?.native || 'Untitled';
  return {
    id: Number(media.id), malId: Number.isSafeInteger(media.idMal) && media.idMal! > 0 ? media.idMal : undefined, title, romaji: media.title?.romaji || title,
    description: stripHtml(media.description), cover: media.coverImage?.extraLarge || media.coverImage?.large || '',
    banner: media.bannerImage || media.coverImage?.extraLarge || media.coverImage?.large || '',
    year: media.startDate?.year ?? 0, format: media.format || 'UNKNOWN', episodes: media.episodes ?? null,
    duration: media.duration ?? 0, score: media.averageScore ?? 0, genres: media.genres ?? [], status: media.status || 'UNKNOWN',
    popularity: Number.isSafeInteger(media.popularity) && media.popularity! > 0 ? media.popularity : undefined,
    episodeArtwork: (media.streamingEpisodes ?? []).flatMap(episode => {
      // AniList has no numeric episode field; never infer numbering from array order.
      const match = episode.title?.match(/^Episode (\d+)\s*[-\u2013\u2014:]\s*(.+)$/i);
      return match && Number(match[1]) > 0
        ? [{ number: Number(match[1]), title: match[2], thumbnail: episode.thumbnail?.startsWith('https://') ? episode.thumbnail : '' }] : [];
    }),
    studios: (media.studios?.nodes ?? []).map(studio => studio.name),
    characters: (media.characters?.edges ?? []).map(edge => ({ name: edge.node.name.full, image: edge.node.image.large, role: edge.role })),
    related: (media.relations?.edges ?? []).filter(edge => edge.node.type === 'ANIME' && !edge.node.isAdult).map(edge => ({
      id: edge.node.id, title: edge.node.title.english || edge.node.title.romaji || 'Untitled', cover: edge.node.coverImage?.large || '', relation: edge.relationType,
    })),
  };
}

export async function fetchCatalog(options: { search?: string; genre?: string; signal?: AbortSignal } = {}): Promise<Anime[]> {
  const params = new URLSearchParams();
  if (options.search) params.set('search', options.search);
  if (options.genre) params.set('genre', options.genre);
  const body = await apiRequest<{ anime: Anime[] }>(`/catalog?${params}`, { signal: options.signal });
  if (!Array.isArray(body.anime)) throw new Error('Moewatch returned invalid catalog data');
  if (!options.signal?.aborted) body.anime.forEach(anime => sessionCatalog.set(anime.id, anime));
  return body.anime;
}

export async function fetchAnime(id: number, signal?: AbortSignal): Promise<Anime | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const { anime } = await apiRequest<{ anime: Anime | null }>(`/anime/${id}`, { signal });
  if (anime && !signal?.aborted) sessionCatalog.set(anime.id, anime);
  return anime;
}
