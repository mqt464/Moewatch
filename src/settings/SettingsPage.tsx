import { isTauri } from '@tauri-apps/api/core';
import { AccessibilitySettings, AppearanceSettings, DataSettings, Diagnostics, SubtitleSettings } from './ExtraSettings';
import { SharedAccess } from './SharedAccess';
import { DesktopUpdates } from './DesktopUpdates';
import { ArrowLeft, Palette, CirclePlay, Info, Network, Plug, UserRound, Captions, Download, PersonStanding, Database, RefreshCw, LogOut, LogIn, ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useAccount } from '../AccountContext';
import { usePreferences } from '../PreferencesContext';
import { fetchProviders } from '../api';
import { type AudioPreference, type ProviderStatus } from '../../shared/api';
import { ScrollArea } from '../ScrollArea';
import { SettingRow, SettingsButton, SettingsCard, SettingsNotice, SettingsSelect, SettingsToggle } from './controls';
import { version } from '../../package.json';
import { ProviderRow } from './ProviderRow';
import { DownloadSettings } from '../downloads/DownloadSettings';

const pages = [
  { id: 'account', title: 'Account', icon: UserRound },
  { id: 'appearance', title: 'Appearance', icon: Palette },
  { id: 'playback', title: 'Playback', icon: CirclePlay },
  { id: 'subtitles', title: 'Subtitles', icon: Captions },
  { id: 'downloads', title: 'Downloads', icon: Download },
  { id: 'accessibility', title: 'Accessibility', icon: PersonStanding },
  { id: 'data', title: 'Data', icon: Database },
  { id: 'about', title: 'About', icon: Info },
];

function AccountSettings() {
  const { user, configured, loading, error, syncing, lastSynced, signingIn, cancelLogin, login, logout, sync } = useAccount();
  const [params] = useSearchParams();
  return <>
    <SettingsCard>
      <SettingRow title={<span className="settings-account"><span className="settings-avatar">{user?.avatar ? <img src={user.avatar} alt="" onError={event => { event.currentTarget.style.display = 'none'; }} /> : <UserRound size={24} aria-hidden="true" />}</span><span><span>{user ? user.name : 'AniList'}</span>{user && <span className="settings-account-service">AniList</span>}</span></span>}>
        {signingIn ? <SettingsButton onClick={cancelLogin}>Cancel sign-in</SettingsButton> : user ? <SettingsButton variant="danger" disabled={loading} onClick={() => void logout()}><LogOut size={15} aria-hidden="true" />Sign out</SettingsButton> : <SettingsButton variant="primary" disabled={loading || !configured} onClick={login}><LogIn size={15} aria-hidden="true" />{loading ? 'Checking account...' : 'Sign in with AniList'}</SettingsButton>}
      </SettingRow>
      {user && <SettingRow title="Sync AniList" description={lastSynced ? `Last synced ${new Date(lastSynced).toLocaleString()}` : undefined}><SettingsButton disabled={loading || syncing} onClick={() => void sync()}><RefreshCw size={15} aria-hidden="true" />{syncing ? 'Syncing...' : 'Sync now'}</SettingsButton></SettingRow>}
    </SettingsCard>
    {!loading && configured === false && <SettingsNotice error>AniList sign-in is not configured on this server.</SettingsNotice>}
    {params.get('result') === 'error' && <SettingsNotice error>AniList sign-in failed or was cancelled. Try again.</SettingsNotice>}
    {error && <SettingsNotice error>{error}</SettingsNotice>}
  </>;
}

function PlaybackSettings() {
  const { preferences, update } = usePreferences();
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setProviders([]);
    fetchProviders(controller.signal).then(result => { if (!controller.signal.aborted) setProviders(result.providers); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Provider status could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  return <>
    <SettingsCard>
      <SettingRow title="Preferred audio">{binding => <SettingsSelect {...binding} value={preferences.audio} onChange={event => update({ audio: event.target.value as AudioPreference })}><option value="sub">Japanese</option><option value="dub">English dub</option></SettingsSelect>}</SettingRow>
    </SettingsCard>

    <SettingsCard>{([['autoNext', 'Autoplay next episode'], ['resumePlayback', 'Resume saved position'], ['skipOpening', 'Skip openings automatically'], ['skipEnding', 'Skip endings automatically']] as const).map(([key, title]) => <SettingRow key={key} title={title}>{binding => <SettingsToggle {...binding} checked={preferences[key]} onChange={value => update({ [key]: value })} />}</SettingRow>)}</SettingsCard>
    <section aria-labelledby="provider-status-heading">
      <h2 id="provider-status-heading" className="settings-provider-heading">Providers</h2>
      <SettingsCard>
      <div className="provider-priority-list">
      {preferences.providerOrder.map(id => {
        const provider = providers.find(entry => entry.id === id);
        return <ProviderRow key={id} id={id} order={preferences.providerOrder} note={provider?.note} status={loading ? 'checking' : error ? 'unknown' : provider?.configured ? 'configured' : 'unavailable'} onChange={providerOrder => update({ providerOrder })} />;
      })}
      </div>
      </SettingsCard>
      {error && <SettingsNotice error>{error}</SettingsNotice>}
    </section>
  </>;
}

function IntegrationSettings() {
  const { preferences, update } = usePreferences();
  return <SettingsCard>
    <SettingRow title="Discord activity" description="Show what you’re watching in your Discord activity.">{binding => <SettingsToggle {...binding} checked={preferences.discordRpc} onChange={discordRpc => update({ discordRpc })} />}</SettingRow>
    <SettingRow title="Discord watch party" description="Turning this off leaves your party.">{binding => <SettingsToggle {...binding} checked={preferences.discordWatchParty} onChange={discordWatchParty => update({ discordWatchParty })} />}</SettingRow>
  </SettingsCard>;
}

export function SettingsPage() {
  const { section = 'account' } = useParams();
  const activeLink = useRef<HTMLAnchorElement>(null);
  useEffect(() => { if (window.matchMedia('(max-width: 600px)').matches) activeLink.current?.scrollIntoView({ block: 'nearest', inline: 'center' }); }, [section]);
  const { error } = usePreferences();
  const visiblePages = isTauri() ? [...pages.slice(0, 3), { id: 'integrations', title: 'Integrations', icon: Plug }, { id: 'shared-access', title: 'Sharing', icon: Network }, ...pages.slice(3)] : pages;
  const page = visiblePages.find(entry => entry.id === section);

  if (section === 'storage') return <Navigate to="/settings/downloads" replace />;

  return <div className="settings-layout">
    <aside className="settings-sidebar">
      <Link to="/" className="settings-back"><ArrowLeft aria-hidden="true" size={15} />Discover</Link>
      <ScrollArea className="settings-navigation"><nav aria-label="Settings pages">{visiblePages.map(entry => <NavLink ref={entry.id === section ? activeLink : undefined} key={entry.id} to={`/settings/${entry.id}`} className={entry.id === section ? 'active' : undefined} aria-current={entry.id === section ? 'page' : undefined} end><entry.icon aria-hidden="true" size={16} />{entry.title}</NavLink>)}</nav></ScrollArea>
    </aside>
    <div className="settings-content">
      <header className="settings-page-heading"><h1>{page?.title || 'Page not found'}</h1></header>
      {section === 'shared-access' && isTauri() && <SharedAccess />}
      {section === 'account' && <AccountSettings />}
      {section === 'appearance' && <SettingsCard><SettingRow title="Homepage"><Link className="settings-action settings-action-default" to="/" state={{ editHome: true }}>Customize home</Link></SettingRow></SettingsCard>}
      {section === 'appearance' && <AppearanceSettings />}
      {section === 'subtitles' && <SubtitleSettings />}
      {section === 'downloads' && <DownloadSettings />}
      {section === 'accessibility' && <AccessibilitySettings />}
      {section === 'data' && <DataSettings />}
      {section === 'playback' && <PlaybackSettings />}
      {section === 'integrations' && isTauri() && <IntegrationSettings />}
      {section === 'about' && <SettingsCard>
        <SettingRow title="Version"><span className="setting-value">{version}</span></SettingRow>
        {isTauri() && <DesktopUpdates />}
        <Diagnostics />
        <SettingRow title="Report an issue"><a className="settings-action settings-action-default" href="https://github.com/mqt464/Moewatch/issues/new" target="_blank" rel="noreferrer"><ExternalLink size={15} aria-hidden="true" />Open GitHub</a></SettingRow>
      </SettingsCard>}
      {!page && <Link className="settings-inline-link" to="/settings">Back to settings</Link>}
      {error && <SettingsNotice error>{error}</SettingsNotice>}
    </div>
  </div>;
}
