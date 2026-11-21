import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { createSocket } from 'node:dgram';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { sharedKey } from '../shared/storage';
export function primaryLanAddress(interfaces: ReturnType<typeof networkInterfaces>, preferred?: string): string | undefined {
 const candidates = Object.entries(interfaces).flatMap(([name, entries]) => (entries || []).filter(entry => entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')).map(entry => ({ name, address: entry.address })));
 const score = (entry: { name: string; address: string }) => (/virtual|vethernet|vmware|vbox|docker|vpn|tailscale|tunnel|loopback|wsl/i.test(entry.name) ? 0 : 4) + (entry.address === preferred ? 2 : 0);
 return candidates.sort((a, b) => score(b) - score(a))[0]?.address;
}

// UDP connect asks the OS for its outgoing interface without sending a packet.
async function outgoingAddress(): Promise<string | undefined> {
 const socket = createSocket('udp4');
 try { return await new Promise<string | undefined>(resolve => { socket.once('error', () => resolve(undefined)); socket.connect(53, '1.1.1.1', () => resolve(socket.address().address)); }); }
 finally { socket.close(); }
}

export function createSharedAccess(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>) {
 const file = resolve(process.env.MOEWATCH_DATA_DIR || '.moewatch', 'shared-access.json');
 let state: { enabled: boolean; keepRunning: boolean; token: string; session: string; storage: Record<string, string> } = { enabled: false, keepRunning: false, token: randomBytes(32).toString('hex'), session: '', storage: {} };
 try { state = { ...state, ...JSON.parse(readFileSync(file, 'utf8')) }; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
 const save = () => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file + '.tmp', JSON.stringify(state), { mode: 0o600 }); renameSync(file + '.tmp', file); };
 const port = Number(process.env.MOEWATCH_PORT || 17846) + 1;
 const status = async () => { const address = primaryLanAddress(networkInterfaces(), await outgoingAddress()); return { enabled: state.enabled, keepRunning: state.keepRunning, urls: address ? [`http://${address}:${port}/?access=${state.token}`] : [] }; };
 const json = (res: ServerResponse, code: number, body: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
 async function body(req: IncomingMessage) { let text = ''; for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('Request too large'); } return JSON.parse(text); }
 const lan = createServer(async (req, res) => {
  if (!state.enabled) { res.writeHead(403).end(); return; }
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.searchParams.get('access') === state.token) { res.writeHead(303, { Location: '/', 'Set-Cookie': `moewatch_access=${state.token}; Path=/; HttpOnly; SameSite=Lax`, 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' }); res.end(); return; }
  // Home-screen installers fetch public branding without the browser's session cookie.
  if ((req.method === 'GET' || req.method === 'HEAD') && ['/manifest.webmanifest', '/apple-touch-icon.png', '/pwa-192.png', '/pwa-512.png', '/favicon.png'].includes(url.pathname)) { await handler(req, res); return; }
  const authorized = req.headers.cookie?.split(';').some(c => c.trim() === `moewatch_access=${state.token}`);
  if (!authorized) { res.writeHead(403).end('Open the link from Shared Access on the desktop app.'); return; }
  req.headers.cookie = `moewatch_session=${state.session}`;
  await handle(req, res, false);
 });
 const start = () => new Promise<void>((resolve, reject) => { lan.once('error', reject); lan.listen(port, '0.0.0.0', () => { lan.removeListener('error', reject); resolve(); }); });
 async function handle(req: IncomingMessage, res: ServerResponse, local: boolean) {
  try {
   const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
   if (local && !['127.0.0.1', 'localhost'].includes(url.hostname)) { res.writeHead(403).end(); return; }
   if (!local && /^\/api\/v1\/account\/(login|logout|callback)/.test(url.pathname)) return json(res, 403, { error: { message: 'Manage the shared account in the desktop app.' } });
   const landingNavigation = !local && req.method === 'GET' && url.pathname === '/' && req.headers['sec-fetch-mode'] === 'navigate';
   if (req.headers.origin && req.headers.origin !== url.origin || req.headers['sec-fetch-site'] === 'cross-site' && !landingNavigation) { res.writeHead(403).end(); return; }
   if (local) {
    const session = req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith('moewatch_session='))?.slice(17);
    if (session && session !== state.session) { state.session = session; save(); }
    const original = res.setHeader.bind(res);
    res.setHeader = ((name: string, value: any) => { if (name.toLowerCase() === 'set-cookie') for (const cookie of Array.isArray(value) ? value : [value]) { const match = /^moewatch_session=([^;]*)/.exec(String(cookie)); if (match) { state.session = match[1]; save(); } } return original(name, value); }) as typeof res.setHeader;
   }
   if (url.pathname === '/api/v1/shared-access') {
    if (!local) return json(res, 403, {});
    if (req.method === 'PUT') {
     const input = await body(req);
     if (!input || typeof input !== 'object' || !['enabled', 'keepRunning'].some(key => key in input) || Object.entries(input).some(([key, value]) => !['enabled', 'keepRunning'].includes(key) || typeof value !== 'boolean')) return json(res, 400, {});
     if (input.enabled === true && !lan.listening) await start();
     const previous = { ...state };
     if (typeof input.enabled === 'boolean') state.enabled = input.enabled;
     if (typeof input.keepRunning === 'boolean') state.keepRunning = input.keepRunning;
     try { save(); } catch (error) { state = previous; if (!state.enabled) { lan.close(); lan.closeAllConnections(); } throw error; }
     if (!state.enabled) { lan.close(); lan.closeAllConnections(); }
    }
    return json(res, 200, await status());
   }
   if (url.pathname === '/api/v1/shared-storage') {
    if (req.method === 'PUT') {
     const input = await body(req);
     if (!input || typeof input.key !== 'string' || !sharedKey(input.key) || typeof input.value !== 'string') return json(res, 400, {});
     const previous = state.storage[input.key];
     state.storage[input.key] = input.value;
     try { save(); } catch (error) { if (previous === undefined) delete state.storage[input.key]; else state.storage[input.key] = previous; throw error; }
    }
    return json(res, 200, state.storage);
   }
   await handler(req, res);
  } catch (error) { if (!res.headersSent) json(res, 500, { error: { message: error instanceof Error ? error.message : 'Shared access failed' } }); else res.destroy(); }
 }
 return { handle: (req: IncomingMessage, res: ServerResponse) => handle(req, res, true), ready: async () => { if (state.enabled) { try { await start(); } catch { state.enabled = false; save(); } } }, close: () => { lan.close(); lan.closeAllConnections(); } };
}
