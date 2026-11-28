import { useRef, useState } from 'react';
import { Download, Upload, RotateCcw, Trash2, Copy, Check } from 'lucide-react';
import { useAccount } from '../AccountContext';
import { usePreferences } from '../PreferencesContext';
import { defaultPreferences, readPreferences } from '../preferences';
import { defaultHomeLayout } from '../homeLayout';
import { readLibrary } from '../library';
import { version } from '../../package.json';
import { SettingRow, SettingsButton, SettingsCard, SettingsNotice, SettingsSelect, SettingsToggle } from './controls';

export function AppearanceSettings() {
  const { preferences, update } = usePreferences();
  return <SettingsCard>
    <SettingRow title="Anime titles">{binding => <SettingsSelect {...binding} value={preferences.titleLanguage} onChange={event => update({ titleLanguage: event.target.value })}><option value="english">English</option><option value="romaji">Romaji</option></SettingsSelect>}</SettingRow>
    <SettingRow title="Release years">{binding => <SettingsToggle {...binding} checked={preferences.showYears} onChange={showYears => update({ showYears })} />}</SettingRow>
    <SettingRow title="Reset home layout"><SettingsButton onClick={() => update({ homeLayout: structuredClone(defaultHomeLayout) })}><RotateCcw size={15} aria-hidden="true" />Reset</SettingsButton></SettingRow>
  </SettingsCard>;
}

export function AccessibilitySettings() {
  const { preferences, update } = usePreferences();
  return <>
    <SettingsCard>
      <SettingRow title="Reduced motion">{binding => <SettingsToggle {...binding} checked={preferences.reduceMotion} onChange={reduceMotion => update({ reduceMotion })} />}</SettingRow>
      <SettingRow title="Interface size">{binding => <SettingsSelect {...binding} value={preferences.textSize} onChange={event => update({ textSize: Number(event.target.value) })}><option value={100}>Default</option><option value={112}>Larger</option><option value={125}>Largest</option></SettingsSelect>}</SettingRow>
    </SettingsCard>
    <SettingsCard>{[['Play or pause', 'Space / K'], ['Seek 10 seconds', 'Left / Right'], ['Mute', 'M'], ['Fullscreen', 'F']].map(([title, key]) => <SettingRow key={title} title={title}><kbd className="setting-shortcut">{key}</kbd></SettingRow>)}</SettingsCard>
  </>;
}

export function DataSettings() {
  const { library, restoreLibrary, clearHistory, user } = useAccount();
  const { preferences, update } = usePreferences();
  const input = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  function exportBackup() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, library, preferences }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'moewatch-backup.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importBackup(file: File) {
    setError(''); setNotice('');
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Choose a backup smaller than 10 MB.');
      const raw = JSON.parse(await file.text());
      if (raw?.version !== 1 || !Array.isArray(raw.library?.saved) || !Array.isArray(raw.library?.progress) || !raw.preferences || typeof raw.preferences !== 'object') throw new Error('Choose a Moewatch backup file.');
      const restored = readLibrary(JSON.stringify(raw.library));
      if (restored.saved.length !== raw.library.saved.length || restored.progress.length !== raw.library.progress.length) throw new Error('This backup contains invalid library data.');
      if (!window.confirm('Replace your library and settings, including on shared devices?')) return;
      restoreLibrary(restored); update(readPreferences(JSON.stringify(raw.preferences))); setNotice('Backup restored.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not restore backup.'); }
  }
  return <>
    <SettingsCard>
      <SettingRow title="Back up library and settings"><SettingsButton onClick={exportBackup}><Download size={15} aria-hidden="true" />Export</SettingsButton></SettingRow>
      <SettingRow title="Restore backup" description={user ? 'AniList stays unchanged. Shared devices update too.' : 'Replaces library and settings on shared devices too.'}><SettingsButton onClick={() => input.current?.click()}><Upload size={15} aria-hidden="true" />Import</SettingsButton><input className="sr-only" ref={input} type="file" accept="application/json,.json" aria-label="Backup file" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importBackup(file); }} /></SettingRow>
    </SettingsCard>
    <SettingsCard>
      <SettingRow title="Clear watch history" description="Shared devices update too."><SettingsButton variant="danger" onClick={() => { if (window.confirm('Clear watch history, including on shared devices?')) { clearHistory(); setNotice('Watch history cleared.'); } }}><Trash2 size={15} aria-hidden="true" />Clear</SettingsButton></SettingRow>
      <SettingRow title="Reset settings"><SettingsButton variant="danger" onClick={() => { if (window.confirm('Reset settings to their defaults?')) { update(structuredClone(defaultPreferences)); setNotice('Settings reset.'); } }}><RotateCcw size={15} aria-hidden="true" />Reset</SettingsButton></SettingRow>
    </SettingsCard>
    {notice && <SettingsNotice>{notice}</SettingsNotice>}{error && <SettingsNotice error>{error}</SettingsNotice>}
  </>;
}

export function Diagnostics() {
  const [copied, setCopied] = useState(false), [error, setError] = useState('');
  return <SettingRow title="Diagnostics" description={error || undefined}><SettingsButton onClick={() => { void navigator.clipboard.writeText(`Moewatch ${version}\n${navigator.userAgent}\nOnline: ${navigator.onLine}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => setError('Could not copy diagnostics.')); }}>{copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{copied ? 'Copied' : 'Copy'}</SettingsButton></SettingRow>;
}

export function SubtitleSettings() {
  const { preferences, update } = usePreferences();
  return <SettingsCard>
      <SettingRow title="Subtitles">{binding => <SettingsToggle {...binding} checked={preferences.subtitles} onChange={subtitles => update({ subtitles })} />}</SettingRow>
      <SettingRow title="Text size">{binding => <SettingsSelect {...binding} value={preferences.subtitleSize} onChange={event => update({ subtitleSize: Number(event.target.value) })}>{[75,100,125,150].map(size => <option key={size} value={size}>{size}%</option>)}</SettingsSelect>}</SettingRow>
      <SettingRow title="Background opacity">{binding => <SettingsSelect {...binding} value={preferences.subtitleBackground} onChange={event => update({ subtitleBackground: Number(event.target.value) })}>{[0,50,75,100].map(size => <option key={size} value={size}>{size === 0 ? 'None' : size + '%'}</option>)}</SettingsSelect>}</SettingRow>
      <SettingRow title="Preview" stacked><div className="settings-subtitle-preview"><span style={{ fontSize: preferences.subtitleSize / 100 + 'rem', background: 'rgba(0,0,0,' + preferences.subtitleBackground / 100 + ')' }}>Your next episode awaits.</span></div></SettingRow>
    </SettingsCard>;
}
