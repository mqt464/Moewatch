// Desktop packaging uses its own asset protocol and update lifecycle.
if (import.meta.env.PROD && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !('__TAURI_INTERNALS__' in window)) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(error => console.warn('Offline support could not start.', error));
  });
}
