import { anilist } from './infrastructure/anilist';
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { normalizeAnime } from '../src/catalog';
import { accountStatuses, type AccountEntry, type AccountStatus } from '../shared/account';
import { ApiError } from './infrastructure/errors';

type Session = { accessToken: string; expiresAt: number; user: { id: number; name: string; avatar: string } | null };
type OAuthState = { expiresAt: number };
type Config = { clientId: string; clientSecret: string } | null;
const authorize = 'https://anilist.co/api/v2/oauth/authorize';
const token = 'https://anilist.co/api/v2/oauth/token';
const sessionCookie = 'moewatch_session';
const stateCookie = 'moewatch_oauth_state';

const config = (): Config => {
  const clientId = process.env.ANILIST_CLIENT_ID || process.env.ID;
  const clientSecret = process.env.ANILIST_CLIENT_SECRET || process.env.SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
};
const cookie = (request: IncomingMessage, name: string): string | undefined => request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
const safeEqual = (left?: string, right?: string): boolean => Boolean(left && right && Buffer.byteLength(left) === Buffer.byteLength(right) && timingSafeEqual(Buffer.from(left), Buffer.from(right)));
const cookieFlags = (secure: boolean, maxAge = 0) => `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
const setCookie = (response: ServerResponse, value: string) => {
  const current = response.getHeader('set-cookie');
  response.setHeader('set-cookie', [...(Array.isArray(current) ? current : current ? [String(current)] : []), value]);
};
const upstreamError = (status: number): ApiError => new ApiError(status === 429 ? 'RATE_LIMITED' : status >= 500 ? 'UPSTREAM_ERROR' : 'INVALID_REQUEST', status === 429 ? 'AniList rate limit reached; try again later' : 'AniList could not complete the request', status === 429 ? 429 : status >= 500 ? 502 : 400);

export class AccountService {
  private sessions = new Map<string, Session>();
  private states = new Map<string, OAuthState>();
  private loaded = false;
  private logins = new Map<string, { id: string; verifier: string; expiresAt: number; polling: boolean }>();
  private sessionFile = resolve(process.env.MOEWATCH_SESSION_FILE || '.moewatch/sessions.json');

  private relayUrl(): URL | null {
    const configured = process.env.MOEWATCH_AUTH_RELAY_URL ?? 'https://moewatch-signin.mqt464.workers.dev';
    if (!configured) return null;
    const url = new URL(configured);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new ApiError('UNAVAILABLE', 'Auth relay must use HTTPS', 503);
    return url;
  }
  private async relay(path: string, body: unknown, signal: AbortSignal): Promise<any> {
    const base = this.relayUrl();
    if (!base) throw new ApiError('UNAVAILABLE', 'Auth relay is not configured', 503);
    const response = await fetch(new URL(path, base), { method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new ApiError('UNAVAILABLE', response.status === 404 ? 'Sign-in expired; try again' : 'Sign-in relay unavailable; try again', 503);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Invalid relay response');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 65536) throw new Error('Invalid relay response'); chunks.push(chunk.value); }
    } finally { await reader.cancel(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  async startLogin(request: IncomingMessage, response: ServerResponse, signal: AbortSignal): Promise<unknown> {
    const relay = this.relayUrl();
    if (!relay) return { mode: 'direct', authorizeUrl: '/api/v1/account/login' };
    this.loadSessions(); this.prune(); this.cancelLogin(request, response);
    const verifier = randomBytes(32).toString('base64url');
    const result = await this.relay('/v1/login', { challenge: createHash('sha256').update(verifier).digest('base64url') }, signal);
    const authorizeUrl = new URL(result.authorizeUrl);
    if (authorizeUrl.origin !== relay.origin || typeof result.id !== 'string' || !/^[\w-]{20,200}$/.test(result.id) || !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now()) throw new Error('Invalid relay response');
    const id = randomBytes(32).toString('base64url'); const expiresAt = Math.min(result.expiresAt, Date.now() + 600000);
    this.logins.set(id, { id: result.id, verifier, expiresAt, polling: false });
    setCookie(response, `moewatch_relay_login=${id}; ${cookieFlags(this.secure(request), 600)}`);
    return { mode: 'relay', authorizeUrl: authorizeUrl.toString(), expiresAt, interval: 3 };
  }
  cancelLogin(request: IncomingMessage, response: ServerResponse): void {
    const id = cookie(request, 'moewatch_relay_login'); if (id) this.logins.delete(id);
    setCookie(response, `moewatch_relay_login=; ${cookieFlags(this.secure(request))}`);
  }
  async pollLogin(request: IncomingMessage, response: ServerResponse, signal: AbortSignal): Promise<unknown> {
    const id = cookie(request, 'moewatch_relay_login'); const login = id ? this.logins.get(id) : null;
    if (!login || login.expiresAt <= Date.now()) throw new ApiError('INVALID_REQUEST', 'Sign-in expired; try again', 400);
    if (login.polling) return { status: 'pending' };
    login.polling = true;
    try {
      const result = await this.relay(`/v1/login/${encodeURIComponent(login.id)}/claim`, { verifier: login.verifier }, signal);
      if (!id || this.logins.get(id) !== login) return { status: 'denied' };
      if (result.status === 'pending') return { status: 'pending' };
      this.cancelLogin(request, response);
      if (result.status === 'denied') return { status: 'denied' };
      if (result.status !== 'complete' || typeof result.accessToken !== 'string' || !result.accessToken || result.accessToken.length > 32768 || !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now()) throw new Error('Invalid relay token');
      this.establish(request, response, result.accessToken, Math.min(result.expiresAt, Date.now() + 365 * 86400000));
      return { status: 'complete' };
    } finally { login.polling = false; }
  }
  private establish(request: IncomingMessage, response: ServerResponse, accessToken: string, expiresAt: number): void {
    this.loadSessions();
    const previous = cookie(request, sessionCookie); if (previous) this.sessions.delete(previous);
    const id = randomBytes(32).toString('base64url');
    this.sessions.set(id, { accessToken, expiresAt, user: null }); this.saveSessions();
    setCookie(response, `${sessionCookie}=${id}; ${cookieFlags(this.secure(request), Math.max(1, Math.floor((expiresAt - Date.now()) / 1000)))}`);
  }

  private sessionKey(): Buffer {
    const file = resolve(dirname(this.sessionFile), 'session-key.bin');
    try { const key = readFileSync(file); if (key.length !== 32) throw new Error('Invalid session key'); return key; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const key = randomBytes(32);
      try { writeFileSync(file, key, { flag: 'wx', mode: 0o600 }); return key; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return readFileSync(file); throw error; }
    }
  }
  private loadSessions(): void {
    if (this.loaded) return;
    try {
      const stored = JSON.parse(readFileSync(this.sessionFile, 'utf8'));
      const decrypt = (key: Buffer) => {
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(stored.iv, 'base64'));
        decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
        return JSON.parse(Buffer.concat([decipher.update(Buffer.from(stored.data, 'base64')), decipher.final()]).toString('utf8'));
      };
      let entries;
      try { entries = decrypt(this.sessionKey()); }
      catch (error) {
        const settings = config(); if (!settings) throw error;
        entries = decrypt(createHash('sha256').update(`moewatch-sessions-v1:${settings.clientId}:${settings.clientSecret}`).digest());
      }
      if (!Array.isArray(entries)) throw new Error('Invalid session store');
      this.sessions = new Map(entries.filter((entry): entry is [string, Session] => Array.isArray(entry) && /^[\w-]{43}$/.test(entry[0]) && typeof entry[1]?.accessToken === 'string' && Number.isFinite(entry[1]?.expiresAt) && entry[1].expiresAt > Date.now()));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new ApiError('UNAVAILABLE', 'Saved account sessions could not be read. Restore the session file and original AniList credentials, or remove the session file and sign in again.', 503);
    }
    this.loaded = true;
    if (this.sessions.size) this.saveSessions();
  }
  private saveSessions(): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.sessionKey(), iv);
    const data = Buffer.concat([cipher.update(JSON.stringify([...this.sessions])), cipher.final()]);
    mkdirSync(dirname(this.sessionFile), { recursive: true, mode: 0o700 });
    const temporary = `${this.sessionFile}.tmp`;
    writeFileSync(temporary, JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }), { mode: 0o600 });
    renameSync(temporary, this.sessionFile);
  }

  private secure(request?: IncomingMessage): boolean {
    if (this.relayUrl() && request) return Boolean((request.socket as { encrypted?: boolean } | undefined)?.encrypted || request.headers.origin?.startsWith('https://'));
    return process.env.MOEWATCH_PUBLIC_ORIGIN?.startsWith('https://') ?? false;
  }
  private prune(): void {
    const now = Date.now();
    for (const [id, value] of this.logins) if (value.expiresAt <= now) this.logins.delete(id);
    for (const [id, value] of this.sessions) if (value.expiresAt <= now) this.sessions.delete(id);
    for (const [id, value] of this.states) if (value.expiresAt <= now) this.states.delete(id);
  }
  private session(request: IncomingMessage): Session | null {
    this.loadSessions();
    this.prune();
    return this.sessions.get(cookie(request, sessionCookie) ?? '') ?? null;
  }
  private requireSession(request: IncomingMessage): Session {
    const session = this.session(request);
    if (!session) throw new ApiError('INVALID_REQUEST', 'Sign in with AniList first', 401);
    return session;
  }
  private async graph<T>(session: Session, query: string, variables: Record<string, unknown>, signal: AbortSignal, fresh = false): Promise<T> {
    const response = await anilist.request(query, variables, { signal, token: session.accessToken, fresh, ttlMs: query.includes('recommendations(') ? 30 * 60_000 : 3 * 60_000 });
    if (response.status === 401) { session.expiresAt = 0; this.prune(); this.saveSessions(); throw new ApiError('INVALID_REQUEST', 'AniList session expired; sign in again', 401); }
    if (response.status === 404) throw new ApiError('NOT_FOUND', 'AniList list entry not found', 404);
    if (!response.ok) throw upstreamError(response.status);
    const body = await response.json() as { data?: T; errors?: { status?: number }[] };
    if (body.errors?.length && body.errors.every(error => error.status === 404)) throw new ApiError('NOT_FOUND', 'AniList list entry not found', 404);
    if (!body.data || body.errors?.length) throw new ApiError('UPSTREAM_ERROR', 'AniList rejected the account request', 502);
    return body.data;
  }
  async status(request: IncomingMessage): Promise<{ configured: boolean; user: Session['user']; error?: string }> {
    if (!this.relayUrl() && !config()) return { configured: false, user: null };
    const hadCookie = Boolean(cookie(request, sessionCookie));
    const session = this.session(request);
    if (!session) return { configured: true, user: null, ...(hadCookie ? { error: 'Session expired' } : {}) };
    if (!session.user) {
      try {
        const data = await this.graph<{ Viewer: { id: number; name: string; avatar?: { large?: string } } }>(session, 'query { Viewer { id name avatar { large } } }', {}, AbortSignal.timeout(10_000));
        session.user = { id: data.Viewer.id, name: data.Viewer.name, avatar: data.Viewer.avatar?.large ?? '' };
        this.saveSessions();
      } catch (error) { return { configured: true, user: null, error: error instanceof ApiError ? error.message : 'AniList account unavailable' }; }
    }
    return { configured: true, user: session.user };
  }
  login(response: ServerResponse, callbackUrl: string): void {
    const settings = config();
    if (!settings) throw new ApiError('UNAVAILABLE', 'AniList OAuth is not configured', 503);
    this.loadSessions();
    this.prune();
    const state = randomBytes(32).toString('base64url');
    this.states.set(state, { expiresAt: Date.now() + 10 * 60_000 });
    setCookie(response, `${stateCookie}=${state}; ${cookieFlags(this.secure(), 600)}`);
    const url = new URL(authorize); url.searchParams.set('client_id', settings.clientId); url.searchParams.set('redirect_uri', callbackUrl); url.searchParams.set('response_type', 'code'); url.searchParams.set('state', state);
    response.writeHead(302, { location: url.toString(), 'cache-control': 'no-store' }); response.end();
  }
  async callback(request: IncomingMessage, response: ServerResponse, code: string | null, state: string | null, callbackUrl: string, signal: AbortSignal): Promise<void> {
    const settings = config();
    const stored = state ? this.states.get(state) : undefined;
    if (state) this.states.delete(state);
    setCookie(response, `${stateCookie}=; ${cookieFlags(this.secure())}`);
    if (!settings || !code || code.length > 2048 || !stored || stored.expiresAt <= Date.now() || !safeEqual(state ?? undefined, cookie(request, stateCookie))) return this.redirectResult(response, 'error');
    try {
      const result = await fetch(token, { method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]), headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'authorization_code', client_id: settings.clientId, client_secret: settings.clientSecret, redirect_uri: callbackUrl, code }) });
      if (!result.ok) throw upstreamError(result.status);
      const body = await result.json() as { access_token?: string; expires_in?: number };
      if (!body.access_token || !Number.isFinite(body.expires_in) || body.expires_in! <= 0) throw new Error('Invalid token response');
      const id = randomBytes(32).toString('base64url');
      const ttl = Math.min(body.expires_in!, 365 * 24 * 60 * 60);
      const previous = cookie(request, sessionCookie);
      if (previous) this.sessions.delete(previous);
      this.sessions.set(id, { accessToken: body.access_token, expiresAt: Date.now() + ttl * 1000, user: null });
      this.saveSessions();
      setCookie(response, `${sessionCookie}=${id}; ${cookieFlags(this.secure(), ttl)}`);
      this.redirectResult(response, 'connected');
    } catch { this.redirectResult(response, 'error'); }
  }
  private redirectResult(response: ServerResponse, result: 'connected' | 'error'): void { response.writeHead(302, { location: `/settings/account?result=${result}`, 'cache-control': 'no-store' }); response.end(); }
  logout(request: IncomingMessage, response: ServerResponse): void { this.cancelLogin(request, response); this.loadSessions(); const id = cookie(request, sessionCookie); if (id) { const session = this.sessions.get(id); if (session) anilist.invalidate(session.accessToken); this.sessions.delete(id); } this.saveSessions(); setCookie(response, `${sessionCookie}=; ${cookieFlags(this.secure(request))}`); }
  async list(request: IncomingMessage, signal: AbortSignal): Promise<AccountEntry[]> {
    const session = this.requireSession(request); const user = (await this.status(request)).user;
    if (!user) throw new ApiError('UNAVAILABLE', 'AniList account unavailable', 502);
    if (request.headers['x-moewatch-refresh'] === '1') anilist.expire(session.accessToken);
    const entries: AccountEntry[] = [];
    for (let page = 1; page <= 100; page++) {
      const data = await this.graph<{ Page: { pageInfo: { hasNextPage: boolean }; mediaList: any[] } }>(session, `query ($userId: Int!, $page: Int!) { Page(page: $page, perPage: 50) { pageInfo { hasNextPage } mediaList(userId: $userId, type: ANIME, sort: UPDATED_TIME_DESC) { id mediaId status progress updatedAt media { id title { english romaji native } description coverImage { extraLarge large } bannerImage startDate { year } format episodes duration averageScore popularity genres status studios(isMain: true) { nodes { name } } characters(perPage: 12, sort: ROLE) { edges { role node { name { full } image { large } } } } relations { edges { relationType node { id type isAdult title { english romaji } coverImage { large } } } } } } } }`, { userId: user.id, page }, signal, request.headers['x-moewatch-refresh'] === '1');
      if (!Array.isArray(data.Page.mediaList)) throw new ApiError('UPSTREAM_ERROR', 'AniList returned an invalid list', 502);
      entries.push(...data.Page.mediaList.map(item => ({ id: item.id, mediaId: item.mediaId, status: item.status, progress: item.progress ?? 0, updatedAt: item.updatedAt, anime: normalizeAnime(item.media) })));
      if (!data.Page.pageInfo.hasNextPage) return entries;
    }
    throw new ApiError('UPSTREAM_ERROR', 'AniList list exceeded the pagination limit', 502);
  }
  async upsert(request: IncomingMessage, input: unknown, signal: AbortSignal): Promise<AccountEntry> {
    await this.assertAccount(request);
    if (!input || typeof input !== 'object') throw new ApiError('INVALID_REQUEST', 'Invalid list entry', 400);
    const value = input as Record<string, unknown>; const mediaId = value.mediaId as number; const progress = value.progress as number; const status = value.status as AccountStatus;
    if (!Number.isSafeInteger(mediaId) || mediaId <= 0 || mediaId > 2147483647 || !Number.isSafeInteger(progress) || progress < 0 || progress > 2147483647 || !accountStatuses.includes(status)) throw new ApiError('INVALID_REQUEST', 'Invalid mediaId, status or progress', 400);
    const data = await this.graph<{ SaveMediaListEntry: any }>(this.requireSession(request), `mutation ($mediaId: Int!, $status: MediaListStatus!, $progress: Int!) { SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress) { id mediaId status progress updatedAt media { id title { english romaji native } description coverImage { extraLarge large } bannerImage startDate { year } format episodes duration averageScore popularity genres status studios(isMain: true) { nodes { name } } characters(perPage: 12, sort: ROLE) { edges { role node { name { full } image { large } } } } relations { edges { relationType node { id type isAdult title { english romaji } coverImage { large } } } } } } }`, { mediaId, status, progress }, signal);
    const item = data.SaveMediaListEntry; return { id: item.id, mediaId: item.mediaId, status: item.status, progress: item.progress ?? 0, updatedAt: item.updatedAt, anime: normalizeAnime(item.media) };
  }
  async remove(request: IncomingMessage, mediaId: number, signal: AbortSignal): Promise<void> {
    await this.assertAccount(request);
    const session = this.requireSession(request); const user = (await this.status(request)).user;
    if (!user) throw new ApiError('UNAVAILABLE', 'AniList account unavailable', 502);
    try {
      const found = await this.graph<{ MediaList: { id: number } | null }>(session, 'query ($userId: Int!, $mediaId: Int!) { MediaList(userId: $userId, mediaId: $mediaId, type: ANIME) { id } }', { userId: user.id, mediaId }, signal);
      if (!found.MediaList) return;
      await this.graph(session, 'mutation ($id: Int!) { DeleteMediaListEntry(id: $id) { deleted } }', { id: found.MediaList.id }, signal);
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'NOT_FOUND') throw error;
    }
  }
  async favourite(request: IncomingMessage, mediaId: number, signal: AbortSignal, desired?: unknown): Promise<{ isFavourite: boolean; isFavouriteBlocked: boolean }> {
    await this.assertAccount(request);
    const session = this.requireSession(request);
    const read = async () => {
      const data = await this.graph<{ Media: { isFavourite: boolean; isFavouriteBlocked: boolean } | null }>(session,
        'query ($id: Int!) { Media(id: $id, type: ANIME) { isFavourite isFavouriteBlocked } }', { id: mediaId }, signal, desired !== undefined);
      if (!data.Media || typeof data.Media.isFavourite !== 'boolean' || typeof data.Media.isFavouriteBlocked !== 'boolean') throw new ApiError('UPSTREAM_ERROR', 'AniList returned an invalid favourite state', 502);
      return data.Media;
    };
    if (desired !== undefined && typeof desired !== 'boolean') throw new ApiError('INVALID_REQUEST', 'Expected a favourite boolean', 400);
    const current = await read();
    if (typeof desired !== 'boolean' || current.isFavourite === desired) return current;
    if (desired && current.isFavouriteBlocked) throw new ApiError('INVALID_REQUEST', 'This anime cannot be favourited on AniList', 400);
    await this.graph(session, 'mutation ($id: Int!) { ToggleFavourite(animeId: $id) { __typename } }', { id: mediaId }, signal);
    return read();
  }
  async discussionQuery(request: IncomingMessage, query: string, variables: Record<string, unknown>, signal: AbortSignal) {
    const session = this.session(request);
    if (session) return this.graph<unknown>(session, query, variables, signal);
    const response = await anilist.request(query, variables, { signal, ttlMs: 60000 });
    if (!response.ok) throw upstreamError(response.status);
    const body = await response.json();
    if (!body.data || body.errors?.length) throw new ApiError('UPSTREAM_ERROR', 'AniList discussions unavailable', 502);
    return body.data;
  }
  async likeDiscussion(request: IncomingMessage, input: unknown, signal: AbortSignal) {
    await this.assertAccount(request);
    if (!input || typeof input !== 'object' || !('id' in input) || typeof input.id !== 'number' || !Number.isSafeInteger(input.id) || input.id <= 0 || input.id > 2147483647 || !('type' in input) || (input.type !== 'THREAD' && input.type !== 'THREAD_COMMENT')) throw new ApiError('INVALID_REQUEST', 'Invalid discussion like', 400);
    const data = await this.graph<{ ToggleLikeV2: { likeCount: number; isLiked: boolean } }>(this.requireSession(request), 'mutation ($id: Int!, $type: LikeableType!) { ToggleLikeV2(id: $id, type: $type) { ... on Thread { likeCount isLiked } ... on ThreadComment { likeCount isLiked } } }', { id: input.id, type: input.type }, signal);
    if (!data.ToggleLikeV2 || !Number.isSafeInteger(data.ToggleLikeV2.likeCount) || typeof data.ToggleLikeV2.isLiked !== 'boolean') throw new ApiError('UPSTREAM_ERROR', 'AniList returned an invalid like state', 502);
    return data.ToggleLikeV2;
  }
  async recommendations(request: IncomingMessage, seeds: number[], signal: AbortSignal) {
    await this.assertAccount(request);
    const session = this.requireSession(request);
    const favourites = await this.graph<{ Viewer: { favourites: { anime: { nodes: { id: number }[] } } } }>(session,
      'query { Viewer { favourites { anime(perPage: 10) { nodes { id } } } } }', {}, signal);
    const favouriteIds = new Set(favourites.Viewer.favourites.anime.nodes.map(item => item.id));
    const ids = [...new Set([...favouriteIds, ...seeds])].slice(0, 10).sort((a, b) => a - b);
    if (!ids.length) return [];
    type Media = Parameters<typeof normalizeAnime>[0];
    const fields = 'id type isAdult title { english romaji native } description coverImage { extraLarge large } bannerImage startDate { year } format episodes duration averageScore popularity genres status';
    const data = await this.graph<Record<string, { recommendations: { nodes: { rating: number; mediaRecommendation: (Media & { type: string }) | null }[] } } | null>>(session,
      `query { ${ids.map(id => `seed${id}: Media(id: ${id}, type: ANIME) { recommendations(perPage: 20, sort: RATING_DESC) { nodes { rating mediaRecommendation { ${fields} } } } }`).join(' ')} }`, {}, signal);
    const ranked = new Map<number, { anime: ReturnType<typeof normalizeAnime>; score: number }>();
    for (const id of ids) {
      for (const recommendation of data[`seed${id}`]?.recommendations.nodes ?? []) {
        const media = recommendation.mediaRecommendation;
        if (!media || media.type !== 'ANIME' || media.isAdult || ids.includes(media.id) || recommendation.rating <= 0) continue;
        const previous = ranked.get(media.id);
        // Log votes so a single popular source cannot swamp several matching favourites.
        const score = Math.log1p(recommendation.rating) * (favouriteIds.has(id) ? 2 : 1);
        ranked.set(media.id, { anime: previous?.anime ?? normalizeAnime(media), score: (previous?.score ?? 0) + score });
      }
    }
    return [...ranked.values()].sort((a, b) => b.score - a.score || a.anime.id - b.anime.id).map(item => item.anime);
  }
  private async assertAccount(request: IncomingMessage): Promise<void> {
    this.requireSession(request);
    const user = (await this.status(request)).user;
    if (!user || request.headers['x-moewatch-account'] !== String(user.id)) throw new ApiError('INVALID_REQUEST', 'Account changed; refresh before syncing', 409);
  }
}
