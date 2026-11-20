import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(async () => {
  const { createApiHandler } = await import('./server/app');
  const mount = (server: ViteDevServer | PreviewServer) => {
    const handler = createApiHandler();
    server.httpServer?.once('close', () => handler.close());
    server.middlewares.use((request, response, next) => {
      const path = request.url?.split('?')[0] ?? '';
      if (path.startsWith('/api/v1/') || path.startsWith('/media/')) void handler(request, response);
      else next();
    });
  };
  return { envDir: false as const, server: { watch: { ignored: ['**/artifacts/**', '**/test-results/**', '**/src-tauri/**', '**/*.bun-build'] } }, plugins: [react(), {
    name: 'moewatch-pwa',
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle).filter(path => /\.(js|css)$/.test(path)).map(path => '/' + path);
      const version = assets.join('|') + JSON.stringify(bundle['index.html']);
      const cache = 'moewatch-shell-' + Array.from(version).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 0);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: `
const CACHE = ${JSON.stringify(cache)};
const SHELL = ${JSON.stringify(['/', '/index.html', '/manifest.webmanifest', '/apple-touch-icon.png', '/pwa-192.png', '/pwa-512.png', '/favicon.png', ...assets])};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('moewatch-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/index.html')));
  } else if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
  }
});
` });
    },
  } satisfies Plugin, { name: 'moewatch-api', configureServer: mount, configurePreviewServer: mount }] };
});

