import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

let server: Server;
let origin: string;
test.beforeAll(async () => {
 server = createServer(async (request, response) => {
  const path = new URL(request.url!, 'http://localhost').pathname;
  if (path.startsWith('/api/') || path.startsWith('/media/')) { response.writeHead(503).end(); return; }
  try {
   const file = resolve('dist', '.' + (path === '/' ? '/index.html' : path));
   const content = await readFile(file).catch(() => readFile('dist/index.html'));
   const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
   response.setHeader('Content-Type', types[extname(path)] || 'text/html');
   response.end(content);
  } catch { response.writeHead(500).end(); }
 });
 await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
 origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { await new Promise<void>(done => server.close(() => done())); });

test('production PWA installs icons and reloads offline without caching API or media', async ({ page, context }) => {
 await page.goto(origin);
 const manifest = await page.evaluate(async () => (await fetch('/manifest.webmanifest')).json());
 expect(manifest.display).toBe('standalone');
 for (const icon of manifest.icons) {
  const dimensions = await page.evaluate(async (src) => {
   const image = new Image(); image.src = src; await image.decode();
   return `${image.naturalWidth}x${image.naturalHeight}`;
  }, icon.src);
  expect(dimensions).toBe(icon.sizes);
 }
 await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png');
 await page.evaluate(async () => { await navigator.serviceWorker.ready; });
 await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
 const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname)))).flat());
 expect(cached).toContain('/index.html');
 expect(cached.some(path => path.startsWith('/api/') || path.startsWith('/media/'))).toBe(false);
 await context.setOffline(true);
 await page.goto(origin + '/list');
 await expect(page.getByRole('heading', { name: 'My List', exact: true })).toBeVisible();
 await context.setOffline(false);
});
