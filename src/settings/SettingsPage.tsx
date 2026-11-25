import { isTauri } from '@tauri-apps/api/core';
import { SharedAccess } from './SharedAccess';
import { DesktopUpdates } from './DesktopUpdates';
import { ArrowLeft, Palette, CirclePlay, Info, Network, Plug, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useAccount } from '../AccountContext';
import { usePreferences } from '../PreferencesContext';
import { fetchProviders, providerNames, providerIcons } from '../api';
import { providerIds, type AudioPreference, type ProviderStatus } from '../../shared/api';
import { ScrollArea } from '../ScrollArea';
import { SettingRow, SettingsButton, SettingsCard, SettingsNotice, SettingsSelect, SettingsToggle } from './controls';
import { version } from '../../package.json';
import { DownloadSettings } from '../downloads/DownloadSettings';

const pages = [
  { id: 'account', title: 'Account', icon: UserRound },
  { id: 'appearance', title: 'Appearance', icon: Palette },
  { id: 'playback', title: 'Playback', icon: CirclePlay },
  { id: 'about', title: 'About', icon: Info },
];

function AccountSettings() {
  const { user, configured, loading, error, syncing, lastSynced, signingIn, cancelLogin, login, logout, sync } = useAccount();
  const [params] = useSearchParams();
  return <>
    <SettingsCard>
      <SettingRow title={user ? user.name : 'AniList'} description={user ? undefined : 'Sync your anime list and completed episodes.'}>
        {signingIn ? <SettingsButton onClick={cancelLogin}>Cancel sign-in</SettingsButton> : user ? <SettingsButton disabled={loading} onClick={() => void logout()}>Sign out</SettingsButton> : <SettingsButton variant="primary" disabled={loading || !configured} onClick={login}>{loading ? 'Checking account...' : 'Sign in with AniList'}</SettingsButton>}
      </SettingRow>
      {user && <SettingRow title="Sync AniList" description={lastSynced ? `Last synced ${new Date(lastSynced).toLocaleString()}` : undefined}><SettingsButton disabled={loading || syncing} onClick={() => void sync()}>{syncing ? 'Syncing...' : 'Sync now'}</SettingsButton></SettingRow>}
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
      <SettingRow title="Subtitles">{binding => <SettingsToggle {...binding} checked={preferences.subtitles} onChange={subtitles => update({ subtitles })} />}</SettingRow>
    </SettingsCard>
    <DownloadSettings />
    <section aria-labelledby="provider-status-heading">
      <h2 id="provider-status-heading" className="settings-provider-heading">Provider status</h2>
      <SettingsCard>
      {providerIds.map(id => {
        const provider = providers.find(entry => entry.id === id);
        return <SettingRow key={id} description={provider?.note} title={<span className="settings-provider-name"><img src={providerIcons[id]} alt="" width={20} height={20} />{providerNames[id]}</span>}><span className="setting-value">{loading ? 'Checking...' : error ? 'Unknown' : provider?.configured ? 'Configured' : 'Unavailable'}</span></SettingRow>;
      })}
      </SettingsCard>
      {error && <SettingsNotice error>{error}</SettingsNotice>}
    </section>
  </>;
}

function IntegrationSettings() {
  const { preferences, update } = usePreferences();
  return <SettingsCard>
    <SettingRow title="Discord RPC" description="Show what you’re watching in your Discord activity.">{binding => <SettingsToggle {...binding} checked={preferences.discordRpc} onChange={discordRpc => update({ discordRpc })} />}</SettingRow>
    <SettingRow title="Discord Watch Party" description="Watch together through Discord. Turning this off leaves your current party.">{binding => <SettingsToggle {...binding} checked={preferences.discordWatchParty} onChange={discordWatchParty => update({ discordWatchParty })} />}</SettingRow>
  </SettingsCard>;
}

export function SettingsPage() {
  const { section = 'account' } = useParams();
  const { error } = usePreferences();
  const visiblePages = isTauri() ? [...pages.slice(0, 3), { id: 'integrations', title: 'Integrations', icon: Plug }, { id: 'shared-access', title: 'Shared Access', icon: Network }, ...pages.slice(3)] : pages;
  const page = visiblePages.find(entry => entry.id === section);

  if (section === 'storage') return <Navigate to="/settings" replace />;

  return <div className="settings-layout">
    <aside className="settings-sidebar">
      <Link to="/" className="settings-back"><ArrowLeft aria-hidden="true" size={15} />Discover</Link>
      <ScrollArea className="settings-navigation"><nav aria-label="Settings pages">{visiblePages.map(entry => <NavLink key={entry.id} to={`/settings/${entry.id}`} className={entry.id === section ? 'active' : undefined} aria-current={entry.id === section ? 'page' : undefined} end><entry.icon aria-hidden="true" size={16} />{entry.title}</NavLink>)}</nav></ScrollArea>
    </aside>
    <div className="settings-content">
      <header className="settings-page-heading"><h1>{page?.title || 'Page not found'}</h1></header>
      {section === 'shared-access' && isTauri() && <SharedAccess />}
      {section === 'account' && <AccountSettings />}
      {section === 'appearance' && <SettingsCard><SettingRow title="Homepage" description="Reorder rows, choose card styles, and show or hide sections."><Link className="settings-action settings-action-default" to="/" state={{ editHome: true }}>Customize home</Link></SettingRow></SettingsCard>}
      {section === 'playback' && <PlaybackSettings />}
      {section === 'integrations' && isTauri() && <IntegrationSettings />}
      {section === 'about' && <SettingsCard>
        <SettingRow title="Version"><span className="setting-value">{version}</span></SettingRow>
        <DesktopUpdates />
      </SettingsCard>}
      {!page && <Link className="settings-inline-link" to="/settings">Back to settings</Link>}
      {error && <SettingsNotice error>{error}</SettingsNotice>}
    </div>
  </div>;
}
