import { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { apiRequest } from '../api';
import { usePreferences } from '../PreferencesContext';
import { SettingRow, SettingsButton, SettingsCard, SettingsInput, SettingsNotice, SettingsSelect } from '../settings/controls';
import { formatBytes, useDownloads } from './DownloadsContext';
import type { DownloadQuality } from '../../shared/downloads';

export function DownloadSettings() {
  const { data, error, refresh } = useDownloads();
  const { preferences, update } = usePreferences();
  const [editing, setEditing] = useState(false), [location, setLocation] = useState(''), [busy, setBusy] = useState(false), [failure, setFailure] = useState('');
  useEffect(() => { if (!editing) setLocation(data?.location || ''); }, [data?.location, editing]);
  async function change(picker = false) {
    setBusy(true); setFailure('');
    try {
      if (picker) {
        const response = await fetch('/api/v1/downloads/pick-folder', { method: 'POST' });
        if (!response.ok) { const body = await response.json(); throw new Error(body.error?.message || 'Could not select folder.'); }
      } else await apiRequest('/downloads/location', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location }) });
      await refresh(); setEditing(false);
    } catch (error) { setFailure(error instanceof Error ? error.message : 'Could not change folder.'); if (picker) setEditing(true); }
    finally { setBusy(false); }
  }
  const storage = data?.storage;
  const total = storage?.total || 0;
  return <section className="download-settings" aria-labelledby="downloads-settings-heading"><h2 id="downloads-settings-heading" className="settings-provider-heading">Downloads</h2>
    <SettingsCard>
      <SettingRow title="Local storage" stacked>
        <div className="download-storage"><div className="download-storage-summary"><span>{formatBytes(total)} used by downloads</span><span>{storage?.capacity ? `${formatBytes(storage.free)} available` : ''}</span></div>
          <div className="download-storage-bar" role="img" aria-label={`Downloads use ${formatBytes(total)}. Video ${formatBytes(storage?.video || 0)}, artwork ${formatBytes(storage?.artwork || 0)}, subtitles ${formatBytes(storage?.subtitles || 0)}.`}>{(['video', 'artwork', 'subtitles'] as const).map(category => <span key={category} className={`storage-${category}`} style={{ width: `${total ? (storage?.[category] || 0) / total * 100 : 0}%` }} />)}</div>
          <div className="download-storage-legend">{(['video', 'artwork', 'subtitles'] as const).map(category => <span key={category}><i className={`storage-${category}`} />{category === 'video' ? 'Video' : category === 'artwork' ? 'Artwork' : 'Subtitles'} <span>{formatBytes(storage?.[category] || 0)}</span></span>)}</div>
        </div>
      </SettingRow>
      <SettingRow title="Download quality" description="downloads closest matching quality">{binding => <SettingsSelect {...binding} value={preferences.downloadQuality} onChange={event => update({ downloadQuality: Number(event.target.value) as DownloadQuality })}><option value={480}>480p</option><option value={720}>720p</option><option value={1080}>1080p</option></SettingsSelect>}</SettingRow>
      <SettingRow title="Download location" description={data?.location || 'Loading...'}>
        <div className="download-location"><SettingsButton disabled={busy || !data} onClick={() => data?.canPickFolder ? void change(true) : setEditing(true)}><FolderOpen size={14} aria-hidden="true" />{busy ? 'Selecting...' : 'Change folder'}</SettingsButton></div>
      </SettingRow>
      {editing && <SettingRow title="Host folder" stacked>{binding => <form className="download-folder-form" onSubmit={event => { event.preventDefault(); void change(); }}><SettingsInput {...binding} value={location} onChange={event => setLocation(event.target.value)} required /><SettingsButton type="submit" disabled={busy}>Save</SettingsButton><SettingsButton onClick={() => setEditing(false)}>Cancel</SettingsButton></form>}</SettingRow>}

    </SettingsCard>
    {(failure || error) && <SettingsNotice error>{failure || error}</SettingsNotice>}
  </section>;
}
