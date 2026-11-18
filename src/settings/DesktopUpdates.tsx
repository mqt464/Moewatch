import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { SettingRow, SettingsButton } from './controls';
let pending: Update | null = null;
let checking: Promise<Update | null> | undefined;
let message = '';
export function checkDesktopUpdates() {
 if (!isTauri()) return Promise.resolve(null);
 if (!checking) checking = check().then(update => { pending = update; message = update ? 'Version ' + update.version + ' is available.' : 'You are up to date.'; return update; }).catch(error => { message = 'Could not check for updates. Try again.'; throw error; }).finally(() => { checking = undefined; });
 return checking;
}
export function DesktopUpdates() {
 const [status, setStatus] = useState(message);
 const [busy, setBusy] = useState(false);
 const [available, setAvailable] = useState(Boolean(pending));
 useEffect(() => { if (isTauri()) void (checking || Promise.resolve(pending)).finally(() => { setStatus(message); setAvailable(Boolean(pending)); }).catch(() => {}); }, []);
 async function action() {
  setBusy(true);
  try {
   if (pending) {
    setStatus('Downloading update...');
    await pending.downloadAndInstall(event => { if (event.event === 'Finished') setStatus('Installing update...'); });
    await relaunch();
   } else { setStatus('Checking for updates...'); await checkDesktopUpdates(); setStatus(message); setAvailable(Boolean(pending)); }
  } catch { setStatus('Update failed. Try again.'); }
  finally { setBusy(false); }
 }
 return <SettingRow title="Updates" description={isTauri() ? status || 'Checks automatically. You choose when to install.' : 'Desktop updates are available in the Moewatch desktop app.'}><SettingsButton disabled={!isTauri() || busy} onClick={() => void action()}>{busy ? 'Please wait...' : available ? 'Install update' : 'Check for updates'}</SettingsButton></SettingRow>;
}
