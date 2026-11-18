import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ExternalLink, Info, LogIn, LogOut, Settings2, UserRound } from 'lucide-react';
import { useAccount } from './AccountContext';

export function ProfileMenu() {
  const { user, configured, loading, signingIn, login, logout } = useAccount();
  const [failedAvatar, setFailedAvatar] = useState('');
  const avatar = user?.avatar && user.avatar !== failedAvatar ? <img src={user.avatar} alt="" referrerPolicy="no-referrer" onError={() => setFailedAvatar(user.avatar)} /> : <UserRound aria-hidden="true" size={20} strokeWidth={1.5} />;
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);
  const id = useId();
  const location = useLocation();

  useEffect(() => setOpen(false), [location]);
  useEffect(() => {
    if (!open) return;
    const items = menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    items?.[focusLast.current ? items.length - 1 : 0]?.focus();
    focusLast.current = false;
    function dismiss(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  return <div className="profile-container" ref={container} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }
  }}>
    <button ref={trigger} className="profile-button" aria-label="Profile menu" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); focusLast.current = event.key === 'ArrowUp'; setOpen(true); }
    }}>{avatar}</button>
    {open && <div className="profile-menu" ref={menu} id={id} role="menu" aria-label="Profile" onKeyDown={event => {
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null;
      if (next !== null) { event.preventDefault(); items[next]?.focus(); }
    }}>
      <button role="menuitem" tabIndex={-1} aria-disabled={!!user || loading || !configured || signingIn} className={user || loading || !configured || signingIn ? 'is-dimmed' : undefined} onClick={() => { if (!user && !loading && configured && !signingIn) login(); }}><LogIn aria-hidden="true" size={16} />{signingIn ? 'Signing in' : 'Sign in'}</button>
      {user ? <a role="menuitem" tabIndex={-1} href={`https://anilist.co/user/${encodeURIComponent(user.name)}`} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" size={16} />AniList profile</a> : <span role="menuitem" aria-disabled="true" className="is-dimmed"><ExternalLink aria-hidden="true" size={16} />AniList profile</span>}
      <div className="profile-menu-divider" role="separator" />
      <Link role="menuitem" tabIndex={-1} to="/settings"><Settings2 aria-hidden="true" size={16} />Settings</Link>
      <Link role="menuitem" tabIndex={-1} to="/settings/about"><Info aria-hidden="true" size={16} />About</Link>
      <div className="profile-menu-divider" role="separator" />
      <button role="menuitem" tabIndex={-1} aria-disabled={!user || loading} className={`profile-menu-signout${!user || loading ? ' is-dimmed' : ''}`} onClick={() => { if (user && !loading) { setOpen(false); void logout(); trigger.current?.focus(); } }}><LogOut aria-hidden="true" size={16} />Sign out</button>
    </div>}
  </div>;
}
