import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const directory = await mkdtemp(join(tmpdir(), 'moewatch-smoke-'));
const base = `http://127.0.0.1:${port}`;
const child = spawn('src-tauri/binaries/moewatch-server-x86_64-pc-windows-msvc.exe', [], {env:{...process.env,MOEWATCH_PORT:String(port),MOEWATCH_DATA_DIR:directory,MOEWATCH_STATIC_DIR:'dist'},stdio:'inherit'});
const exited = once(child, 'exit');
try {
 let response;
 for(let i=0;i<80;i++) { try { response = await fetch(base + '/'); break; } catch { await new Promise(r=>setTimeout(r,100)); } }
 assert.equal(response?.status,200); assert.match(await response.text(), /Moewatch/);
 const account = await fetch(base + '/api/v1/account'); assert.equal(account.status,200); assert.equal((await account.json()).configured,true);
 const route = await fetch(base + '/settings/about'); assert.equal(route.status,200);
 console.log('Desktop sidecar smoke test passed');
} finally { child.kill(); await exited; await rm(directory, { recursive: true, force: true }); }
