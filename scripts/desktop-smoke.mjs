import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const child = spawn('src-tauri/binaries/moewatch-server-x86_64-pc-windows-msvc.exe', [], {env:{...process.env,MOEWATCH_PORT:'17847',MOEWATCH_STATIC_DIR:'dist'},stdio:'inherit'});
try {
 let response;
 for(let i=0;i<80;i++) { try { response = await fetch('http://127.0.0.1:17847/'); break; } catch { await new Promise(r=>setTimeout(r,100)); } }
 assert.equal(response?.status,200); assert.match(await response.text(), /Moewatch/);
 const account = await fetch('http://127.0.0.1:17847/api/v1/account'); assert.equal(account.status,200); assert.equal((await account.json()).configured,true);
 const route = await fetch('http://127.0.0.1:17847/settings/about'); assert.equal(route.status,200);
 console.log('Desktop sidecar smoke test passed');
} finally { child.kill(); }
