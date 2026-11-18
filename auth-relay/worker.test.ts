import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { runInNewContext } from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import worker, { digest, SigninCoordinator, type Env, type Storage } from './worker';

const origin = 'https://relay.example';
const accessToken = 'private-token-with-enough-length';
const verifier = () => 'v'.repeat(43);
async function fixture() {
  const db = new DatabaseSync(':memory:'); let alarm = 0; let ready: Promise<unknown> = Promise.resolve(); let calls = 0; let exchanges = 0; let turnstile: Record<string, unknown> = { success: true, hostname: 'relay.example', action: 'login' }; let release: (() => void) | undefined; let wait: Promise<void> | undefined;
  const storage: Storage = { sql: { exec<T>(query: string, ...values: (string | number | null)[]) { const rows = db.prepare(query).all(...values) as T[]; return Object.assign(rows, { toArray: () => rows }); } }, async setAlarm(time) { alarm = time; } };
  const env: Env = { RELAY_PUBLIC_ORIGIN: origin, ANILIST_CLIENT_ID: 'client', TURNSTILE_SITE_KEY: 'site-key', TURNSTILE_SECRET_KEY: 'turnstile-secret', SIGNIN: { idFromName(name) { assert.equal(name, 'coordinator-v2'); return name; }, get() { calls++; return { fetch(request) { return coordinator.fetch(request); } }; } } };
  const coordinator = new SigninCoordinator({ storage, blockConcurrencyWhile(callback) { const promise = callback(); ready = promise; return promise; } }, env); await ready;
  const fetchMock = mock.method(globalThis, 'fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.redirect, 'manual', 'Workers require manual redirects; reject upstream redirects via response.ok');
    if (String(url) === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') { assert.equal((init?.body as URLSearchParams).get('secret'), 'turnstile-secret'); return Response.json(turnstile); }
    exchanges++; throw new Error('Worker must never request AniList');
  });
  const request = (path: string, init: RequestInit = {}, ip = '192.0.2.1') => worker.fetch(new Request(`${origin}${path}`, { ...init, headers: { 'cf-connecting-ip': ip, ...init.headers } }), env);
  const post = (path: string, body: unknown, ip?: string) => request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, ip);
  const start = async (ip?: string) => { const response = await post('/v1/login', { challenge: await digest(verifier()) }, ip); assert.equal(response.status, 201); return await response.json() as { id: string; authorizeUrl: string; expiresAt: number; interval: number }; };
  const authorize = async (id: string) => { const response = await request('/authorize', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'null', 'sec-fetch-site': 'same-origin' }, body: new URLSearchParams({ id, 'cf-turnstile-response': 'proof' }) }); assert.equal(response.status, 302); assert.equal(new URL(response.headers.get('location')!).searchParams.get('response_type'), 'token'); assert.equal(new URL(response.headers.get('location')!).searchParams.has('redirect_uri'), false, 'implicit authorization uses the AniList dashboard callback'); return { state: new URL(response.headers.get('location')!).searchParams.get('state')!, cookie: response.headers.get('set-cookie')!.split(';')[0] }; };
  const complete = (auth: {state:string;cookie:string}, value: Record<string, unknown> = {}) => request('/anilist/callback', { method: 'POST', headers: { 'content-type': 'application/json', origin, cookie: auth.cookie }, body: JSON.stringify({state:auth.state,accessToken,expiresIn:3600,...value}) });
  return { complete, db, storage, coordinator, env, request, post, start, authorize, calls: () => calls, exchanges: () => exchanges, alarm: () => alarm, turnstile: (value: Record<string, unknown>) => { turnstile = value; }, holdExchange() { wait = new Promise<void>(resolve => { release = resolve; }); }, releaseExchange() { release?.(); }, close() { fetchMock.mock.restore(); db.close(); } };
}

test('Worker hosted check validates Turnstile, browser cookie and one-use callback and claims', async () => {
  const relay = await fixture();
  try {
    const login = await relay.start(); assert.equal(login.interval, 3);
    const page = await relay.request(`/authorize?id=${login.id}`); const text = await page.text();
    assert.ok(text.includes('data-callback="moewatchTurnstileComplete"')); assert.ok(!text.includes('private-secret'));
    relay.turnstile({ success: true, hostname: 'evil.example', action: 'login' });
    const deniedCheck = await relay.request('/authorize', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ id: login.id, 'cf-turnstile-response': 'proof' }) }); assert.equal(deniedCheck.status, 403);
    relay.turnstile({ success: true, hostname: 'relay.example', action: 'login' });
    const auth = await relay.authorize(login.id); assert.ok(auth.cookie.includes('moewatch_relay_'));
    const pageCallback = await relay.request('/anilist/callback', { headers: { origin: 'https://anilist.co' } }); assert.equal(pageCallback.status, 200);
    assert.equal((await relay.complete({...auth,cookie:''})).status, 403);
    assert.equal((await relay.complete({...auth,cookie:auth.cookie+'spoof'})).status, 403);
    const success = await relay.complete(auth); assert.equal(success.status, 200); assert.equal(success.headers.get('cache-control'), 'no-store'); assert.ok(!(await success.text()).includes(accessToken));
    assert.equal((await relay.complete(auth)).status, 400); assert.equal(relay.exchanges(), 0);
    const path = `/v1/login/${login.id}/claim`;
    assert.equal((await relay.post(path, { verifier: 'x'.repeat(43) })).status, 403);
    const results = await Promise.all([relay.post(path, { verifier: verifier() }), relay.post(path, { verifier: verifier() })]);
    assert.deepEqual(results.map(response => response.status).sort(), [200, 404]);
    const result = await results.find(response => response.status === 200)!.json(); assert.equal(result.accessToken, accessToken); assert.equal(result.status, 'complete');
    assert.equal((relay.db.prepare('SELECT COUNT(*) AS count FROM logins').get() as { count: number }).count, 0);
  } finally { relay.close(); }
});

test('Worker pending claims throttle, denial consumes claim, alarm deletes expired rows', async () => {
  const relay = await fixture(); let time = Date.now(); const clock = mock.method(Date, 'now', () => time);
  try {
    const login = await relay.start(); const path = `/v1/login/${login.id}/claim`;
    assert.deepEqual(await (await relay.post(path, { verifier: verifier() })).json(), { status: 'pending' });
    assert.equal((await relay.post(path, { verifier: verifier() })).status, 429);
    time += 3001; assert.equal((await relay.post(path, { verifier: verifier() })).status, 200);
    const auth = await relay.authorize(login.id);
    assert.equal((await relay.complete(auth,{error:'access_denied',accessToken:null})).status, 200);
    assert.deepEqual(await (await relay.post(path, { verifier: verifier() })).json(), { status: 'denied' });
    const expired = await relay.start(); assert.ok(relay.alarm() > time); time += 600001; await relay.coordinator.alarm();
    assert.equal((await relay.post(`/v1/login/${expired.id}/claim`, { verifier: verifier() })).status, 404);
    assert.equal((relay.db.prepare('SELECT COUNT(*) AS count FROM logins').get() as { count: number }).count, 0);
  } finally { clock.mock.restore(); relay.close(); }
});

test('concurrent callback completions accept one token and JWT expiry fallback clamps lifetime', async () => {
  const relay = await fixture();
  try {
    const login = await relay.start(); const auth = await relay.authorize(login.id);
    const token = 'header.' + Buffer.from(JSON.stringify({exp: Math.floor(Date.now()/1000)+7200})).toString('base64url') + '.signature';
    const results = await Promise.all([relay.complete(auth,{accessToken:token,expiresIn:null}),relay.complete(auth,{accessToken:'other-token-enough-length'})]);
    assert.deepEqual(results.map(response=>response.status).sort(),[200,400]);
    const result = await (await relay.post(`/v1/login/${login.id}/claim`,{verifier:verifier()})).json(); assert.equal(result.accessToken,token); assert.ok(result.expiresAt>Date.now()+7000000); assert.equal(relay.exchanges(),0);
  } finally { relay.close(); }
});

test('Worker edge rejects junk before storage and enforces body, origin, and global start budgets', async () => {
  const relay = await fixture();
  try {
    assert.equal((await relay.request('/junk')).status, 404); assert.equal(relay.calls(), 0);
    assert.equal((await relay.request('/v1/login', { method: 'POST', headers: { origin: 'https://evil.example' } })).status, 403); assert.equal(relay.calls(), 0);
    assert.equal((await relay.request('/authorize', { method: 'POST', headers: { origin: 'null', 'sec-fetch-site': 'cross-site' } })).status, 403); assert.equal(relay.calls(), 0);
    assert.equal((await relay.post('/v1/login', { challenge: 'x'.repeat(3000) })).status, 413);
    assert.equal((await relay.post('/v1/login', { challenge: 'bad' })).status, 400);
    for (let i = 0; i < 98; i++) await relay.start(`192.0.2.${i + 2}`);
    const full = await relay.post('/v1/login', { challenge: await digest(verifier()) }, '198.51.100.1'); assert.equal(full.status, 429);
    const health = await relay.request('/health'); assert.deepEqual(await health.json(), { status: 'ok' });
  } finally { relay.close(); }
});

test('first login schedules cleanup and alarms remove expired rows without more HTTP traffic', async () => {
  const relay = await fixture(); let time = Date.now(); const clock = mock.method(Date, 'now', () => time);
  try {
    const login = await relay.start();
    assert.equal(relay.alarm(), time + 60000);
    time = relay.alarm(); await relay.coordinator.alarm();
    assert.equal(relay.alarm(), login.expiresAt);
    time = relay.alarm(); await relay.coordinator.alarm();
    assert.equal((relay.db.prepare('SELECT COUNT(*) AS count FROM logins').get() as { count: number }).count, 0);
    assert.equal((relay.db.prepare('SELECT COUNT(*) AS count FROM rates').get() as { count: number }).count, 0);
  } finally { clock.mock.restore(); relay.close(); }
});

test('browser callback clears fragment before POST and never displays or persists the token', async () => {
  const relay = await fixture();
  try {
    const login = await relay.start(); const auth = await relay.authorize(login.id);
    const script = await (await relay.request('/oauth-callback.js')).text();
    const title = {textContent:''}; const message = {textContent:''}; let cleared = false; let posted = false;
    const location = {hash:'#'+new URLSearchParams({state:auth.state,access_token:accessToken,expires_in:'3600'}).toString(),search:''};
    runInNewContext(script, {URLSearchParams,window:{location,history:{replaceState(_state:unknown,_title:string,path:string){assert.equal(path,'/anilist/callback');cleared=true;location.hash='';}}},document:{getElementById(id:string){return id==='callback-title'?title:message;}},fetch:async(path:string,init:RequestInit)=>{assert.equal(cleared,true);posted=true;assert.equal(path,'/anilist/callback');assert.equal(init.credentials,'same-origin');const body=JSON.parse(String(init.body));assert.equal(body.accessToken,accessToken);return relay.complete(auth,body);}});
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(posted,true);assert.equal(title.textContent,'Connected — you can close this tab.');assert.ok(!JSON.stringify([title,message]).includes(accessToken));
    let unexpected = false;
    runInNewContext(script,{URLSearchParams,window:{location:{hash:'#access_token='+accessToken,search:''},history:{replaceState(){}}},document:{getElementById(id:string){return id==='callback-title'?title:message;}},fetch(){unexpected=true;}});
    assert.equal(unexpected,false);assert.equal(title.textContent,'Sign-in failed — try again.');
  } finally {relay.close();}
});

test('implicit callback requires same-origin POST and valid state; rejects invalid expiry and token sizes',async()=>{
  const relay=await fixture();
  try{
    const login=await relay.start();const auth=await relay.authorize(login.id);
    const payload=JSON.stringify({state:auth.state,accessToken,expiresIn:3600});
    assert.equal((await relay.request('/anilist/callback',{method:'POST',headers:{'content-type':'application/json',cookie:auth.cookie},body:payload})).status,403);
    assert.equal((await relay.request('/anilist/callback',{method:'POST',headers:{'content-type':'application/json',cookie:auth.cookie,origin:'https://evil.example'},body:payload})).status,403);
    assert.equal((await relay.complete(auth,{state:null})).status,400);
    assert.equal((await relay.complete(auth,{accessToken:'x'.repeat(17000)})).status,413);
    assert.equal((await relay.complete(auth,{expiresIn:365*86400*10})).status,200);
    const saved=await (await relay.post(`/v1/login/${login.id}/claim`,{verifier:verifier()})).json();assert.ok(saved.expiresAt<=Date.now()+365*86400*1000);
    for(const value of [{expiresIn:-1},{expiresIn:'bad'},{expiresIn:null,accessToken:'bad.jwt.token'},{expiresIn:null,accessToken:'header.'+Buffer.from(JSON.stringify({exp:1})).toString('base64url')+'.signature'},{accessToken:'short'}]){
      const next=await relay.start();const nextAuth=await relay.authorize(next.id);assert.equal((await relay.complete(nextAuth,value)).status,400);assert.deepEqual(await(await relay.post(`/v1/login/${next.id}/claim`,{verifier:verifier()})).json(),{status:'denied'});
    }
    assert.equal(relay.exchanges(),0);
  }finally{relay.close();}
});
