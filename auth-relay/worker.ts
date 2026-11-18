type Cursor<T> = Iterable<T> & { toArray(): T[] };
export type Storage = { sql: { exec<T = Record<string, unknown>>(query: string, ...values: (string | number | null)[]): Cursor<T> }; setAlarm(time: number): Promise<void> };
type State = { storage: Storage; blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> };
export type Env = { ASSETS?: { fetch(request: Request): Promise<Response> }; RELAY_PUBLIC_ORIGIN: string; ANILIST_CLIENT_ID: string; TURNSTILE_SITE_KEY: string; TURNSTILE_SECRET_KEY: string; SIGNIN: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } } };
type Login = { id: string; challenge: string; expires: number; phase: string; state: string | null; browser: string | null; token: string | null; tokenExpires: number | null; nextClaim: number };
const nonce = () => { const value = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
export const digest = async (value: string) => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const equal = (a: string, b: string) => { let difference = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return difference === 0; };
const secureHeaders = { 'cache-control': 'no-store', 'referrer-policy': 'same-origin', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self'; form-action 'self' https://anilist.co; frame-ancestors 'none'; base-uri 'none'" };
const json = (data: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(data), { status, headers: { ...secureHeaders, 'content-type': 'application/json; charset=utf-8', ...extra } });
const html = (content: string, status = 200, extra: Record<string, string> = {}) => new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Moewatch sign-in</title><link rel="stylesheet" href="/popup.css"><main><img class="mascot" src="/mascot.png" alt="" width="190" height="240">${content}</main></html>`, { status, headers: { ...secureHeaders, 'content-type': 'text/html; charset=utf-8', ...extra } });
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
class Failure extends Error { constructor(public status: number, message: string) { super(message); } }
async function boundedText(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!body) throw new Failure(400, 'Missing body'); const reader = body.getReader(); const parts: Uint8Array[] = []; let size = 0;
  while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > limit) { await reader.cancel(); throw new Failure(413, 'Body too large'); } parts.push(next.value); }
  const output = new Uint8Array(size); let offset = 0; for (const part of parts) { output.set(part, offset); offset += part.length; } return new TextDecoder().decode(output);
}
async function input(request: Request, limit = 2048): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new Failure(415, 'Expected JSON');
  const text = await boundedText(request.body, limit);
  try { const value: unknown = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; } catch { throw new Failure(400, 'Invalid JSON'); }
}
const getOrigin = (env: Env) => { const url = new URL(env.RELAY_PUBLIC_ORIGIN); if (url.protocol !== 'https:' || url.origin !== env.RELAY_PUBLIC_ORIGIN) throw new Failure(503, 'Relay configuration unavailable'); return url; };
const caught = (error: unknown) => json({ error: error instanceof Failure ? error.message : 'Sign-in unavailable; try again' }, error instanceof Failure ? error.status : 503, error instanceof Failure && error.status === 429 ? { 'retry-after': '3' } : {});
const turnstileCallbackScript = `(() => {
  const form = document.getElementById('authorize-form');
  const proof = form.elements.namedItem('cf-turnstile-response');
  const button = form.querySelector('button');
  let submitted = false;
  form.addEventListener('submit', event => {
    if (submitted || !proof.value) { event.preventDefault(); return; }
    submitted = true;
    button.disabled = true;
  });
  window.moewatchTurnstileComplete = token => {
    if (submitted || typeof token !== 'string' || !token) return;
    proof.value = token;
    button.disabled = false;
    form.requestSubmit();
  };
  window.moewatchTurnstileExpired = () => {
    if (!submitted) { proof.value = ''; button.disabled = true; }
  };
})();`;


const oauthCallbackScript = `(() => {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const query = new URLSearchParams(window.location.search);
  const state = fragment.get('state') || query.get('state');
  const accessToken = fragment.get('access_token');
  const expiresIn = fragment.get('expires_in');
  const error = fragment.get('error') || query.get('error');
  window.history.replaceState(null, '', '/anilist/callback');
  const title = document.getElementById('callback-title');
  const message = document.getElementById('callback-message');
  const failed = () => { title.textContent = 'Sign-in failed — try again.'; message.textContent = ''; };
  if (!state) { failed(); return; }
  fetch('/anilist/callback', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state, accessToken, expiresIn, error: error || (!accessToken ? 'missing_token' : undefined) }) })
    .then(async response => { const result = await response.json(); if (!response.ok || result.status !== 'complete') { failed(); return; } title.textContent = 'Connected — you can close this tab.'; message.textContent = ''; })
    .catch(failed);
})();`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const origin = getOrigin(env); const url = new URL(request.url);
      if (url.origin !== origin.origin) throw new Failure(403, 'Untrusted host');
      if (['/popup.css', '/mascot.png'].includes(url.pathname) && ['GET', 'HEAD'].includes(request.method) && env.ASSETS) return env.ASSETS.fetch(request);
      if (url.pathname === '/health' && request.method === 'GET') return json({ status: 'ok' });
      if (url.pathname === '/turnstile-callback.js' && request.method === 'GET') return new Response(turnstileCallbackScript, { headers: { ...secureHeaders, 'content-type': 'application/javascript; charset=utf-8' } });
      if (url.pathname === '/oauth-callback.js' && request.method === 'GET') return new Response(oauthCallbackScript, { headers: { ...secureHeaders, 'content-type': 'application/javascript; charset=utf-8' } });
      const routeAllowed = (request.method === 'POST' && (url.pathname === '/v1/login' || /^\/v1\/login\/[A-Za-z0-9_-]{43}\/claim$/.test(url.pathname))) || (['GET', 'POST'].includes(request.method) && url.pathname === '/authorize') || (['GET', 'POST'].includes(request.method) && url.pathname === '/anilist/callback');
      if (!routeAllowed) throw new Failure(404, 'Route not found');
      if (request.method === 'GET' && url.pathname === '/authorize' && !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('id') ?? '')) throw new Failure(400, 'Invalid sign-in');
      const requestOrigin = request.headers.get('origin');
      // OAuth navigations are protected by state and cookies, not the referring origin.
      const navigation = request.method === 'GET' && ['/authorize', '/anilist/callback'].includes(url.pathname);
      const opaqueSameOriginForm = request.method === 'POST' && url.pathname === '/authorize' && requestOrigin === 'null' && request.headers.get('sec-fetch-site') === 'same-origin';
      if (!navigation && requestOrigin && requestOrigin !== origin.origin && !opaqueSameOriginForm) throw new Failure(403, 'Cross-origin request rejected');
      if (request.method === 'POST' && url.pathname === '/anilist/callback' && requestOrigin !== origin.origin) throw new Failure(403, 'Same-origin callback required');
      if (Number(request.headers.get('content-length') ?? 0) > (url.pathname === '/anilist/callback' ? 16384 : 8192)) throw new Failure(413, 'Body too large');
      if (request.url.length > 4096) throw new Failure(414, 'URL too long');
      // A single fixed coordinator prevents attacker-controlled Durable Object creation.
      const headers = new Headers(request.headers); headers.set('x-relay-source', await digest(request.headers.get('cf-connecting-ip') ?? 'unknown'));
      return await env.SIGNIN.get(env.SIGNIN.idFromName('coordinator-v2')).fetch(new Request(request, { headers }));
    } catch (error) { return caught(error); }
  },
};

export class SigninCoordinator {
  constructor(private state: State, private env: Env) {
    state.blockConcurrencyWhile(async () => {
      state.storage.sql.exec('CREATE TABLE IF NOT EXISTS logins (id TEXT PRIMARY KEY, challenge TEXT NOT NULL, expires INTEGER NOT NULL, phase TEXT NOT NULL, state TEXT, browser TEXT, token TEXT, tokenExpires INTEGER, nextClaim INTEGER NOT NULL DEFAULT 0)');
      state.storage.sql.exec('CREATE INDEX IF NOT EXISTS login_state ON logins(state)');
      state.storage.sql.exec('CREATE TABLE IF NOT EXISTS rates (source TEXT PRIMARY KEY, expires INTEGER NOT NULL, count INTEGER NOT NULL, starts INTEGER NOT NULL)');
      await this.cleanup();
    });
  }
  private rows<T>(query: string, ...values: (string | number | null)[]): T[] { return this.state.storage.sql.exec<T>(query, ...values).toArray(); }
  private login(id: string) { return this.rows<Login>('SELECT * FROM logins WHERE id = ?', id)[0]; }
  private async cleanup() {
    const time = Date.now(); this.rows('DELETE FROM logins WHERE expires <= ?', time); this.rows('DELETE FROM rates WHERE expires <= ?', time);
    const next = this.rows<{ expires: number | null }>('SELECT MIN(expires) AS expires FROM (SELECT expires FROM logins UNION ALL SELECT expires FROM rates)')[0]?.expires;
    if (next !== null && next !== undefined) await this.state.storage.setAlarm(Math.max(time + 1000, next));
  }
  async alarm() { await this.cleanup(); }
  async fetch(request: Request): Promise<Response> {
    try {
      await this.cleanup(); const origin = getOrigin(this.env); const url = new URL(request.url); const time = Date.now();
      const source = request.headers.get('x-relay-source') ?? 'unknown';
      const rate = this.rows<{ count: number; starts: number }>('SELECT count, starts FROM rates WHERE source = ?', source)[0];
      const starting = request.method === 'POST' && url.pathname === '/v1/login';
      if (rate && (rate.count >= 180 || (starting && rate.starts >= 10))) throw new Failure(429, 'Too many requests; retry later');
      if (!rate && this.rows<{ count: number }>('SELECT COUNT(*) AS count FROM rates')[0].count >= 5000) throw new Failure(503, 'Relay busy');
      this.rows('INSERT INTO rates (source, expires, count, starts) VALUES (?, ?, 1, ?) ON CONFLICT(source) DO UPDATE SET count = count + 1, starts = starts + ?', source, time + 60_000, starting ? 1 : 0, starting ? 1 : 0);
      if (starting) {
        const globalRate = this.rows<{ count: number }>('SELECT count FROM rates WHERE source = ?', 'global-start')[0];
        if (globalRate && globalRate.count >= 100) throw new Failure(429, 'Relay sign-in limit reached; retry later');
        this.rows('INSERT INTO rates (source, expires, count, starts) VALUES (?, ?, 1, 0) ON CONFLICT(source) DO UPDATE SET count = count + 1', 'global-start', time + 60_000);
        const value = await input(request);
        if (typeof value.challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.challenge)) throw new Failure(400, 'Invalid challenge');
        if (this.rows<{ count: number }>('SELECT COUNT(*) AS count FROM logins')[0].count >= 1000) throw new Failure(503, 'Relay busy');
        const id = nonce(); const expiresAt = time + 600_000;
        this.rows('INSERT INTO logins (id, challenge, expires, phase) VALUES (?, ?, ?, ?)', id, value.challenge, expiresAt, 'new');
        return json({ id, authorizeUrl: `${origin.origin}/authorize?id=${id}`, expiresAt, interval: 3 }, 201);
      }
      const claim = /^\/v1\/login\/([A-Za-z0-9_-]{43})\/claim$/.exec(url.pathname);
      if (request.method === 'POST' && claim) {
        const value = await input(request);
        if (typeof value.verifier !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(value.verifier)) throw new Failure(403, 'Invalid verifier');
        const challenge = await digest(value.verifier); const login = this.login(claim[1]);
        if (!login || login.expires <= Date.now()) throw new Failure(404, 'Sign-in expired; try again');
        if (!equal(challenge, login.challenge)) throw new Failure(403, 'Invalid verifier');
        // No await between reading and deleting: concurrent claims cannot both receive a token.
        if (login.phase === 'complete' || login.phase === 'denied') { this.rows('DELETE FROM logins WHERE id = ?', login.id); return json(login.phase === 'denied' ? { status: 'denied' } : { status: 'complete', accessToken: login.token, expiresAt: login.tokenExpires }); }
        if (login.nextClaim > Date.now()) throw new Failure(429, 'Poll every three seconds');
        this.rows('UPDATE logins SET nextClaim = ? WHERE id = ?', Date.now() + 3000, login.id); return json({ status: 'pending' });
      }
      if (url.pathname === '/authorize' && request.method === 'GET') {
        const id = url.searchParams.get('id') ?? ''; const login = this.login(id);
        if (!login || login.phase !== 'new') throw new Failure(400, 'Sign-in expired or already started');
        return html(`<h1>Sign in to AniList</h1><form id="authorize-form" method="post" action="/authorize"><input type="hidden" name="id" value="${escape(id)}"><input type="hidden" name="cf-turnstile-response" value=""><div class="cf-turnstile" data-sitekey="${escape(this.env.TURNSTILE_SITE_KEY)}" data-action="login" data-response-field="false" data-callback="moewatchTurnstileComplete" data-expired-callback="moewatchTurnstileExpired"></div><button type="submit" disabled>Continue with AniList</button></form><script src="/turnstile-callback.js"></script><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`);
      }
      if (url.pathname === '/authorize' && request.method === 'POST') {
        if (request.headers.get('content-type')?.split(';')[0] !== 'application/x-www-form-urlencoded') throw new Failure(415, 'Expected form');
        const form = new URLSearchParams(await boundedText(request.body, 8192)); const id = form.get('id') ?? ''; const proof = form.get('cf-turnstile-response');
        const candidate = this.login(id);
        if (!candidate || candidate.phase !== 'new') throw new Failure(400, 'Sign-in expired or already started. Close this window and start sign-in again in Moewatch.');
        if (!proof || proof.length > 2048) throw new Failure(400, 'Browser verification did not finish. Close this window and start sign-in again in Moewatch.');
        const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000), body: new URLSearchParams({ secret: this.env.TURNSTILE_SECRET_KEY, response: proof }) });
        if (!verification.ok) throw new Failure(503, 'Sign-in check unavailable');
        const result = JSON.parse(await boundedText(verification.body, 16384)) as { success?: boolean; hostname?: string; action?: string };
        if (!result.success || result.hostname !== origin.hostname || result.action !== 'login') throw new Failure(403, 'Sign-in check failed');
        const login = this.login(id); if (!login || login.phase !== 'new' || login.expires <= Date.now()) throw new Failure(400, 'Sign-in expired or already started');
        const state = nonce(); const browser = nonce(); const browserHash = await digest(browser);
        if (this.login(id)?.phase !== 'new') throw new Failure(400, 'Sign-in already started');
        this.rows('UPDATE logins SET phase = ?, state = ?, browser = ? WHERE id = ?', 'authorized', state, browserHash, id);
        const authorize = new URL('https://anilist.co/api/v2/oauth/authorize'); authorize.searchParams.set('client_id', this.env.ANILIST_CLIENT_ID); authorize.searchParams.set('response_type', 'token'); authorize.searchParams.set('state', state);
        return new Response(null, { status: 302, headers: { ...secureHeaders, location: authorize.toString(), 'set-cookie': `moewatch_relay_${id}=${browser}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600` } });
      }
      if (url.pathname === '/anilist/callback' && request.method === 'GET') {
        return html('<h1 id="callback-title">Connecting…</h1><p id="callback-message" hidden></p><script src="/oauth-callback.js"></script>');
      }
      if (url.pathname === '/anilist/callback' && request.method === 'POST') {
        const value = await input(request, 16384);
        if (typeof value.state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.state)) throw new Failure(400, 'Missing or invalid authorization state');
        const candidate = this.rows<Login>('SELECT * FROM logins WHERE state = ?', value.state)[0];
        if (!candidate || candidate.phase !== 'authorized') throw new Failure(400, 'Invalid or already used callback');
        const browser = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`moewatch_relay_${candidate.id}=`))?.split('=')[1];
        if (!browser || !candidate.browser || !equal(await digest(browser), candidate.browser)) throw new Failure(403, 'Invalid sign-in browser');
        const login = this.login(candidate.id); if (!login || login.phase !== 'authorized' || login.expires <= Date.now()) throw new Failure(400, 'Callback expired or already used');
        const cookie = { 'set-cookie': `moewatch_relay_${login.id}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` };
        // Consume state synchronously before returning: duplicate completions cannot overwrite a token.
        this.rows('UPDATE logins SET phase = ?, state = NULL, browser = NULL WHERE id = ?', 'denied', login.id);
        if (typeof value.error === 'string' && value.error) return json({ status: 'denied' }, 200, cookie);
        try {
          if (typeof value.accessToken !== 'string' || value.accessToken.length < 16 || value.accessToken.length > 12000 || /\s/.test(value.accessToken)) throw new Error();
          let expiresAt: number;
          if (value.expiresIn !== undefined && value.expiresIn !== null && value.expiresIn !== '') {
            const seconds = typeof value.expiresIn === 'string' && /^\d+$/.test(value.expiresIn) ? Number(value.expiresIn) : value.expiresIn;
            if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) throw new Error();
            expiresAt = Date.now() + Math.min(seconds, 365 * 86400) * 1000;
          } else {
            // JWT expiry is only a lifetime hint. The installed client's Viewer request verifies the token.
            const part = value.accessToken.split('.')[1]; if (!part || !/^[A-Za-z0-9_-]+$/.test(part)) throw new Error();
            const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - part.length % 4) % 4))) as { exp?: unknown };
            if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) throw new Error();
            expiresAt = Math.min(payload.exp * 1000, Date.now() + 365 * 86400 * 1000);
          }
          if (expiresAt <= Date.now()) throw new Error();
          this.rows('UPDATE logins SET phase = ?, token = ?, tokenExpires = ? WHERE id = ?', 'complete', value.accessToken, expiresAt, login.id);
          return json({ status: 'complete' }, 200, cookie);
        } catch { return json({ status: 'denied', error: 'AniList returned an invalid or expired token; start sign-in again' }, 400, cookie); }
      }
      throw new Failure(404, 'Route not found');
    } catch (error) { return caught(error); } finally { await this.cleanup(); }
  }
}
