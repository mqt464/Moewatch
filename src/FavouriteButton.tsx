import { useEffect, useRef, useState } from 'react';
import { Heart } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAccount } from './AccountContext';
import { apiRequest } from './api';

type Favourite = { isFavourite: boolean; isFavouriteBlocked: boolean };

export function FavouriteButton({ mediaId }: { mediaId: number }) {
  const { user, loading } = useAccount();
  if (!user) return <Link className="button secondary icon-button" to="/settings/account" aria-label="Connect AniList to favourite this anime" title="Connect AniList to favourite" aria-disabled={loading}><Heart size={18} aria-hidden="true" /></Link>;
  return <ConnectedFavourite key={`${user.id}:${mediaId}`} mediaId={mediaId} userId={user.id} />;
}

function ConnectedFavourite({ mediaId, userId }: { mediaId: number; userId: number }) {
  const [state, setState] = useState<Favourite | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const revision = useRef(0);
  const path = `/account/favourites/${mediaId}`;
  const headers = { 'Content-Type': 'application/json', 'X-Moewatch-Account': String(userId) };
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      if (document.visibilityState !== 'visible' || locked.current) return;
      const run = ++revision.current;
      void apiRequest<Favourite>(path, { headers: { 'X-Moewatch-Account': String(userId) }, signal: controller.signal })
        .then(value => { if (!controller.signal.aborted && run === revision.current) { setState(value); setError(''); } })
        .catch(() => { if (!controller.signal.aborted && run === revision.current) setError('Could not load AniList favourites. Refocus this window to retry.'); });
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { controller.abort(); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [path, userId]);
  async function toggle() {
    if (!state || locked.current) return;
    const previous = state;
    const desired = !state.isFavourite;
    revision.current++;
    locked.current = true; setBusy(true); setError('');
    setState({ ...state, isFavourite: desired });
    try {
      setState(await apiRequest<Favourite>(path, { method: 'PUT', headers, body: JSON.stringify({ isFavourite: desired }) }));
    } catch (error) { setState(previous); setError(error instanceof Error ? error.message : 'Could not sync favourite with AniList'); }
    finally { locked.current = false; setBusy(false); }
  }
  const label = state?.isFavourite ? 'Remove from AniList favourites' : 'Favourite on AniList';
  return <div className="favourite-control">
    <button className={`button secondary icon-button${state?.isFavourite ? ' is-saved' : ''}`} disabled={!state || busy || (state.isFavouriteBlocked && !state.isFavourite)} aria-pressed={state?.isFavourite ?? false} aria-busy={busy} aria-label={label} title={state?.isFavouriteBlocked ? 'Favourites unavailable for this anime' : label} onClick={() => void toggle()}><Heart size={18} fill={state?.isFavourite ? 'currentColor' : 'none'} aria-hidden="true" /></button>
    {error && <span className="favourite-error" role="alert">{error}</span>}
  </div>;
}
