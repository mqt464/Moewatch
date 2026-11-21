import { TtlCache } from './infrastructure/cache';
import { createEpisodeMetadata } from './catalog/episodes';
import { createServer as nodeServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { hostname, networkInterfaces } from 'node:os';
import type { AnimeIdentity, AudioPreference, PlaybackAttempt, PlaybackRequest, ProviderPreference, ProviderAvailability, ProviderEpisode, ProviderServer } from '../shared/api';
import { canTryEpisodeAudio, providerIds } from '../shared/api';
import { curated, type Anime } from '../src/catalog';
import { createAniListCatalog, type Catalog } from './catalog/anilist';
import { ApiError, asApiError } from './infrastructure/errors';
import { createMediaProxy, mediaTokenTtlMs } from './infrastructure/media';
import type { AnimeProvider } from './providers/types';
import { providers as defaultProviders } from './providers/registry';
import { cacheProvider } from './infrastructure/provider-cache';
import { AccountService } from './account';
import { createSkipService } from './aniskip';
import { createDiscordPresence, validateDiscordPlayback } from './discord';
import { DownloadService } from './downloads';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export type AppOptions = { providers?: AnimeProvider[]; catalog?: Catalog; episodeMetadata?: ReturnType<typeof createEpisodeMetadata>; downloadStateFile?: string; downloadLocation?: string };

const identity = (anime: Anime): AnimeIdentity => ({ id: anime.id, title: anime.title, romaji: anime.romaji, year: anime.year, format: anime.format, episodes: anime.episodes });
const positive = (value: string): number => {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number <= 0) throw new ApiError('INVALID_REQUEST', 'Expected a positive integer', 400);
  return number;
};

function send(response: ServerResponse, status: number, data: unknown): void {
  if (response.writableEnded || response.destroyed) return;
  if (response.headersSent) { response.destroy(); return; }
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(data));
}

function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, parent: AbortSignal, ms = 6500): Promise<T> {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(ms)]);
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => operation(signal)).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 16_384) throw new ApiError('INVALID_REQUEST', 'Request body too large', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError('INVALID_REQUEST', 'Invalid JSON body', 400); }
}

function preference(value: string | null, allowAuto = false): ProviderPreference | undefined {
  if (value === null) return undefined;
  if (value === 'auto' && allowAuto) return value;
  if (providerIds.includes(value as typeof providerIds[number])) return value as typeof providerIds[number];
  throw new ApiError('INVALID_REQUEST', 'Invalid provider', 400);
}

function audioPreference(value: string | null): AudioPreference {
  if (value === null || value === 'sub') return 'sub';
  if (value === 'dub') return 'dub';
  throw new ApiError('INVALID_REQUEST', 'Invalid audio preference', 400);
}

function ordered(all: AnimeProvider[], selected: ProviderPreference = 'auto', fallback = true): AnimeProvider[] {
  const configured = all.filter(provider => provider.configured);
  if (selected === 'auto') return fallback ? configured : configured.slice(0, 1);
  const first = all.find(provider => provider.id === selected);
  if (!first) throw new ApiError('INVALID_REQUEST', 'Unknown provider', 400);
  if (!first.configured && !fallback) throw new ApiError('UNAVAILABLE', 'Provider is unconfigured', 503, first.id);
  return fallback ? [first, ...configured.filter(provider => provider.id !== selected)] : [first];
}

function validatePlayback(value: unknown): PlaybackRequest {
  if (!value || typeof value !== 'object') throw new ApiError('INVALID_REQUEST', 'Invalid playback request', 400);
  const request = value as Record<string, unknown>;
  const animeId = positive(String(request.animeId));
  const episode = positive(String(request.episode));
  const provider = preference(request.provider === undefined ? null : String(request.provider), true);
  const audio = audioPreference(request.audio === undefined ? null : String(request.audio));
  if (request.serverId !== undefined && (typeof request.serverId !== 'string' || !request.serverId || request.serverId.length > 8192 || !provider || provider === 'auto')) throw new ApiError('INVALID_REQUEST', 'A server ID requires a specific provider', 400);
  if (request.fallback !== undefined && typeof request.fallback !== 'boolean') throw new ApiError('INVALID_REQUEST', 'Invalid fallback flag', 400);
  return { animeId, episode, provider, serverId: request.serverId as string | undefined, audio, fallback: request.fallback as boolean | undefined };
}

export function createApiHandler(options: AppOptions = {}) {
  let closed = false;
  const all = (options.providers ?? defaultProviders).map(cacheProvider);
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1', hostname().toLowerCase(), ...Object.values(networkInterfaces()).flatMap(entries => entries?.map(entry => entry.address.toLowerCase()) ?? [])]);
  if (process.env.MOEWATCH_PUBLIC_ORIGIN) allowedHosts.add(new URL(process.env.MOEWATCH_PUBLIC_ORIGIN).hostname.toLowerCase());
  const catalog = options.catalog ?? createAniListCatalog();
  const enrichEpisodes = options.episodeMetadata ?? createEpisodeMetadata();
  const identities = new Map<number, Anime>(options.catalog ? [] : curated.map(anime => [anime.id, anime]));
  const media = createMediaProxy();
  const thumbnailCache = new TtlCache<string | null>(512, 5 * 60_000);
  const account = new AccountService();
  const skipTimes = createSkipService();
  const discord = createDiscordPresence();
  const downloads = new DownloadService({
    stateFile: options.downloadStateFile, defaultLocation: options.downloadLocation,
    read: media.read, resolve: playback,
    artwork: async url => media.issue(url),
    thumbnail: (anime, episode, request, signal) => providerThumbnail(anime, episode, request.provider || 'auto', request.audio || 'sub', request.fallback !== false, signal),
  });

  async function animeById(id: number, signal: AbortSignal, allowCached = false): Promise<Anime | null> {
    if (allowCached && identities.has(id)) return identities.get(id)!;
    const anime = await withTimeout(child => catalog.anime(id, child), signal, 12_000);
    if (anime && !signal.aborted) {
      identities.delete(id);
      identities.set(id, anime);
      while (identities.size > 256) identities.delete(identities.keys().next().value!);
    }
    return anime;
  }

  async function matched(provider: AnimeProvider, anime: Anime, signal: AbortSignal): Promise<string | null> {
    const result = await withTimeout(child => provider.match(identity(anime), child), signal);
    if (result.status === 'ambiguous') throw new ApiError('AMBIGUOUS_MATCH', `Ambiguous ${provider.name} title match`, 409, provider.id);
    return result.status === 'matched' ? result.title.id : null;
  }

  async function availability(anime: Anime, signal: AbortSignal): Promise<ProviderAvailability[]> {
    return Promise.all(all.map(async provider => {
      if (!provider.configured) return { provider: provider.id, status: 'error' as const, episodes: [], error: { code: 'UNAVAILABLE' as const, message: provider.note ?? 'Provider is unconfigured', provider: provider.id } };
      try {
        const titleId = await matched(provider, anime, signal);
        if (!titleId) return { provider: provider.id, status: 'not-found' as const, episodes: [] };
        const episodes = await withTimeout(child => provider.episodes(titleId, child), signal);
        return { provider: provider.id, status: 'available' as const, titleId, episodes };
      } catch (error) {
        const failure = asApiError(error, provider.id);
        return { provider: provider.id, status: failure.code === 'AMBIGUOUS_MATCH' ? 'ambiguous' as const : 'error' as const, episodes: [], error: { code: failure.code, message: failure.message, provider: provider.id } };
      }
    }));
  }

  async function episodeFor(provider: AnimeProvider, anime: Anime, number: number, audio: AudioPreference, signal: AbortSignal): Promise<ProviderEpisode | null> {
    const titleId = await matched(provider, anime, signal);
    if (!titleId) return null;
    const episodes = await withTimeout(child => provider.episodes(titleId, child), signal);
    return episodes.find(episode => episode.number === number && episode.kind === 'regular' && canTryEpisodeAudio(episode, audio)) ?? null;
  }

  async function providerThumbnail(anime: Anime, number: number, selected: ProviderPreference, audio: AudioPreference, fallback: boolean, parent: AbortSignal): Promise<string | null> {
    const key = JSON.stringify([anime.id, number, selected, audio, fallback]);
    const cached = thumbnailCache.get(key);
    if (cached !== undefined) return cached;
    const signal = AbortSignal.any([parent, AbortSignal.timeout(15000)]);
    for (const provider of ordered(all, selected, fallback)) {
      if (!provider.configured || signal.aborted) continue;
      try {
        const episode = await episodeFor(provider, anime, number, audio, signal);
        if (!episode) continue;
        const servers = await withTimeout(child => provider.servers(episode.id, child), signal);
        for (const server of servers.filter(server => server.audio === audio)) {
          if (signal.aborted) break;
          try {
            const result = await withTimeout(child => provider.resolve(server.id, child), signal);
            if (!result.thumbnail) continue;
            const expires = Math.min(result.expiresAt ?? Infinity, Date.now() + 5 * 60_000);
            const url = await media.issue(result.thumbnail, result.headers, expires);
            thumbnailCache.set(key, url, expires - Date.now());
            return url;
          } catch { /* Try another server; missing artwork must not prevent playback. */ }
        }
      } catch { /* An unavailable or ambiguous provider cannot supply this thumbnail. */ }
    }
    parent.throwIfAborted();
    thumbnailCache.set(key, null, 60_000);
    return null;
  }

  async function playback(request: PlaybackRequest, signal: AbortSignal, excluded: string[] = []) {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(25_000)]);
    const anime = await animeById(request.animeId, deadline, true);
    if (!anime) throw new ApiError('NOT_FOUND', 'Anime not found', 404);
    const attempts: PlaybackAttempt[] = [];
    const audio = request.audio ?? 'sub';
    const candidates = ordered(all, request.provider, request.fallback !== false);
    if (!candidates.length) throw new ApiError('UNAVAILABLE', 'No configured providers', 503);
    for (const provider of candidates) {
      if (deadline.aborted) break;
      if (!provider.configured) { attempts.push({ provider: provider.id, code: 'UNAVAILABLE', message: 'Provider is unconfigured' }); continue; }
      const providerSignal = AbortSignal.any([deadline, AbortSignal.timeout(10_000)]);
      try {
        const episode = await episodeFor(provider, anime, request.episode, audio, providerSignal);
        if (!episode) { attempts.push({ provider: provider.id, code: 'NOT_FOUND', message: 'Matching episode and audio unavailable' }); continue; }
        const servers = await withTimeout(child => provider.servers(episode.id, child), providerSignal);
        const matchingServers = servers.filter(server => server.audio === audio);
        const preferredServer = request.provider === provider.id ? request.serverId : undefined;
        const eligible = (preferredServer ? [...matchingServers.filter(server => server.id === preferredServer), ...(request.fallback !== false ? matchingServers.filter(server => server.id !== preferredServer) : [])] : matchingServers).slice(0, 6);
        if (!eligible.length) { attempts.push({ provider: provider.id, code: 'UNAVAILABLE', message: 'No matching server' }); continue; }
        for (const server of eligible) {
          if (excluded.includes(`${provider.id}:${server.id}`)) continue;
          if (providerSignal.aborted) break;
          try {
            const resolved = await withTimeout(child => provider.resolve(server.id, child), providerSignal);
            if (!resolved.sources.length) throw new ApiError('UNAVAILABLE', 'Server returned no sources', 502, provider.id);
            const expiresAt = Math.min(resolved.expiresAt ?? Infinity, Date.now() + mediaTokenTtlMs);
            const sources = await Promise.all(resolved.sources.map(async source => ({ ...source, url: await media.issue(source.url, resolved.headers, expiresAt, { hls: source.type === 'hls', playlistKey: resolved.playlistKey, audioLanguage: resolved.audioLanguage, mediaEncryption: resolved.mediaEncryption }) })));
            const subtitles = await Promise.all(resolved.subtitles.map(async subtitle => ({ ...subtitle, url: await media.issue(subtitle.url, resolved.headers, expiresAt) })));
            return { sources, subtitles, intro: resolved.intro, outro: resolved.outro, expiresAt, provider: provider.id, server, episode: request.episode, audio, attempts };
          } catch (error) {
            const failure = asApiError(error, provider.id);
            attempts.push({ provider: provider.id, server: server.id, code: failure.code, message: failure.message });
          }
        }
      } catch (error) {
        const failure = asApiError(error, provider.id);
        attempts.push({ provider: provider.id, code: failure.code, message: failure.message });
      }
    }
    const code = deadline.aborted ? 'TIMEOUT' : attempts.some(attempt => attempt.code === 'AMBIGUOUS_MATCH') ? 'AMBIGUOUS_MATCH' : 'UNAVAILABLE';
    const error = new ApiError(code, code === 'TIMEOUT' ? 'Playback resolution timed out' : 'No playable source found', code === 'AMBIGUOUS_MATCH' ? 409 : code === 'TIMEOUT' ? 504 : 503);
    throw Object.assign(error, { attempts });
  }

  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const controller = new AbortController();
    response.once('close', () => controller.abort());
    try {
      const authority = new URL(`http://${request.headers.host || 'localhost'}`);
      const host = authority.hostname.replace(/^\[|\]$/g, '').toLowerCase();
      if (!allowedHosts.has(host)) throw new ApiError('INVALID_REQUEST', 'Untrusted request host', 403);
      const oauthCallback = request.method === 'GET' && request.url?.split('?')[0] === '/api/v1/account/callback';
      if (!oauthCallback && request.headers['sec-fetch-site'] === 'cross-site') throw new ApiError('INVALID_REQUEST', 'Cross-site requests are not allowed', 403);
      if (request.headers.origin && new URL(request.headers.origin).host !== authority.host) throw new ApiError('INVALID_REQUEST', 'Cross-origin requests are not allowed', 403);
      const url = new URL(request.url ?? '/', authority);
      const path = url.pathname;
      const method = request.method ?? 'GET';
      if (path.startsWith('/media/')) {
        if (method !== 'GET' && method !== 'HEAD') throw new ApiError('INVALID_REQUEST', 'Method not allowed', 405);
        await media.handle(path.slice(7), method, typeof request.headers.range === 'string' ? request.headers.range : undefined, response, controller.signal);
        return;
      }
      if (!path.startsWith('/api/v1/')) throw new ApiError('NOT_FOUND', 'Route not found', 404);
      const route = path.slice(8);
      const localFile = /^downloads\/([a-f0-9-]{36})\/files\/(.+)$/.exec(route);
      if ((method === 'GET' || method === 'HEAD') && localFile) {
        await downloads.serve(localFile[1], localFile[2], method, request.headers.range, response, controller.signal);
        return;
      }
      if (method === 'GET' && route === 'downloads') {
        const result = await downloads.list();
        const address = request.socket.remoteAddress;
        result.canPickFolder &&= address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
        return send(response, 200, result);
      }
      if (method === 'PUT' && route === 'downloads/location') {
        if (!request.headers['content-type']?.startsWith('application/json')) throw new ApiError('INVALID_REQUEST', 'Expected JSON', 415);
        const input = await readJson(request);
        return send(response, 200, await downloads.setLocation((input as { location?: unknown })?.location));
      }
      if (method === 'POST' && route === 'downloads/pick-folder') {
        const address = request.socket.remoteAddress;
        if (process.platform !== 'win32' || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address || '')) throw new ApiError('INVALID_REQUEST', 'Choose a host folder using its absolute path.', 400);
        const script = "Add-Type -AssemblyName System.Windows.Forms; $picker = New-Object System.Windows.Forms.FolderBrowserDialog; $picker.Description = 'Choose a Moewatch download folder'; if ($picker.ShowDialog() -eq 'OK') { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::Write($picker.SelectedPath) }; $picker.Dispose()";
        const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true, timeout: 120000 });
        return send(response, 200, stdout.trim() ? await downloads.setLocation(stdout.trim()) : await downloads.list());
      }
      const removeDownload = /^downloads\/([a-f0-9-]{36})$/.exec(route);
      if (method === 'DELETE' && removeDownload) return send(response, 200, await downloads.remove(removeDownload[1]));
      if (method === 'POST' && route === 'downloads') {
        if (!request.headers['content-type']?.startsWith('application/json')) throw new ApiError('INVALID_REQUEST', 'Expected JSON', 415);
        const body = await readJson(request);
        const input = validatePlayback({ ...(body as object), episode: 1 });
        const quality = (body as { quality?: unknown })?.quality ?? 720;
        if (quality !== 480 && quality !== 720 && quality !== 1080) throw new ApiError('INVALID_REQUEST', 'Invalid download quality', 400);
        const anime = await animeById(input.animeId, controller.signal, true);
        if (!anime) throw new ApiError('NOT_FOUND', 'Anime not found', 404);
        const enriched = await enrichEpisodes(anime, controller.signal);
        const found = await availability(anime, controller.signal);
        const candidates = ordered(all, input.provider, input.fallback !== false).map(provider => provider.id);
        const episodes = found.filter(entry => candidates.includes(entry.provider)).flatMap(entry => entry.episodes).filter(episode => episode.kind === 'regular' && canTryEpisodeAudio(episode, input.audio || 'sub')).map(episode => episode.number);
        if (!episodes.length) throw new ApiError('UNAVAILABLE', 'No episodes are available in your preferred audio.', 503);
        return send(response, 202, { download: await downloads.enqueue(enriched, episodes, input, quality) });
      }
      if (method === 'POST' && route === 'discord/presence') {
        if (!request.headers['content-type']?.startsWith('application/json')) throw new ApiError('INVALID_REQUEST', 'Expected JSON', 415);
        const body = await readJson(request);
        if (body && typeof body === 'object' && 'clear' in body && body.clear === true) {
          if (!('session' in body) || typeof body.session !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(body.session)) throw new ApiError('INVALID_REQUEST', 'Invalid Discord session', 400);
          discord.clear(body.session);
          return send(response, 200, { ok: true });
        }
        const update = validateDiscordPlayback(body);
        if (!discord.enabled) return send(response, 200, { accepted: false });
        let anime = await animeById(update.animeId, controller.signal, true);
        if (anime && !anime.cover.startsWith('https://')) anime = await animeById(update.animeId, controller.signal);
        if (!anime || anime.episodes && update.episode > anime.episodes) throw new ApiError('NOT_FOUND', 'Episode not found', 404);
        const { user } = await account.status(request);
        return send(response, 200, { accepted: discord.update(update, anime, user) });
      }
      if (route.startsWith('account')) {
        const callbackUrl = new URL('/api/v1/account/callback', process.env.MOEWATCH_PUBLIC_ORIGIN || authority.origin).toString();
        if (method === 'GET' && route === 'account') return send(response, 200, await account.status(request));
        if (method === 'POST' && route === 'account/login/start') return send(response, 200, await account.startLogin(request, response, controller.signal));
        if (method === 'POST' && route === 'account/login/poll') return send(response, 200, await account.pollLogin(request, response, controller.signal));
        if (method === 'POST' && route === 'account/login/cancel') { account.cancelLogin(request, response); return send(response, 200, { ok: true }); }
        if (method === 'GET' && route === 'account/login') {
          const publicOrigin = process.env.MOEWATCH_PUBLIC_ORIGIN;
          // OAuth state and session cookies must share the callback's host.
          if (publicOrigin && new URL(publicOrigin).host !== authority.host) {
            response.writeHead(302, { location: new URL('/api/v1/account/login', publicOrigin).toString(), 'cache-control': 'no-store' });
            response.end();
            return;
          }
          return account.login(response, callbackUrl);
        }
        if (method === 'GET' && route === 'account/callback') return account.callback(request, response, url.searchParams.get('code'), url.searchParams.get('state'), callbackUrl, controller.signal);
        if (method === 'POST' && route === 'account/logout') { account.logout(request, response); return send(response, 200, { ok: true }); }
        if (method === 'GET' && route === 'account/list') return send(response, 200, { entries: await account.list(request, controller.signal) });
        if (method === 'PUT' && route === 'account/list') {
          if (!request.headers['content-type']?.startsWith('application/json')) throw new ApiError('INVALID_REQUEST', 'Expected application/json', 415);
          return send(response, 200, { entry: await account.upsert(request, await readJson(request), controller.signal) });
        }
        const entry = /^account\/list\/(\d+)$/.exec(route);
        if (method === 'DELETE' && entry) { await account.remove(request, positive(entry[1]), controller.signal); return send(response, 200, { ok: true }); }
      }
      if (method === 'GET' && route === 'health') return send(response, 200, { status: 'ok' });
      if (method === 'GET' && route === 'providers') return send(response, 200, { providers: all.map(provider => ({ id: provider.id, name: provider.name, configured: provider.configured, status: provider.configured ? 'configured' : 'unconfigured', note: provider.note })) });
      if (method === 'GET' && route === 'catalog') {
        const search = url.searchParams.get('search')?.trim().slice(0, 100) || undefined;
        const genre = url.searchParams.get('genre')?.trim().slice(0, 60) || undefined;
        return send(response, 200, { anime: await withTimeout(child => catalog.search({ search, genre }, child), controller.signal, 12_000) });
      }
      if (method === 'POST' && route === 'playback') {
        const input = validatePlayback(await readJson(request));
        const local = await downloads.playback(input.animeId, input.episode, input.audio || 'sub').catch(() => undefined);
        if (local) return send(response, 200, local);
        return send(response, 200, await withTimeout(child => playback(input, child), controller.signal, 25_000));
      }
      const thumbnail = /^anime\/(\d+)\/episodes\/(\d+)\/thumbnail$/.exec(route);
      if (method === 'GET' && thumbnail) {
        const id = positive(thumbnail[1]), number = positive(thumbnail[2]);
        const selected = preference(url.searchParams.get('provider'), true) ?? 'auto';
        const audio = audioPreference(url.searchParams.get('audio'));
        const fallback = url.searchParams.get('fallback') !== 'false';
        const anime = await animeById(id, controller.signal, true);
        if (!anime || anime.episodes && number > anime.episodes || number > 10000) throw new ApiError('NOT_FOUND', 'Episode not found', 404);
        // The detail page may still be displaying cached catalogue data; enforce source order here too.
        const enriched = await enrichEpisodes(anime, controller.signal);
        const existing = enriched.episodeArtwork?.find(e => e.number === number)?.thumbnail;
        const target = existing ? await media.issue(existing) : await providerThumbnail(anime, number, selected, audio, fallback, controller.signal);
        if (!target) throw new ApiError('NOT_FOUND', 'Episode thumbnail unavailable', 404);
        response.writeHead(302, { Location: target, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
        response.end();
        return;
      }
      const skip = /^anime\/(\d+)\/skip-times\/(\d+)$/.exec(route);
      if (method === 'GET' && skip) {
        const duration = Number(url.searchParams.get('duration'));
        if (!Number.isFinite(duration) || duration <= 0 || duration > 86400) throw new ApiError('INVALID_REQUEST', 'Invalid video duration', 400);
        return send(response, 200, await skipTimes(positive(skip[1]), positive(skip[2]), duration, controller.signal));
      }
      const match = /^anime\/(\d+)(?:\/(availability|episodes)(?:\/(\d+)\/servers)?)?$/.exec(route);
      if (method === 'GET' && match) {
        const id = positive(match[1]);
        const saved = await downloads.anime(id).catch(() => undefined);
        if (!match[2] && saved) return send(response, 200, { anime: saved });
        const anime = await animeById(id, controller.signal, Boolean(match[2]));
        if (!match[2]) return send(response, 200, { anime: anime ? await enrichEpisodes(anime, controller.signal) : anime });
        if (!anime) throw new ApiError('NOT_FOUND', 'Anime not found', 404);
        if (match[2] === 'availability') return send(response, 200, { animeId: id, providers: await availability(anime, controller.signal) });
        const selected = preference(url.searchParams.get('provider'), true);
        const audio = audioPreference(url.searchParams.get('audio'));
        const candidates = ordered(all, selected, !selected || selected === 'auto');
        for (const provider of candidates) {
          if (!provider.configured) continue;
          try {
            if (match[3]) {
              const episode = await episodeFor(provider, anime, positive(match[3]), audio, controller.signal);
              if (!episode) continue;
              const servers: ProviderServer[] = (await withTimeout(child => provider.servers(episode.id, child), controller.signal)).filter(server => server.audio === audio);
              return send(response, 200, { provider: provider.id, episodeId: episode.id, servers });
            }
            const titleId = await matched(provider, anime, controller.signal);
            if (!titleId) continue;
            const episodes = (await withTimeout(child => provider.episodes(titleId, child), controller.signal)).filter(episode => canTryEpisodeAudio(episode, audio));
            return send(response, 200, { animeId: id, provider: provider.id, episodes });
          } catch (error) {
            if (selected && selected !== 'auto') throw error;
          }
        }
        throw new ApiError('UNAVAILABLE', 'No matching provider content', 503);
      }
      throw new ApiError('NOT_FOUND', 'Route not found', 404);
    } catch (error) {
      const failure = asApiError(error);
      send(response, failure.status, { error: { code: failure.code, message: failure.message, provider: failure.provider }, attempts: (error as { attempts?: PlaybackAttempt[] })?.attempts });
    }
  };
  return Object.assign(handler, { close: () => {
    if (closed) return;
    closed = true;
    discord.close(); media.close(); void downloads.close().catch(() => {});
  } });
}

export function createServer(options: AppOptions = {}) {
  const handler = createApiHandler(options);
  const server = nodeServer((request, response) => { void handler(request, response); });
  server.on('close', () => handler.close());
  return server;
}
