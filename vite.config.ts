import { defineConfig, type PreviewServer, type ViteDevServer } from 'vite';
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
  return { envDir: false as const, server: { watch: { ignored: ['**/artifacts/**', '**/test-results/**', '**/src-tauri/**'] } }, plugins: [react(), { name: 'moewatch-api', configureServer: mount, configurePreviewServer: mount }] };
});

