import { accountStatuses, type AccountStatus } from '../shared/account';
import type { Anime } from './catalog';

export type Progress = { anime: Anime; episode: number; time: number; duration: number; updated: number };
export type Library = { saved: Anime[]; progress: Progress[]; statuses?: Record<string, AccountStatus> };
export const emptyLibrary: Library = { saved: [], progress: [] };

function validAnime(value: unknown): value is Anime {
  if (!value || typeof value !== 'object') return false;
  const anime = value as Partial<Anime>;
  return Number.isSafeInteger(anime.id) && Number(anime.id) > 0
    && ['title', 'romaji', 'description', 'cover', 'banner', 'format', 'status'].every(key => typeof anime[key as keyof Anime] === 'string')
    && ['year', 'duration', 'score'].every(key => Number.isFinite(anime[key as keyof Anime]))
    && (anime.episodes === null || (Number.isInteger(anime.episodes) && Number(anime.episodes) > 0))
    && [anime.genres, anime.studios].every(list => Array.isArray(list) && list.every(item => typeof item === 'string'))
    && Array.isArray(anime.characters) && anime.characters.every(item => item && typeof item.name === 'string' && typeof item.image === 'string' && typeof item.role === 'string')
    && Array.isArray(anime.related) && anime.related.every(item => item && Number.isSafeInteger(item.id) && typeof item.title === 'string' && typeof item.cover === 'string' && typeof item.relation === 'string');
}

export function readLibrary(raw: string | null): Library {
  try {
    const value = JSON.parse(raw || 'null');
    if (!value || !Array.isArray(value.saved) || !Array.isArray(value.progress)) return emptyLibrary;
    return {
      saved: value.saved.filter(validAnime),
      ...(value.statuses && typeof value.statuses === 'object' ? { statuses: Object.fromEntries(Object.entries(value.statuses).filter(([id, status]) => Number.isSafeInteger(Number(id)) && Number(id) > 0 && accountStatuses.includes(status as AccountStatus))) as Record<string, AccountStatus> } : {}),
      progress: value.progress.filter((item: Progress) => validAnime(item?.anime) && Number.isInteger(item.episode) && item.episode > 0 && Number.isFinite(item.time) && item.time >= 0 && Number.isFinite(item.duration) && item.duration > 0),
    };
  } catch {
    return emptyLibrary;
  }
}

export function toggleSaved(library: Library, anime: Anime): Library {
  return setLibraryStatus(library, anime, library.saved.some(item => item.id === anime.id) ? null : 'PLANNING');
}

export function recordProgress(library: Library, progress: Progress): Library {
  if (!Number.isFinite(progress.duration) || progress.duration <= 0 || !Number.isFinite(progress.time) || progress.time < 0) return library;
  return { ...library, progress: [progress, ...library.progress.filter(item => item.anime.id !== progress.anime.id)].slice(0, 30) };
}

export function episodeNumber(value: string | undefined, total: number | null): number {
  const episode = Number(value);
  return Number.isSafeInteger(episode) && episode >= 1 && episode <= 100000 ? (total ? Math.min(episode, total) : episode) : 1;
}

export function libraryStatus(library: Library, anime: Anime): AccountStatus | null {
  return library.saved.some(item => item.id === anime.id) ? library.statuses?.[anime.id] ?? 'PLANNING' : null;
}
export function setLibraryStatus(library: Library, anime: Anime, status: AccountStatus | null): Library {
  const statuses = { ...library.statuses };
  if (status) statuses[anime.id] = status; else delete statuses[anime.id];
  return { ...library, statuses, saved: status ? library.saved.some(item => item.id === anime.id) ? library.saved : [...library.saved, anime] : library.saved.filter(item => item.id !== anime.id) };
}
