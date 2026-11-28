import { Copy, Check, Monitor, RotateCcw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { apiRequest } from '../api';
import { SettingRow, SettingsButton, SettingsCard, SettingsNotice, SettingsToggle } from './controls';
type Status = { enabled: boolean; keepRunning: boolean; urls: string[]; devices: { id: string; name: string; connected: number }[] };
export function SharedAccess() {
 const [status, setStatus] = useState<Status | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
 useEffect(() => { const refresh = () => apiRequest<Status>('/shared-access').then(setStatus).catch(e => setError(e.message)); void refresh(); const timer = window.setInterval(() => void refresh(), 10000); return () => window.clearInterval(timer); }, []);
 async function update(patch: Partial<Pick<Status, 'enabled' | 'keepRunning'>>) {
  setBusy(true); setError('');
  try { setStatus(await apiRequest<Status>('/shared-access', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })); }
  catch (e) { setError(e instanceof Error ? e.message : 'Could not change LAN server.'); }
  finally { setBusy(false); }
 }
 async function manage(path: string, method: string) {
  setBusy(true); setError('');
  try { setStatus(await apiRequest<Status>(path, { method })); }
  catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not update sharing.'); }
  finally { setBusy(false); }
 }
 const url = status?.urls[0];
 const [copied, setCopied] = useState(false);
 async function copyLink() {
  if (!url) return;
  setError('');
  try { await navigator.clipboard.writeText(url); setCopied(true); }
  catch { setError('Could not copy the link. Right-click the address and copy the link instead.'); }
 }
 useEffect(() => { if (!copied) return; const timer = window.setTimeout(() => setCopied(false), 2000); return () => window.clearTimeout(timer); }, [copied]);
 return <><SettingsCard>
  <SettingRow title="Share on local network">{binding => <SettingsToggle {...binding} checked={status?.enabled || false} disabled={!status || busy} onChange={enabled => void update({ enabled })} />}</SettingRow>
  <SettingRow title="Keep sharing when closed">{binding => <SettingsToggle {...binding} checked={status?.keepRunning || false} disabled={!status || busy} onChange={keepRunning => void update({ keepRunning })} />}</SettingRow>
  {status?.enabled && <SettingRow title="Connect a device" description="Use the same Wi-Fi network.">{url ? <div className="settings-sharing-link"><a className="settings-inline-link" href={url} onClick={event => { event.preventDefault(); void openUrl(url).catch(e => setError(String(e))); }}>{new URL(url).host}</a><SettingsButton onClick={() => void copyLink()}>{copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{copied ? 'Copied' : 'Copy link'}</SettingsButton></div> : <span className="setting-value">No network connection</span>}</SettingRow>}
 </SettingsCard>
 {status?.enabled && <SettingsCard>
 {(status.devices || []).map(device => <SettingRow key={device.id} title={<span className="settings-device"><Monitor size={18} aria-hidden="true" />{device.name}</span>}><SettingsButton variant="danger" aria-label={'Disconnect ' + device.name} disabled={busy} onClick={() => void manage('/shared-access/devices/' + device.id, 'DELETE')}><X size={15} aria-hidden="true" />Disconnect</SettingsButton></SettingRow>)}
 <SettingRow title="Reset sharing link" description="Disconnects all devices and replaces the link."><SettingsButton variant="danger" disabled={busy} onClick={() => { if (window.confirm('Disconnect all devices and replace the sharing link?')) void manage('/shared-access/reset', 'POST'); }}><RotateCcw size={15} aria-hidden="true" />Reset</SettingsButton></SettingRow>
 </SettingsCard>}
 {error && <SettingsNotice error>{error}</SettingsNotice>}</>;
}
