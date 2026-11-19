import { isIP } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import type { AudioPreference, ResolvedPlayback } from '../../shared/api';
import { ApiError } from '../infrastructure/errors';

const siteOrigin = 'https://mkissa.to';
const byseOrigin = 'https://bysekoze.com';
const playerOrigin = 'https://n1mwq.org';
const timeoutMs = 25_000;

export interface MkissaBrowserPage {
  evaluate<T>(expression: string): Promise<T>;
  navigate(url: string): Promise<void>;
  addInitScript(source: string): Promise<void>;
  onRequest(listener: (url: string, headers?: Record<string, string>) => void): () => void;
}

export type MkissaEpisodeSource = { sourceName: string; sourceUrl: string };
type EpisodeRequest = { titleId: string; episode: string | number; audio: AudioPreference };
type EpisodeWindow = Window & { __moewatchMkissaEpisode?: {
  audio: AudioPreference;
  sources?: MkissaEpisodeSource[];
} };

function observeEpisode(origin: string, titleId: string, episode: string) {
  if (location.origin !== origin || window !== window.top) return;
  const state: NonNullable<EpisodeWindow['__moewatchMkissaEpisode']> = { audio: 'sub' };
  (window as EpisodeWindow).__moewatchMkissaEpisode = state;
  const decrypt = SubtleCrypto.prototype.decrypt;
  SubtleCrypto.prototype.decrypt = async function (...args) {
    const result = await decrypt.apply(this, args);
    try {
      const data = JSON.parse(new TextDecoder().decode(result)).episode;
      if (data?.show?._id === titleId && data.episodeString === episode &&
          typeof data.pageStatus?.pageId === 'string' && data.pageStatus.pageId.endsWith(`_${state.audio}_${episode}`) &&
          Array.isArray(data.sourceUrls)) {
        state.sources = (data.sourceUrls.slice(0, 64) as Partial<MkissaEpisodeSource>[]).flatMap(source => (
          typeof source?.sourceName === 'string' && typeof source.sourceUrl === 'string'
            ? [{ sourceName: source.sourceName, sourceUrl: source.sourceUrl }] : []
        ));
      }
    } catch {
      // Other client decryptions do not carry episode sources.
    }
    return result;
  };
}

function clickEpisode(path: string, subPath: string) {
  if (location.pathname !== path) return false;
  const card = document.querySelector<HTMLElement>(`[data-href$="${subPath}"]`);
  if (!card) return false;
  card.click();
  return true;
}

function clickDub(subPath: string) {
  if (location.pathname !== subPath) return false;
  const state = (window as EpisodeWindow).__moewatchMkissaEpisode;
  const dub = [...document.querySelectorAll<HTMLElement>('button,[role="radio"]')].find(element =>
    element.textContent?.trim() === 'Dub' && !element.matches(':disabled,[aria-disabled="true"]'));
  if (!state || !dub) return false;
  state.sources = undefined;
  state.audio = 'dub';
  dub.click();
  return true;
}

function readSources(path: string) {
  if (location.pathname === path) return (window as EpisodeWindow).__moewatchMkissaEpisode?.sources ?? null;
  return null;
}

function script(fn: (...args: never[]) => unknown, ...args: (string | undefined)[]) {
  // tsx emits a name annotation helper for nested functions.
  return `((__name) => (${fn.toString()})(${args.map(arg => arg === undefined ? 'undefined' : JSON.stringify(arg)).join(',')}))(value => value)`;
}

async function bounded<T>(signal: AbortSignal, step: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new ApiError('TIMEOUT', `MKissa ${step} timed out`, 504, 'mkissa')), timeoutMs);
  const active = AbortSignal.any([signal, controller.signal]);
  let cancel!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    cancel = () => reject(active.reason);
    active.addEventListener('abort', cancel, { once: true });
  });
  try {
    const result = await Promise.race([work(active), aborted]);
    active.throwIfAborted();
    return result;
  } finally {
    clearTimeout(timeout);
    active.removeEventListener('abort', cancel);
  }
}

async function poll<T>(read: () => Promise<T | null | false>, signal: AbortSignal): Promise<T> {
  for (;;) {
    signal.throwIfAborted();
    const value = await read();
    signal.throwIfAborted();
    if (value !== null && value !== false) return value;
    await delay(150, undefined, { signal });
  }
}

function mediaUrl(value: unknown): URL | undefined {
  if (typeof value !== 'string' || /[\s\\]/.test(value)) return;
  const authority = /^https:\/\/([^/?#]+)/.exec(value)?.[1];
  if (!authority || authority.includes('@')) return;
  const url = URL.parse(value);
  if (!url || url.username || url.password) return;
  const hostname = url.hostname.replace(/^\[|\]$|\.$/g, '');
  if (!hostname.includes('.') || hostname.endsWith('.localhost') || isIP(hostname)) return;
  return url;
}

export async function readMkissaEpisode(page: MkissaBrowserPage, request: EpisodeRequest, signal: AbortSignal): Promise<MkissaEpisodeSource[]> {
  signal.throwIfAborted();
  const { titleId, episode: rawEpisode, audio } = request ?? {};
  const episode = typeof rawEpisode === 'number' ? String(rawEpisode) : rawEpisode;
  if (typeof titleId !== 'string' || !/^[a-z0-9]{1,64}$/i.test(titleId) ||
      typeof episode !== 'string' || !/^(?:0|[1-9][0-9]{0,4})(?:\.[0-9]{1,5})?$/.test(episode) ||
      (audio !== 'sub' && audio !== 'dub')) {
    throw new ApiError('INVALID_REQUEST', 'Invalid MKissa episode request', 400, 'mkissa');
  }
  const path = `/anime/${titleId}`;
  const subPath = `${path}/p-${episode}-sub`;
  const audioPath = `${path}/p-${episode}-${audio}`;
  return bounded(signal, 'episode lookup', async active => {
    await page.addInitScript(script(observeEpisode, siteOrigin, titleId, episode));
    active.throwIfAborted();
    await page.navigate(siteOrigin + path);
    await poll(() => page.evaluate<boolean>(script(clickEpisode, path, subPath)), active);
    if (audio === 'dub') {
      await poll(() => page.evaluate<boolean>(script(clickDub, subPath)), active);
    }
    const sources = await poll(() => page.evaluate<MkissaEpisodeSource[] | null>(script(readSources, audioPath)), active);
    return Array.isArray(sources) ? sources.flatMap(source => {
      const url = mediaUrl(source?.sourceUrl);
      return typeof source?.sourceName === 'string' && source.sourceName.trim() && url
        ? [{ sourceName: source.sourceName, sourceUrl: url.href }] : [];
    }) : [];
  });
}

type HtmlTrack = { src: string; label: string; srclang: string };
type PlayerWindow = Window & { __moewatchMkissaTracks?: () => HtmlTrack[] };

function preparePlayer(iframeUrl: string, embedOrigin?: string) {
  if (embedOrigin) {
    // The public Byse embed can change the first segment of the n1mwq route.
    const expected = new URL(iframeUrl);
    if (window === parent || URL.parse(document.referrer)?.origin !== embedOrigin ||
        location.origin !== expected.origin || location.search || location.hash ||
        !/^\/[a-zA-Z0-9_-]{1,128}\/[a-zA-Z0-9_-]{1,128}$/.test(location.pathname) ||
        location.pathname.split('/')[2] !== expected.pathname.split('/')[2]) return;
  } else if (location.href !== iframeUrl) return;
  const tracks = () => [...document.querySelectorAll<HTMLTrackElement>('track[src]')]
    .filter(track => track.kind === 'subtitles' || track.kind === 'captions')
    .map(track => ({ src: track.src, label: track.label, srclang: track.srclang }));
  (window as PlayerWindow).__moewatchMkissaTracks = tracks;
  if (embedOrigin) {
    window.addEventListener('message', event => {
      if (event.origin === embedOrigin && event.source === parent && event.data === 'moewatch:mkissa-tracks') {
        parent.postMessage({ type: 'moewatch:mkissa-tracks', tracks: tracks() }, embedOrigin);
      }
    });
  }
  const play = setInterval(() => {
    const label = /^(?:play|play video|start playback)$/i;
    const button = [...document.querySelectorAll<HTMLElement>('button,[role="button"],.vjs-big-play-button,.plyr__control--overlaid,.jw-display-icon-container')]
      .find(element => element.getClientRects().length && !element.matches(':disabled,[aria-disabled="true"]') &&
        (label.test(element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '') ||
         element.matches('.vjs-big-play-button,.plyr__control--overlaid,.jw-display-icon-container')));
    const video = document.querySelector('video');
    if (!button && !video) return;
    clearInterval(play);
    if (button) button.click();
    else if (video?.paused) void video.play().catch(() => {});
  }, 150);
  setTimeout(() => clearInterval(play), 25_000);
}

function readPlayerTracks(iframeUrl: string, embedUrl?: string) {
  if (!embedUrl && location.href === iframeUrl) return (window as PlayerWindow).__moewatchMkissaTracks?.() ?? [];
  if (location.href !== embedUrl) return [];
  const expected = new URL(iframeUrl);
  const frame = [...document.querySelectorAll('iframe')].find(iframe => {
    const target = URL.parse(iframe.src);
    return target?.origin === expected.origin && target.pathname.split('/')[2] === expected.pathname.split('/')[2];
  })?.contentWindow;
  if (!frame) return [];
  return new Promise<HtmlTrack[]>(resolve => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== expected.origin || event.source !== frame || event.data?.type !== 'moewatch:mkissa-tracks' ||
          !Array.isArray(event.data.tracks)) return;
      window.removeEventListener('message', receive);
      clearTimeout(timeout);
      resolve(event.data.tracks);
    };
    const timeout = setTimeout(() => {
      window.removeEventListener('message', receive);
      resolve([]);
    }, 400);
    window.addEventListener('message', receive);
    frame.postMessage('moewatch:mkissa-tracks', expected.origin);
  });
}

function expiry(url: URL): number | undefined {
  const values = ['exp', 'expires', 'expiresAt', 'expires_at'].flatMap(key => url.searchParams.getAll(key));
  if (values.length !== 1 || !/^[1-9](?:\d{9}|\d{12})$/.test(values[0])) return;
  return values[0].length === 10 ? Number(values[0]) * 1000 : Number(values[0]);
}

export async function readMkissaPlayer(
  page: MkissaBrowserPage, iframeUrl: string, signal: AbortSignal, byseEmbedUrl?: string
): Promise<ResolvedPlayback> {
  signal.throwIfAborted();
  if (typeof iframeUrl !== 'string' || !/^https:\/\/n1mwq\.org\/[a-zA-Z0-9_-]{1,128}\/[a-zA-Z0-9_-]{1,128}$/.test(iframeUrl) ||
      byseEmbedUrl !== undefined && (typeof byseEmbedUrl !== 'string' || !/^https:\/\/bysekoze\.com\/e\/[a-zA-Z0-9_-]{1,128}$/.test(byseEmbedUrl))) {
    throw new ApiError('INVALID_REQUEST', 'Invalid MKissa player URL', 400, 'mkissa');
  }
  let unsubscribe = () => {};
  try {
    return await bounded(signal, 'player lookup', async active => {
      await page.addInitScript(script(preparePlayer, iframeUrl, byseEmbedUrl ? byseOrigin : undefined));
      active.throwIfAborted();
      const request = new Promise<URL>(resolve => {
        unsubscribe = page.onRequest((rawUrl, headers) => {
          const url = mediaUrl(rawUrl);
          // The player requests master.m3u8 before following any rendition playlist.
          if (!url?.pathname.endsWith('/master.m3u8')) return;
          for (const [name, value] of Object.entries(headers ?? {})) {
            if (/^(referer|origin)$/i.test(name) && URL.parse(value)?.origin !== playerOrigin) return;
          }
          resolve(url);
        });
      });
      await page.navigate(byseEmbedUrl ?? iframeUrl);
      const url = await request;
      active.throwIfAborted();
      const tracks = await page.evaluate<HtmlTrack[]>(script(readPlayerTracks, iframeUrl, byseEmbedUrl));
      const subtitles: ResolvedPlayback['subtitles'] = (Array.isArray(tracks) ? tracks : []).flatMap(track => {
        const url = mediaUrl(track?.src);
        if (!url || typeof track.label !== 'string' || typeof track.srclang !== 'string' || !(track.label || track.srclang)) return [];
        const extension = url.pathname.split('.').pop()?.toLowerCase();
        const format = extension === 'ass' || extension === 'srt' ? extension : 'vtt';
        return [{ url: url.href, label: track.label || track.srclang, language: track.srclang, format }];
      });
      const expiresAt = expiry(url);
      return { sources: [{ type: 'hls', url: url.href }], subtitles, headers: { Referer: playerOrigin + '/' },
        ...(expiresAt === undefined ? {} : { expiresAt }) };
    });
  } finally {
    unsubscribe();
  }
}
