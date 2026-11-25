import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { apiRequest } from './api';
import type { AccountEntry, AccountStatus } from '../shared/account';
import type { Anime } from './catalog';
import { readLibrary, recordProgress, libraryStatus, setLibraryStatus, type Library, type Progress } from './library';
import { editEntry, setEntryStatus, freshAccount, mergeRemote, readAccount, type AccountLibrary } from './accountSync';

type User = { id: number; name: string; avatar: string };
type AccountValue = { user: User | null; configured: boolean | null; loading: boolean; error: string; syncing: boolean; lastSynced: number | null; storageError: boolean; library: Library; statusFor: (anime: Anime) => AccountStatus | null; setStatus: (anime: Anime, status: AccountStatus | null) => void; toggle: (anime: Anime) => void; update: (progress: Progress) => void; signingIn: boolean; cancelLogin: () => void; login: () => void; logout: () => Promise<void>; sync: () => Promise<void> };
const Context = createContext<AccountValue>(null!);
export const useAccount = () => useContext(Context);
const guestKey = 'moewatch-library-v1';
const key = (id: number) => `moewatch-anilist-${id}-v1`;
const message = (e: unknown) => e instanceof Error ? e.message : 'Account sync unavailable';
export function AccountProvider({ children }: { children: ReactNode }) {
  const [signingIn, setSigningIn] = useState(false);
  const loginAttempt = useRef<{ controller: AbortController; popup: Pick<Window, 'close'> } | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [state, setState] = useState<AccountLibrary>(() => { try { return { ...freshAccount(), library: readLibrary(localStorage.getItem(guestKey)) }; } catch { return freshAccount(); } });
  const current = useRef(state); const owner = useRef<User | null>(null); const generation = useRef(0); const busy = useRef(false); const stopping = useRef(false);
  function save(next: AccountLibrary) {
    current.current = next; setState(next);
    try { localStorage.setItem(owner.current ? key(owner.current.id) : guestKey, JSON.stringify(owner.current ? next : next.library)); setStorageError(false); }
    catch { setStorageError(true); }
  }
  function select(next: User | null) {
    if (owner.current?.id === next?.id) { owner.current = next; setUser(next); return; }
    generation.current++; owner.current = next; setUser(next);
    try { const value = next ? readAccount(localStorage.getItem(key(next.id))) : { ...freshAccount(), library: readLibrary(localStorage.getItem(guestKey)) }; current.current = value; setState(value); }
    catch { current.current = freshAccount(); setState(current.current); setStorageError(true); }
  }
  const lastAutomaticAttempt = useRef(0);
  async function sync(manual = true) {
    if (busy.current || stopping.current) return;
    if (!manual && !Object.keys(current.current.pending).length && Date.now() - lastAutomaticAttempt.current < 3 * 60_000) return;
    lastAutomaticAttempt.current = Date.now();
    busy.current = true; setSyncing(true);
    const run = generation.current;
    try {
      const status = await apiRequest<{ configured: boolean; user: User | null; error?: string }>('/account');
      if (run !== generation.current || stopping.current) return;
      setConfigured(status.configured);
      // An upstream failure must not detach an account or discard its queued edits.
      if (status.error && !status.user) throw new Error(status.error);
      select(status.user);
      if (!status.user) { setError(''); return; }
      const account = status.user.id; const epoch = generation.current;
      const valid = () => epoch === generation.current && !stopping.current;
      const headers = { 'Content-Type': 'application/json', 'X-Moewatch-Account': String(account), 'X-Moewatch-Refresh': manual || Object.keys(current.current.pending).length ? '1' : '0' };
      let wrote = false;
      const result = await apiRequest<{ entries: AccountEntry[] }>('/account/list', { headers });
      if (!valid()) return;
      save(mergeRemote(current.current, result.entries));
      for (const pending of Object.values(current.current.pending)) {
        if (!valid()) return;
        const remote = result.entries.find(e => e.mediaId === pending.mediaId);
        // Newer edits made on AniList win; unsent local edits remain durable on failures.
        if (!remote || remote.updatedAt * 1000 <= pending.edited) {
          if (pending.deleted) {
            if (remote) { await apiRequest(`/account/list/${pending.mediaId}`, { method: 'DELETE', headers }); wrote = true; }
          } else { await apiRequest('/account/list', { method: 'PUT', headers, body: JSON.stringify(pending) }); wrote = true; }
        }
        if (!valid()) return;
        if (current.current.pending[pending.mediaId]?.edited === pending.edited) {
          const next = { ...current.current, pending: { ...current.current.pending } }; delete next.pending[pending.mediaId]; save(next);
        }
      }
      const final = wrote ? await apiRequest<{ entries: AccountEntry[] }>('/account/list', { headers: { ...headers, 'X-Moewatch-Refresh': '0' } }) : result;
      if (valid()) { save({ ...mergeRemote(current.current, final.entries), lastSynced: Date.now() }); setError(''); }
    } catch (e) { if (!stopping.current) setError(message(e)); }
    finally { busy.current = false; setSyncing(false); setLoading(false); }
  }
  const syncRef = useRef(sync); syncRef.current = sync;
  useEffect(() => {
    void syncRef.current(false);
    const refresh = () => { if (document.visibilityState === 'visible') void syncRef.current(false); };
    const storage = (event: StorageEvent) => {
      const activeKey = owner.current ? key(owner.current.id) : guestKey;
      if (event.key !== activeKey || !event.newValue) return;
      generation.current++;
      const incoming = owner.current ? readAccount(event.newValue) : { ...freshAccount(), library: readLibrary(event.newValue) };
      current.current = incoming; setState(incoming);
    };
    window.addEventListener('storage', storage);
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); window.removeEventListener('storage', storage); };
  }, []);
  useEffect(() => {
    if (!user || !Object.keys(state.pending).length) return;
    const timer = window.setTimeout(() => void syncRef.current(false), 1500);
    return () => window.clearTimeout(timer);
  }, [state.pending, user]);
  async function logout() {
    cancelLogin();
    stopping.current = true; generation.current++;
    try { await apiRequest('/account/logout', { method: 'POST' }); select(null); setError(''); }
    catch (e) { setError(message(e)); }
    finally { stopping.current = false; }
  }
  function cancelLogin() {
    const attempt = loginAttempt.current; loginAttempt.current = null;
    attempt?.controller.abort(); attempt?.popup.close(); setSigningIn(false);
    if (attempt) void apiRequest('/account/login/cancel', { method: 'POST', keepalive: true }).catch(() => {});
  }
  useEffect(() => () => {
    const attempt = loginAttempt.current; loginAttempt.current = null;
    attempt?.controller.abort(); attempt?.popup.close();
    if (attempt) void apiRequest('/account/login/cancel', { method: 'POST', keepalive: true }).catch(() => {});
  }, []);
  function login() {
    if (loginAttempt.current) return;
    const popup = isTauri() ? { close() {}, closed: false, location: { href: '' } } : window.open('about:blank', '_blank', 'popup,width=560,height=760');
    if (!popup) { setError('Allow popups to sign in with AniList.'); return; }
    const attempt = { controller: new AbortController(), popup };
    const epoch = generation.current;
    loginAttempt.current = attempt; setSigningIn(true); setError('');
    const valid = () => loginAttempt.current === attempt && generation.current === epoch;
    const pause = (ms: number) => new Promise<void>((resolve, reject) => {
      const signal = attempt.controller.signal;
      if (signal.aborted) { reject(new Error('Sign-in cancelled.')); return; }
      const abort = () => { window.clearTimeout(timer); reject(new Error('Sign-in cancelled.')); };
      const timer = window.setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
      signal.addEventListener('abort', abort, { once: true });
    });
    void (async () => {
      const signal = attempt.controller.signal;
      try {
        const start = await apiRequest<{ mode: 'direct' | 'relay'; authorizeUrl: string; expiresAt: number; interval: number }>('/account/login/start', { method: 'POST', signal });
        if (!valid()) return;
        if (start.mode === 'direct') { popup.close(); window.location.assign(start.authorizeUrl); return; }
        if (start.mode !== 'relay' || !Number.isFinite(start.expiresAt) || !Number.isFinite(start.interval)) throw new Error('Invalid sign-in response.');
        if (isTauri()) await openUrl(start.authorizeUrl);
        else popup.location.href = start.authorizeUrl;
        const expiresAt = Math.min(start.expiresAt, Date.now() + 600000);
        while (Date.now() < expiresAt) {
          await pause(Math.max(3000, Math.min(10000, start.interval * 1000)));
          if (!valid()) return;
          const result = await apiRequest<{ status: 'pending' | 'complete' | 'denied' }>('/account/login/poll', { method: 'POST', signal });
          if (!valid()) return;
          if (result.status === 'complete') {
            popup.close();
            generation.current++;
            // Let an older sync observe the identity change before refreshing the new account.
            while (busy.current && Date.now() < expiresAt) await pause(100);
            if (!signal.aborted && loginAttempt.current === attempt) await syncRef.current();
            return;
          }
          if (result.status === 'denied') throw new Error('AniList sign-in was declined.');
          if (result.status !== 'pending') throw new Error('Invalid sign-in response.');
          if (popup.closed) throw new Error('Sign-in cancelled.');
        }
        throw new Error('Sign-in timed out. Try again.');
      } catch (failure) { if (loginAttempt.current === attempt) setError(message(failure)); }
      finally {
        if (loginAttempt.current === attempt) {
          loginAttempt.current = null; setSigningIn(false); popup.close();
          void apiRequest('/account/login/cancel', { method: 'POST' }).catch(() => {});
        }
      }
    })();
  }
  function statusFor(anime: Anime): AccountStatus | null { return libraryStatus(current.current.library, anime); }
  function setStatus(anime: Anime, status: AccountStatus | null) {
    const old = current.current;
    if (statusFor(anime) === status) return;
    save(owner.current ? setEntryStatus(old, anime, status) : { ...old, library: setLibraryStatus(old.library, anime, status) });
  }
  function toggle(anime: Anime) { setStatus(anime, statusFor(anime) ? null : 'PLANNING'); }
  function update(progress: Progress) {
    const old = current.current; const library = recordProgress(old.library, progress);
    if (library === old.library) return;
    const next = owner.current ? editEntry(old, progress.anime, progress) : old;
    // Watching a title adds it to the connected AniList library.
    const status = next.pending[progress.anime.id]?.status ?? libraryStatus(library, progress.anime);
    save({ ...next, library: owner.current ? setLibraryStatus(library, progress.anime, status ?? 'CURRENT') : library });
  }
  return <Context.Provider value={{ user, configured, loading, error, syncing, lastSynced: state.lastSynced, storageError, library: state.library, statusFor, setStatus, toggle, update, signingIn, cancelLogin, login, logout, sync }}>{children}</Context.Provider>;
}
