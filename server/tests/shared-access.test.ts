import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request, createServer } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSharedAccess, primaryLanAddress } from '../shared-access';
import { sharedKey } from '../../shared/storage';

test('shared access requires a link, shares the host session and data, and disconnects on disable', async () => {
 const directory = await mkdtemp(join(tmpdir(), 'moewatch-sharing-'));
 const oldData = process.env.MOEWATCH_DATA_DIR, oldPort = process.env.MOEWATCH_PORT;
 process.env.MOEWATCH_DATA_DIR = directory;
 const reserve = createServer(); await new Promise<void>(r => reserve.listen(0, '127.0.0.1', r));
 const port = (reserve.address() as { port: number }).port;
 await new Promise<void>(r => reserve.close(() => r()));
 process.env.MOEWATCH_PORT = String(port - 1);
 const shared = createSharedAccess((req, res) => { res.end(req.headers.cookie || ''); });
 const local = createServer(shared.handle);
 await new Promise<void>(r => local.listen(0, '127.0.0.1', r));
 const base = `http://127.0.0.1:${(local.address() as { port: number }).port}`;
 const update = (path: string, input: unknown) => fetch(base + path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
 try {
  await shared.ready();
  assert.equal((await (await fetch(base + '/api/v1/shared-access')).json()).enabled, false);
  await fetch(base, { headers: { Cookie: 'moewatch_session=desktop-session' } });
  const background = await (await update('/api/v1/shared-access', { keepRunning: true })).json();
  assert.equal(background.keepRunning, true);
  assert.equal(background.enabled, false);
  assert.equal((await update('/api/v1/shared-access', { keepRunning: 'yes' })).status, 400);
  const enabled = await (await update('/api/v1/shared-access', { enabled: true })).json();
  assert.equal(enabled.keepRunning, true);
  assert.equal(enabled.urls.length, 1);
  const token = new URL(enabled.urls[0]).searchParams.get('access');
  const lan = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(lan)).status, 403);
  for (const asset of ['/manifest.webmanifest', '/apple-touch-icon.png', '/pwa-192.png', '/pwa-512.png', '/favicon.png']) {
   assert.equal((await fetch(lan + asset)).status, 200, `Install asset must load without session cookies: ${asset}`);
  }
  assert.equal((await fetch(lan + '/api/v1/shared-storage')).status, 403);
  assert.equal((await fetch(lan + '/media/private.mp4')).status, 403);
  const entry = await fetch(`${lan}/?access=${token}`, { redirect: 'manual' });
  assert.equal(entry.status, 303);
  assert.match(entry.headers.get('set-cookie')!, /Max-Age=31536000/);
  const launch = entry.headers.get('location')!;
  assert.match(launch, /^\/\?device=[a-f0-9]{64}$/);
  const installed = await fetch(lan + launch);
  assert.equal(installed.status, 200, 'Installed app launches without browser cookies');
  assert.match(installed.headers.get('set-cookie')!, /HttpOnly/);
  const cookie = entry.headers.get('set-cookie')!.split(';')[0];
  assert.equal(await (await fetch(lan, { headers: { Cookie: cookie } })).text(), 'moewatch_session=desktop-session');
  assert.equal((await fetch(lan + '/api/v1/shared-access', { headers: { Cookie: cookie } })).status, 403);
  assert.equal((await update('/api/v1/shared-storage', { key: 'unrelated', value: 'x' })).status, 400);
  assert.equal((await update('/api/v1/shared-storage', null)).status, 400);
  await update('/api/v1/shared-storage', { key: 'moewatch-library-v1', value: '{"progress":{}}' });
  const storage = await (await fetch(lan + '/api/v1/shared-storage', { headers: { Cookie: cookie } })).json();
  assert.equal(storage['moewatch-library-v1'], '{"progress":{}}');
  assert.equal((await fetch(base + '/api/v1/shared-storage', { headers: { Origin: 'http://evil.invalid' } })).status, 403);
  const untrusted = await new Promise<number | undefined>((resolve, reject) => { const req = request(base + '/api/v1/shared-access', { headers: { Host: 'evil.invalid' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); });
  assert.equal(untrusted, 403);
  const connected = await (await fetch(base + '/api/v1/shared-access')).json();
  assert.equal(connected.devices.length, 1);
  assert.equal((await fetch(lan + '/api/v1/shared-access/reset', { method: 'POST', headers: { Cookie: cookie } })).status, 403);
  assert.equal((await fetch(lan + '/api/v1/downloads/location', { method: 'PUT', headers: { Cookie: cookie } })).status, 403);
  await fetch(base + '/api/v1/shared-access/devices/' + connected.devices[0].id, { method: 'DELETE' });
  assert.equal((await fetch(lan + launch)).status, 403);
  assert.equal((await fetch(lan, { headers: { Cookie: cookie } })).status, 403);
  const reentry = await fetch(lan + '/?access=' + token, { redirect: 'manual' });
  const secondCookie = reentry.headers.get('set-cookie')!.split(';')[0];
  const reset = await (await fetch(base + '/api/v1/shared-access/reset', { method: 'POST' })).json();
  assert.equal(reset.devices.length, 0);
  assert.notEqual(new URL(reset.urls[0]).searchParams.get('access'), token);
  assert.equal((await fetch(lan, { headers: { Cookie: secondCookie } })).status, 403);
  assert.equal((await fetch(lan + '/?access=' + token, { redirect: 'manual' })).status, 403);
  await update('/api/v1/shared-access', { enabled: false });
  const saved = JSON.parse(await readFile(join(directory, 'shared-access.json'), 'utf8'));
  assert.equal(saved.enabled, false);
  assert.equal(saved.keepRunning, true);
  await assert.rejects(fetch(lan));
  assert.equal(sharedKey('moewatch-anilist-123-v1'), true);
  assert.equal(sharedKey('moewatch_session'), false);
 } finally {
  shared.close(); local.closeAllConnections(); await new Promise<void>(r => local.close(() => r()));
  if (oldData === undefined) delete process.env.MOEWATCH_DATA_DIR; else process.env.MOEWATCH_DATA_DIR = oldData;
  if (oldPort === undefined) delete process.env.MOEWATCH_PORT; else process.env.MOEWATCH_PORT = oldPort;
  await rm(directory, { recursive: true, force: true });
 }
});


test('primary LAN address prefers physical adapters and uses the outgoing interface', () => {
 const address = (ip: string, internal = false) => ({ address: ip, family: 'IPv4' as const, internal, netmask: '255.255.255.0', mac: '', cidr: null });
 const interfaces = { 'vEthernet (WSL)': [address('172.20.0.1')], Ethernet: [address('192.168.1.8')], 'Wi-Fi': [address('192.168.1.9')], Loopback: [address('127.0.0.1', true)] };
 assert.equal(primaryLanAddress(interfaces, '192.168.1.9'), '192.168.1.9');
 assert.equal(primaryLanAddress(interfaces, '172.20.0.1'), '192.168.1.8');
 assert.equal(primaryLanAddress({ Loopback: interfaces.Loopback }), undefined);
 assert.equal(primaryLanAddress({ Ethernet: [address('169.254.1.2')] }), undefined);
});
