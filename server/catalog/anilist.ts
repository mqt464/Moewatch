import { anilist } from '../infrastructure/anilist';
import { normalizeAnime, type Anime } from '../../src/catalog';
import { TtlCache } from '../infrastructure/cache';
import { ApiError } from '../infrastructure/errors';

const selection = `id isAdult title { english romaji native } description coverImage { extraLarge large } bannerImage
  startDate { year } format episodes duration averageScore popularity genres status studios(isMain: true) { nodes { name } }
  characters(perPage: 12, sort: ROLE) { edges { role node { name { full } image { large } } } }
  relations { edges { relationType node { id type isAdult title { english romaji } coverImage { large } } } }`;

async function query(document: string, variables: Record<string, unknown>, signal: AbortSignal): Promise<Anime[]> {
  const response = await anilist.request(document, variables, { signal, ttlMs: 5 * 60_000 });
  if (!response.ok) throw new ApiError(response.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR', `AniList HTTP ${response.status}`, response.status === 429 ? 429 : 502);
  const body = await response.json();
  if (body.errors?.length || !body.data) throw new ApiError('UPSTREAM_ERROR', 'AniList could not complete the request');
  const media = body.data.Page?.media ?? (body.data.Media ? [body.data.Media] : []);
  if (!Array.isArray(media)) throw new ApiError('UPSTREAM_ERROR', 'AniList returned invalid metadata');
  return media.map(normalizeAnime);
}

export type Catalog = { search(options: { search?: string; genre?: string }, signal: AbortSignal): Promise<Anime[]>; anime(id: number, signal: AbortSignal): Promise<Anime | null> };

export function createAniListCatalog(): Catalog {
  const cache = new TtlCache<Anime | Anime[]>(256, 5 * 60_000);
  return {
    async search(options, signal) {
      const key = `search:${JSON.stringify(options)}`;
      const stored = cache.get(key);
      if (Array.isArray(stored)) return stored;
      const result = await query(`query ($search: String, $genre: String) { Page(perPage: 24) { media(search: $search, genre: $genre, type: ANIME, isAdult: false, sort: [TRENDING_DESC]) { ${selection} } } }`, options, signal);
      cache.set(key, result);
      return result;
    },
    async anime(id, signal) {
      const key = `anime:${id}`;
      const stored = cache.get(key);
      if (stored && !Array.isArray(stored)) return stored;
      const [result] = await query(`query ($id: Int) { Media(id: $id, type: ANIME, isAdult: false) { ${selection} idMal streamingEpisodes { title thumbnail } } }`, { id }, signal);
      if (result) cache.set(key, result);
      return result ?? null;
    },
  };
}
