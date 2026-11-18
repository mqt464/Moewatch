import { sharedKey } from '../shared/storage';
export async function connectSharedStorage() {
 const response = await fetch('/api/v1/shared-storage', { signal: AbortSignal.timeout(3000) });
 if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return;
 const initial: Record<string, string> = await response.json();
 const original = Storage.prototype.setItem;
 let queue = Promise.resolve();
 const pending = new Map<string, string>();
 const put = (key: string, value: string) => {
  pending.set(key, value);
  queue = queue.then(async () => {
   const response = await fetch('/api/v1/shared-storage', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value }) });
   if (!response.ok) throw new Error('Shared data could not be saved');
   if (pending.get(key) === value) pending.delete(key);
  }).catch(() => { /* Retry unsaved changes when the host reconnects. */ });
 };
 for (const [key, value] of Object.entries(initial)) if (sharedKey(key)) original.call(localStorage, key, value);
 // Import existing desktop data once, without replacing the host with a new device's data.
 if (location.hostname === '127.0.0.1') for (const key of Object.keys(localStorage)) if (sharedKey(key) && !(key in initial)) put(key, localStorage.getItem(key)!);
 Storage.prototype.setItem = function(key, value) { const previous = this.getItem(key); original.call(this, key, value); if (this === localStorage && sharedKey(key) && previous !== value) put(key, value); };
 window.setInterval(async () => {
  try {
   await queue;
   if (pending.size) { for (const [key, value] of pending) put(key, value); return; }
   const response = await fetch('/api/v1/shared-storage');
   if (!response.ok) return;
   const values: Record<string, string> = await response.json();
   for (const [key, value] of Object.entries(values)) if (sharedKey(key) && !pending.has(key) && localStorage.getItem(key) !== value) {
    const oldValue = localStorage.getItem(key); original.call(localStorage, key, value);
    window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue: value, storageArea: localStorage }));
   }
  } catch { /* Keep offline playback usable when the host disconnects. */ }
 }, 3000);
}
