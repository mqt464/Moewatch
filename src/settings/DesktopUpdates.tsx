import { useSyncExternalStore } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { SettingRow, SettingsButton } from './controls';
let pending: Update | null = null;
let checking: Promise<Update | null> | undefined;
let message = '';
let busy = false;
const listeners = new Set<() => void>();
let snapshot = { available: false, status: message, busy };
function publish() {
 snapshot = { available: Boolean(pending), status: message, busy };
 listeners.forEach(listener => listener());
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useDesktopUpdates() {
 return useSyncExternalStore(subscribe, () => snapshot);
}
export function checkDesktopUpdates() {
 if (!isTauri()) return Promise.resolve(null);
 if (!checking) checking = check().then(update => { pending = update; message = update ? 'Version ' + update.version + ' is available.' : 'You are up to date.'; return update; }).catch(error => { message = 'Could not check for updates. Try again.'; throw error; }).finally(() => { checking = undefined; publish(); });
 return checking;
}
export async function installDesktopUpdate() {
 if (!pending || busy) return;
 busy = true;
 message = 'Downloading update...';
 publish();
  try {
    await pending.downloadAndInstall(event => { if (event.event === 'Finished') { message = 'Installing update...'; publish(); } });
    await relaunch();
  } catch { message = 'Update failed. Try again.'; }
  finally { busy = false; publish(); }
}
export function DesktopUpdates() {
 const { status, available, busy: isBusy } = useDesktopUpdates();
 async function action() {
  if (pending) return installDesktopUpdate();
  if (busy) return;
  busy = true;
  message = 'Checking for updates...';
  publish();
  try { await checkDesktopUpdates(); }
  catch { /* The check publishes its error message. */ }
  finally { busy = false; publish(); }
 }
 return <SettingRow title="Updates" description={isTauri() ? status || 'Checks automatically. You choose when to install.' : 'Desktop updates are available in the Moewatch desktop app.'}><SettingsButton disabled={!isTauri() || isBusy} onClick={() => void action()}>{isBusy ? 'Please wait...' : available ? 'Install update' : 'Check for updates'}</SettingsButton></SettingRow>;
}
