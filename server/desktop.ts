import { createSharedAccess } from './shared-access';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createApiHandler } from './app';
const root = resolve(process.env.MOEWATCH_STATIC_DIR || 'dist');
const api = createApiHandler();
const types: Record<string,string> = { '.webmanifest':'application/manifest+json', '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.woff2':'font/woff2' };
const shared = createSharedAccess(async (req,res) => {
 const url = new URL(req.url || '/', 'http://localhost');
 if (url.pathname.startsWith('/api/v1/') || url.pathname.startsWith('/media/')) { await api(req,res); return; }
 try {
  let file = resolve(root, '.' + decodeURIComponent(url.pathname));
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try { if (!(await stat(file)).isFile()) file = resolve(root,'index.html'); } catch { file = resolve(root,'index.html'); }
  let body = await readFile(file);
  if (url.pathname === '/manifest.webmanifest' && url.searchParams.has('device')) {
   const manifest = JSON.parse(body.toString());
   manifest.start_url = '/?device=' + encodeURIComponent(url.searchParams.get('device')!);
   body = Buffer.from(JSON.stringify(manifest));
  }
  res.writeHead(200, { 'Content-Type':types[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options':'nosniff' }); res.end(body);
 } catch { res.writeHead(500).end('Unable to serve Moewatch'); }
});
const server = createServer(shared.handle);
server.on('close', () => { shared.close(); api.close(); });
await shared.ready();
server.listen(Number(process.env.MOEWATCH_PORT || 17846), '127.0.0.1');
