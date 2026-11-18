import { accountStatuses, type AccountEntry, type AccountStatus } from '../shared/account';
import { readLibrary, setLibraryStatus, type Library, type Progress } from './library';
import type { Anime } from './catalog';

export type Pending = { mediaId: number; status: AccountStatus; progress: number; deleted?: boolean; edited: number };
export type AccountLibrary = { library: Library; entries: AccountEntry[]; pending: Record<string, Pending>; lastSynced: number | null };
export const freshAccount = (): AccountLibrary => ({ library: { saved: [], progress: [] }, entries: [], pending: {}, lastSynced: null });
export function readAccount(raw: string | null): AccountLibrary {
  try {
    const value = JSON.parse(raw || 'null');
    if (!value || !Array.isArray(value.entries) || !value.pending) return freshAccount();
    return { library: readLibrary(JSON.stringify(value.library)), entries: value.entries.filter((e: AccountEntry) => Number.isSafeInteger(e?.mediaId)), pending: Object.fromEntries(Object.entries(value.pending).filter(([, e]) => { const p = e as Pending; return Number.isSafeInteger(p?.mediaId) && p.mediaId > 0 && accountStatuses.includes(p.status) && Number.isFinite(p.edited) && Number.isInteger(p.progress) && p.progress >= 0; })) as Record<string, Pending>, lastSynced: Number.isFinite(value.lastSynced) ? value.lastSynced : null };
  } catch { return freshAccount(); }
}
export function completed(progress: Progress): number { return Math.max(0, progress.episode - (progress.time / progress.duration >= .95 ? 0 : 1)); }
export function editEntry(state: AccountLibrary, anime: Anime, progress?: Progress, deleted = false): AccountLibrary {
  const old = state.pending[anime.id] ?? state.entries.find(e => e.mediaId === anime.id);
  const count = progress ? Math.max(completed(progress), old?.progress ?? 0) : old?.progress ?? 0;
  const status: AccountStatus = progress ? anime.episodes && count >= anime.episodes ? 'COMPLETED' : old?.status === 'COMPLETED' ? 'COMPLETED' : old?.status === 'REPEATING' ? 'REPEATING' : count > 0 || progress.time > 0 ? 'CURRENT' : old?.status ?? 'PLANNING' : old?.status ?? 'PLANNING';
  if (progress && old && !('deleted' in old && old.deleted) && old.progress === count && old.status === status) return state;
  return { ...state, pending: { ...state.pending, [anime.id]: { mediaId: anime.id, status, progress: count, deleted, edited: Math.max(Date.now(), (state.pending[anime.id]?.edited ?? 0) + 1) } } };
}
export function mergeRemote(state: AccountLibrary, entries: AccountEntry[]): AccountLibrary {
  const saved = entries.map(entry => entry.anime);
  const progress: Progress[] = [];
  const statuses: Record<string, AccountStatus> = Object.fromEntries(entries.map(e => [e.mediaId, e.status]));
  for (const entry of entries) {
    const local = state.library.progress.find(p => p.anime.id === entry.mediaId);
    if (local && completed(local) === entry.progress) progress.push(local);
    else if (entry.progress > 0) {
      const finished = entry.anime.episodes !== null && entry.progress >= entry.anime.episodes;
      progress.push({ anime: entry.anime, episode: finished ? entry.progress : entry.progress + 1, time: finished ? 1 : 0, duration: 1, updated: entry.updatedAt * 1000 });
    }
  }
  for (const pending of Object.values(state.pending)) {
    const anime = state.library.saved.find(a => a.id === pending.mediaId) ?? state.library.progress.find(p => p.anime.id === pending.mediaId)?.anime;
    const index = saved.findIndex(a => a.id === pending.mediaId);
    if (pending.deleted) { delete statuses[pending.mediaId]; if (index >= 0) saved.splice(index, 1); }
    else statuses[pending.mediaId] = pending.status;
    if (!pending.deleted && index < 0 && anime) saved.push(anime);
    const local = state.library.progress.find(p => p.anime.id === pending.mediaId);
    if (local) { const index = progress.findIndex(p => p.anime.id === pending.mediaId); if (index >= 0) progress.splice(index, 1); progress.push(local); }
  }
  return { ...state, entries, library: { saved, statuses, progress: progress.sort((a, b) => b.updated - a.updated) } };
}

export function setEntryStatus(state: AccountLibrary, anime: Anime, status: AccountStatus | null): AccountLibrary {
  const old = state.pending[anime.id] ?? state.entries.find(e => e.mediaId === anime.id);
  const localProgress = state.library.progress.find(p => p.anime.id === anime.id);
  const progress = status === 'COMPLETED' && anime.episodes ? anime.episodes : old?.progress ?? (localProgress ? completed(localProgress) : 0);
  return { ...state, library: setLibraryStatus(state.library, anime, status), pending: { ...state.pending, [anime.id]: { mediaId: anime.id, status: status ?? old?.status ?? 'PLANNING', progress, deleted: status === null, edited: Math.max(Date.now(), (state.pending[anime.id]?.edited ?? 0) + 1) } } };
}
