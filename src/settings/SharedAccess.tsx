import { useEffect, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { apiRequest } from '../api';
import { SettingRow, SettingsCard, SettingsNotice, SettingsToggle } from './controls';
type Status = { enabled: boolean; keepRunning: boolean; urls: string[] };
export function SharedAccess() {
 const [status, setStatus] = useState<Status | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
 useEffect(() => { apiRequest<Status>('/shared-access').then(setStatus).catch(e => setError(e.message)); }, []);
 async function update(patch: Partial<Pick<Status, 'enabled' | 'keepRunning'>>) {
  setBusy(true); setError('');
  try { setStatus(await apiRequest<Status>('/shared-access', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })); }
  catch (e) { setError(e instanceof Error ? e.message : 'Could not change LAN server.'); }
  finally { setBusy(false); }
 }
 const url = status?.urls[0];
 return <><SettingsCard>
  <SettingRow title="LAN server" description="Use moewatch on other devices">{binding => <SettingsToggle {...binding} checked={status?.enabled || false} disabled={!status || busy} onChange={enabled => void update({ enabled })} />}</SettingRow>
  <SettingRow title="Keep running while closed">{binding => <SettingsToggle {...binding} checked={status?.keepRunning || false} disabled={!status || busy} onChange={keepRunning => void update({ keepRunning })} />}</SettingRow>
  {status?.enabled && <SettingRow title="LAN address">{url ? <a className="settings-inline-link" href={url} onClick={event => { event.preventDefault(); void openUrl(url).catch(e => setError(String(e))); }}>{new URL(url).origin}</a> : <span className="setting-value">No network connection</span>}</SettingRow>}
 </SettingsCard>{error && <SettingsNotice error>{error}</SettingsNotice>}</>;
}
