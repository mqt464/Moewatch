import { spawn, type ChildProcess } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { accessSync, constants, readdirSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { BlockList, connect, isIP, type Socket } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { ApiError } from './errors';

const hosts = ['www.miruro.tv', 'miruro.tv', 'embed.settlar.io', 'media.settlar.io'];
const mediaHost = 'media.settlar.io';
const requestTimeout = 15_000;
const maxConcurrent = 4;
const diagnostics = () => process.env.MOEWATCH_BROWSER_DIAGNOSTICS === '1';

function trace(event: string) {
  if (diagnostics()) console.error(`[provider browser] ${event}`);
}

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) {
  blocked.addSubnet(address, prefix, 'ipv6');
}
const globalIpv6 = new BlockList();
globalIpv6.addSubnet('2000::', 3, 'ipv6');

export type BrowserDnsResolver = (host: string) => Promise<readonly { address: string }[]>;
let resolveAddresses: BrowserDnsResolver = host => lookup(host, { all: true, verbatim: true });

export async function setBrowserNetworkValidator(resolver?: BrowserDnsResolver): Promise<void> {
  await closeBrowser();
  resolveAddresses = resolver ?? (host => lookup(host, { all: true, verbatim: true }));
}

async function resolvePins(resolver: BrowserDnsResolver, signal: AbortSignal, names: readonly string[] = hosts) {
  const pins = new Map<string, string>();
  await Promise.all(names.map(async host => {
    try {
      const addresses = await abortable(resolver(host), signal);
      if (!addresses.length || addresses.some(({ address }) => {
        const family = isIP(address);
        if (family === 4) return blocked.check(address, 'ipv4');
        return family !== 6 || address.includes('%') || !globalIpv6.check(address, 'ipv6') || blocked.check(address, 'ipv6');
      })) return;
      const address = (addresses.find(item => isIP(item.address) === 4) ?? addresses[0]).address;
      pins.set(host, isIP(address) === 6 ? `[${address}]` : address);
    } catch { /* An unavailable host does not prevent requests to the other pinned hosts. */ }
  }));
  return pins;
}

function executable(): string | undefined {
  const configured = process.env.MOEWATCH_BROWSER_EXECUTABLE;
  const isWindows = process.platform === 'win32';
  const candidates: string[] = [];
  if (configured) candidates.push(resolve(configured));
  else {
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH;
    const cacheDir = cache === '0' ? resolve('node_modules/playwright-core/.local-browsers')
      : cache || (isWindows ? join(process.env.LOCALAPPDATA ?? homedir(), 'ms-playwright')
        : process.platform === 'darwin' ? join(homedir(), 'Library/Caches/ms-playwright')
          : join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'ms-playwright'));
    try {
      const builds = readdirSync(cacheDir).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
      for (const build of builds) {
        for (const path of [
          'chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux64/chrome', 'chrome-linux/chrome',
          'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
          'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
          'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
        ]) candidates.push(join(cacheDir, build, path));
      }
    } catch {}
    if (isWindows) {
      for (const dir of [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
        if (dir) candidates.push(join(dir, 'Google/Chrome/Application/chrome.exe'), join(dir, 'Microsoft/Edge/Application/msedge.exe'));
      }
    } else {
      candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
      for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
        for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'microsoft-edge']) candidates.push(join(dir, name));
      }
    }
  }
  return candidates.find(path => {
    try { accessSync(path, constants.X_OK); return statSync(path).isFile(); } catch { return false; }
  });
}

export function browserAvailable(): boolean {
  return !!executable();
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    void promise.then(resolve, reject).then(() => signal.removeEventListener('abort', abort));
  });
}

type PausedRequest = {
  requestId: string;
  request: { url: string; method: string; headers?: Record<string, string> };
  resourceType: string;
  redirectedRequestId?: string;
  responseStatusCode?: number;
  responseHeaders?: { name: string; value: string }[];
  responseErrorReason?: string;
};

type CdpMessage = {
  id?: number;
  result?: unknown;
  error?: { message: string };
  method?: string;
  sessionId?: string;
  params?: PausedRequest | { name: string; loaderId: string };
};

class BrowserDisconnected extends ApiError {
  readonly retryable = true;

  constructor(detail?: string) {
    super('UPSTREAM_ERROR', 'Provider browser disconnected' + (detail ? ` (${detail})` : ''));
  }
}

const hiddenUnavailable = 'Hidden target can be created only when remote debugging is enabled';

class Browser {
  private input: Writable;
  private id = 0;
  private pending = new Map<number, { method: string; resolve: (value: never) => void; reject: (error: Error) => void }>();
  readonly requests = new Map<string, (event: PausedRequest) => void>();
  readonly loaded = new Map<string, (loaderId: string) => void>();
  readonly attached = new Map<string, (session: string, type: string) => void>();
  readonly stopped = new AbortController();
  private exited: Promise<void>;
  private closing?: Promise<void>;

  constructor(private child: ChildProcess, private profile: string, readonly pins: ReadonlyMap<string, string>) {
    this.exited = new Promise(resolve => child.once('close', () => resolve()));
    this.input = child.stdio[3] as Writable;
    const output = child.stdio[4] as Readable;
    child.once('exit', (code, signal) => trace(`process exit code=${code} signal=${signal}`));
    child.on('error', () => void this.close('process error'));
    void this.exited.then(() => this.close('process exited'));
    this.input.on('error', () => void this.close('CDP write failed'));
    output.on('error', () => void this.close('CDP read failed'));
    output.on('end', () => void this.close('CDP pipe closed'));
    let message = '';
    output.setEncoding('utf8').on('data', (data: string) => {
      message += data;
      let end: number;
      while ((end = message.indexOf('\0')) !== -1) {
        if (end > 4 * 1024 * 1024) { void this.close('oversized CDP message'); return; }
        let reply: CdpMessage;
        try { reply = JSON.parse(message.slice(0, end)); }
        catch { void this.close('invalid CDP message'); return; }
        const { id, result, error, method, sessionId, params } = reply;
        message = message.slice(end + 1);
        if (id) {
          const command = this.pending.get(id);
          this.pending.delete(id);
          if (error && command) {
            const detail = error.message === hiddenUnavailable ? hiddenUnavailable : `Provider browser command failed (${command.method})`;
            command.reject(new ApiError('UPSTREAM_ERROR', detail));
          } else command?.resolve(result as never);
        } else if (sessionId && params) {
          if (method === 'Target.attachedToTarget') {
            const child = params as unknown as { sessionId: string; targetInfo: { type: string } };
            this.attached.get(sessionId)?.(child.sessionId, child.targetInfo.type);
          }
          if (method === 'Fetch.requestPaused' && 'requestId' in params) this.requests.get(sessionId)?.(params);
          if (method === 'Page.lifecycleEvent' && 'name' in params && params.name === 'DOMContentLoaded') {
            this.loaded.get(sessionId)?.(params.loaderId);
          }
        }
      }
      if (message.length > 4 * 1024 * 1024) void this.close('oversized CDP message');
    });
  }

  call<T = void>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    return new Promise((resolve, reject) => {
      this.stopped.signal.throwIfAborted();
      if (this.input.destroyed) throw new BrowserDisconnected('CDP pipe closed');
      const id = ++this.id;
      this.input.write(JSON.stringify({ id, method, params, sessionId }) + '\0');
      this.pending.set(id, { method, resolve, reject });
    });
  }

  close(detail?: string): Promise<void> {
    return this.closing ??= Promise.resolve().then(() => this.dispose(detail));
  }

  private async dispose(detail?: string) {
    trace(`close: ${detail ?? 'launch failed'}`);
    void this.call('Browser.close').catch(() => {});
    this.stopped.abort(new BrowserDisconnected(detail));
    for (const command of this.pending.values()) command.reject(this.stopped.signal.reason);
    this.pending.clear();
    this.requests.clear();
    this.loaded.clear();
    const kill = setTimeout(() => {
      if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
    }, 750).unref();
    await this.exited;
    clearTimeout(kill);
    await rm(this.profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => trace('profile cleanup failed'));
  }
}

type Launch = { stop: AbortController; ready: Promise<Browser> };
let launch: Launch | undefined;
let closing: Promise<void> | undefined;
let scenarioJob: Promise<unknown> | undefined;
let idle: ReturnType<typeof setTimeout> | undefined;
const active = new Set<AbortController>();
const requests = new Set<AbortController>();
const queue = new Set<() => void>();

function wakeNext() {
  const wake = queue.values().next().value;
  if (active.size < maxConcurrent && wake) {
    queue.delete(wake);
    wake();
  }
}

function releaseSlot(request: AbortController) {
  if (!active.delete(request)) return;
  wakeNext();
  if (!active.size && launch) {
    const current = launch;
    clearTimeout(idle);
    idle = setTimeout(() => {
      if (launch === current && !active.size && !requests.size) void stopBrowser('idle');
    }, 60_000).unref();
  }
}

async function launchBrowser(pins: ReadonlyMap<string, string>, signal: AbortSignal, proxyPort?: number): Promise<Browser> {
  const path = executable();
  if (!path) throw new ApiError('UPSTREAM_ERROR', 'Provider browser is unavailable');
  // A force-killed desktop sidecar cannot clean up; reclaim only profiles of dead owners.
  for (const name of readdirSync(tmpdir())) {
    const owner = /^moewatch-browser-(\d+)-/.exec(name)?.[1];
    if (!owner) continue;
    try { process.kill(Number(owner), 0); }
    catch (error) {
      const path = resolve(tmpdir(), name);
      if ((error as NodeJS.ErrnoException).code === 'ESRCH' && dirname(path) === resolve(tmpdir())) {
        await rm(path, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
  const profile = await mkdtemp(join(tmpdir(), `moewatch-browser-${process.pid}-`));
  let browser: Browser | undefined;
  try {
    signal.throwIfAborted();
    const rules = [...pins].map(([host, ip]) => `MAP ${host} ${ip}`);
    rules.push('MAP * ~NOTFOUND');
    if (proxyPort) rules.push('EXCLUDE 127.0.0.1');
    const connectivity = proxyPort ? [
      `--proxy-server=http://127.0.0.1:${proxyPort}`, '--proxy-bypass-list=<-loopback>',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    ] : ['--no-proxy-server'];
    const child = spawn(path, [
      `--user-data-dir=${profile}`, '--remote-debugging-pipe',
      '--no-startup-window', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
      ...connectivity, '--disable-quic', `--host-resolver-rules=${rules.join(',')}`,
    ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
    browser = new Browser(child, profile, pins);
    const deadline = AbortSignal.any([signal, browser.stopped.signal, AbortSignal.timeout(requestTimeout)]);
    const { product } = await abortable(browser.call<{ product: string }>('Browser.getVersion'), deadline);
    // Older Chromium versions ignore the hidden option and would open a visible window.
    const major = Number(/\/(\d+)\./.exec(product)?.[1]);
    if (!(major >= 157)) throw new ApiError('UPSTREAM_ERROR', 'Provider browser requires Chromium 157 or newer');
    trace(`started Chromium ${major}`);
    return browser;
  } catch (error) {
    if (browser) await browser.close();
    else await rm(profile, { recursive: true, force: true });
    throw error;
  }
}

function browserFor(pins: ReadonlyMap<string, string>): Promise<Browser> {
  if (!launch) {
    const stop = new AbortController();
    const ready = launchBrowser(pins, stop.signal);
    launch = { stop, ready };
    const invalidate = () => { if (launch?.ready === ready) launch = undefined; };
    void ready.then(browser => {
      if (browser.stopped.signal.aborted) invalidate();
      else browser.stopped.signal.addEventListener('abort', invalidate, { once: true });
    }, invalidate);
  }
  return launch.ready;
}

export function closeBrowser(): Promise<void> {
  return stopBrowser('shutdown');
}

async function stopBrowser(detail: string): Promise<void> {
  clearTimeout(idle);
  const current = launch;
  launch = undefined;
  for (const request of requests) request.abort(new BrowserDisconnected());
  current?.stop.abort(new BrowserDisconnected());
  const cleanup = current?.ready.then(browser => browser.close(detail), () => {});
  const pending = closing = Promise.all([closing, cleanup, scenarioJob?.catch(() => {})]).then(() => {});
  try { await pending; } finally { if (closing === pending) closing = undefined; }
}

function secureUrl(value: string | URL): URL | undefined {
  try {
    const raw = String(value);
    if (raw.length > 24_000 || raw.includes('#') || !/^https:\/\/[a-z0-9.-]+(?:[/?]|$)/i.test(raw)) return;
    const url = new URL(raw);
    if (!url.username && !url.password && !url.port && !isIP(url.hostname)) return url;
  } catch {}
}

function allowedUrl(value: string | URL): URL | undefined {
  const url = secureUrl(value);
  if (url && hosts.includes(url.hostname)) return url;
}

type ReaderState = {
  abort: AbortController;
  reader?: ReadableStreamDefaultReader<Uint8Array>;
  tail?: Uint8Array;
  size: number;
};

async function beginRead(url: string, method: string, headers: [string, string][], maxBytes: number) {
  const page = globalThis as typeof globalThis & { moewatch: ReaderState };
  const state = page.moewatch = { abort: new AbortController(), size: 0 } as ReaderState;
  const response = await fetch(url, { method, headers, credentials: 'omit', redirect: 'error', signal: state.abort.signal });
  if (method !== 'HEAD' && Number(response.headers.get('content-length')) > maxBytes) {
    state.abort.abort();
    return { tooLarge: true } as const;
  }
  if (method !== 'HEAD' && ![204, 205, 304].includes(response.status)) state.reader = response.body?.getReader();
  return { status: response.status, headers: [...response.headers], hasBody: !!state.reader };
}

async function pullRead(maxBytes: number) {
  const { moewatch: state } = globalThis as typeof globalThis & { moewatch: ReaderState };
  const chunks: string[] = [];
  const batchSize = 256 * 1024;
  let batch = 0;
  while (batch < batchSize) {
    if (!state.tail) {
      const { value, done } = await state.reader!.read();
      if (done) return { chunks, done };
      state.size += value.length;
      if (state.size > maxBytes) {
        state.abort.abort();
        return { tooLarge: true } as const;
      }
      if (!value.length) continue;
      state.tail = value;
    }
    const length = Math.min(state.tail.length, batchSize - batch);
    const part = state.tail.subarray(0, length);
    state.tail = length === state.tail.length ? undefined : state.tail.subarray(length);
    batch += length;
    // Uint8Array.toBase64 is available in Chromium 157.
    chunks.push((part as Uint8Array & { toBase64(): string }).toBase64());
  }
  return { chunks, done: false };
}

export interface BrowserRequestOptions {
  signal: AbortSignal;
  method?: 'GET' | 'HEAD';
  headers?: HeadersInit;
  maxBytes?: number;
  contextOrigin?: string;
}

const tooLarge = () => new ApiError('UPSTREAM_ERROR', 'Provider browser response is too large');

async function attachHiddenPage(browser: Browser, browserContextId: string, signal: AbortSignal): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const { targetId } = await abortable(browser.call<{ targetId: string }>('Target.createTarget', {
        url: 'about:blank', browserContextId, hidden: true,
      }), signal);
      const { sessionId } = await abortable(browser.call<{ sessionId: string }>('Target.attachToTarget', {
        targetId, flatten: true,
      }), signal);
      return sessionId;
    } catch (error) {
      if (attempt === 10 || !(error instanceof Error) || error.message !== hiddenUnavailable) throw error;
      await delay(100, undefined, { signal });
    }
  }
}

async function fetchInBrowser(browser: Browser, target: URL, context: URL, method: string, headers: Headers,
  maxBytes: number, signal: AbortSignal): Promise<Response> {
  // Keep allocation results available for disposal even when the caller aborts mid-command.
  const allocation = browser.call<{ browserContextId: string }>('Target.createBrowserContext', { disposeOnDetach: true });
  let sessionId: string | undefined;
  try {
    const { browserContextId } = await abortable(allocation, signal);
    sessionId = await attachHiddenPage(browser, browserContextId, signal);
    const session = sessionId;
    const call = <T = void>(name: string, params: object = {}) => abortable(browser.call<T>(name, params, session), signal);
    const evaluate = async <T>(expression: string): Promise<T> => {
      const reply = await call<{ result: { value: T }; exceptionDetails?: unknown }>('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true,
      });
      if (reply.exceptionDetails) throw new ApiError('UPSTREAM_ERROR', 'Provider browser fetch failed');
      return reply.result.value;
    };

    const document = new URL('/robots.txt', context).href;
    let documentStarted = false;
    let fetching = false;
    browser.requests.set(session, event => {
      const { requestId, resourceType, request, redirectedRequestId, responseStatusCode, responseErrorReason } = event;
      let name = 'Fetch.failRequest';
      let params: object = { requestId, errorReason: 'BlockedByClient' };
      if (allowedUrl(request.url) && !redirectedRequestId) {
        if (resourceType === 'Document' && request.url === document && request.method === 'GET') {
          if (responseStatusCode === 200) {
            // Commit an inert document at the real origin without running upstream HTML or scripts.
            name = 'Fetch.fulfillRequest';
            params = { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/plain; charset=utf-8' }], body: '' };
          } else if (!documentStarted && responseStatusCode === undefined && !responseErrorReason) {
            documentStarted = true;
            name = 'Fetch.continueRequest';
            params = { requestId, interceptResponse: true };
          }
        } else if (fetching && request.url === target.href &&
          ((resourceType === 'Fetch' || resourceType === 'XHR') && request.method === method || request.method === 'OPTIONS')) {
          name = 'Fetch.continueRequest';
          params = { requestId };
        }
      }
      void browser.call(name, params, session).catch(() => {});
    });
    await call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    const navigation = await call<{ errorText?: string }>('Page.navigate', { url: document });
    if (navigation.errorText || await evaluate<string>('location.origin') !== context.origin) {
      throw new ApiError('UPSTREAM_ERROR', 'Provider browser context failed to load');
    }
    fetching = true;
    const result = await evaluate<Awaited<ReturnType<typeof beginRead>>>(
      `(${beginRead.toString()})(${JSON.stringify(target.href)},${JSON.stringify(method)},${JSON.stringify([...headers])},${maxBytes})`,
    );
    if (result.tooLarge) throw tooLarge();
    const chunks: Buffer[] = [];
    let length = 0;
    if (result.hasBody) {
      for (;;) {
        const pull = await evaluate<Awaited<ReturnType<typeof pullRead>>>(`(${pullRead.toString()})(${maxBytes})`);
        if (pull.tooLarge) throw tooLarge();
        for (const chunk of pull.chunks) {
          const data = Buffer.from(chunk, 'base64');
          length += data.length;
          if (length > maxBytes) throw tooLarge();
          chunks.push(data);
        }
        if (pull.done) break;
      }
    }
    const responseHeaders = new Headers(result.headers);
    for (const name of ['content-encoding', 'transfer-encoding', 'connection', 'set-cookie']) responseHeaders.delete(name);
    if (method !== 'HEAD') responseHeaders.delete('content-length');
    const body = result.hasBody ? Buffer.concat(chunks, length) : null;
    return new Response(body, { status: result.status, headers: responseHeaders });
  } finally {
    if (sessionId) {
      browser.requests.delete(sessionId);
      if (signal.aborted) void browser.call('Runtime.evaluate', { expression: 'globalThis.moewatch?.abort.abort()' }, sessionId).catch(() => {});
    }
    const release = allocation.then(async ({ browserContextId }) => {
      try {
        await browser.call('Target.disposeBrowserContext', { browserContextId });
      } catch (error) {
        if (browser.stopped.signal.aborted) return;
        const contexts = await browser.call<{ browserContextIds: string[] }>('Target.getBrowserContexts');
        if (contexts.browserContextIds.includes(browserContextId)) throw error;
      }
    }).catch(error => {
      if (!browser.stopped.signal.aborted) throw error;
    });
    // Context disposal also cancels navigation and any in-flight renderer fetch.
    await abortable(release, AbortSignal.timeout(5000)).catch(() => browser.close('context disposal failed'));
  }
}

export async function browserRequest(value: string | URL, options: BrowserRequestOptions): Promise<Response> {
  const target = allowedUrl(value);
  const context = allowedUrl(options.contextOrigin ?? target?.origin ?? '');
  const method = options.method ?? 'GET';
  if (!target || !context || context.href !== context.origin + '/' ||
      context.origin !== target.origin && !(target.hostname === mediaHost && context.hostname === 'embed.settlar.io') ||
      method !== 'GET' && method !== 'HEAD') {
    throw new ApiError('UPSTREAM_BLOCKED', 'Unsafe provider browser URL or context', 403);
  }
  const ceiling = (target.hostname === mediaHost ? 32 : 8) * 1024 * 1024;
  const maxBytes = options.maxBytes ?? ceiling;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > ceiling) {
    throw new ApiError('INVALID_REQUEST', 'Invalid provider browser size limit', 400);
  }
  const headers = new Headers();
  for (const [name, value] of new Headers(options.headers)) {
    if (/^(accept|range|if-range|if-none-match|if-modified-since|x-requested-with)$/.test(name) ||
        name === 'x-settlar-key-proof' && target.hostname === mediaHost) headers.set(name, value);
  }
  const lifetime = new AbortController();
  requests.add(lifetime);
  const signal = AbortSignal.any([options.signal, lifetime.signal, AbortSignal.timeout(requestTimeout)]);
  let disposingContext = false;
  const acquire = async () => {
    while (active.size >= maxConcurrent) {
      let wake!: () => void;
      const slot = new Promise<void>(resolve => { wake = resolve; queue.add(wake); });
      try { await abortable(slot, signal); } finally { queue.delete(wake); }
    }
    signal.throwIfAborted();
    active.add(lifetime);
    clearTimeout(idle);
  };
  try {
    await acquire();
    const fetchWithRestart = async () => {
      for (let attempt = 0; ; attempt++) {
        signal.throwIfAborted();
        try {
          let ready = launch?.ready;
          if (!ready) {
            const pins = await resolvePins(resolveAddresses, AbortSignal.any([signal, AbortSignal.timeout(3000)]));
            signal.throwIfAborted();
            if (!pins.has(target.hostname) || !pins.has(context.hostname)) {
              throw new ApiError('UPSTREAM_BLOCKED', 'Provider browser host has no validated public address', 403);
            }
            ready = browserFor(pins);
          }
          const browser = await abortable(ready, signal);
          if (!browser.pins.has(target.hostname) || !browser.pins.has(context.hostname)) {
            throw new ApiError('UPSTREAM_BLOCKED', 'Provider browser host has no validated public address', 403);
          }
          return await fetchInBrowser(browser, target, context, method, headers, maxBytes,
            AbortSignal.any([signal, browser.stopped.signal]));
        } catch (error) {
          if (attempt || !(error instanceof BrowserDisconnected)) throw error;
          if (!signal.aborted) trace(`retry after ${error.message}`);
        }
      }
    };
    const response = fetchWithRestart();
    // Retain the slot while an aborted request disposes its browser context.
    disposingContext = true;
    const release = () => releaseSlot(lifetime);
    void response.then(release, release);
    return await abortable(response, signal);
  } finally {
    requests.delete(lifetime);
    if (!disposingContext) {
      releaseSlot(lifetime);
      wakeNext();
    }
  }
}

const scenarioHosts = {
  'mkissa-episode': ['mkissa.to', 'cdn.mkissa.net', 'api.mkissa.net'],
  'mkissa-player': ['bysekoze.com', 'n1mwq.org'],
} as const;

type BrowserScenario = keyof typeof scenarioHosts;
export interface BrowserScenarioPage {
  evaluate<T>(expression: string): Promise<T>;
  navigate(url: string): Promise<void>;
  addInitScript(source: string): Promise<void>;
  onRequest(listener: (url: string, headers?: Record<string, string>) => void): () => void;
}

async function scenarioProxy(pins: ReadonlyMap<string, string>) {
  // The CONNECT gate also covers workers and other requests outside the page's CDP session.
  const sockets = new Set<Socket>();
  const proxy = createServer((_req, res) => res.writeHead(403).end());
  proxy.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
  });
  proxy.on('connect', (request, socket, head) => {
    const host = /^([a-z0-9.-]+):443$/.exec(request.url ?? '')?.[1];
    const address = host && pins.get(host);
    if (!address || head.length) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const upstream = connect({ host: address.replace(/^\[|\]$/g, ''), port: 443 }, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      socket.pipe(upstream).pipe(socket);
    });
    upstream.setTimeout(requestTimeout, () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
    upstream.on('close', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen(0, '127.0.0.1', resolve);
  });
  const address = proxy.address();
  if (!address || typeof address === 'string') throw new ApiError('UPSTREAM_ERROR', 'Provider browser proxy is unavailable');
  return {
    port: address.port,
    close: () => new Promise<void>(resolve => {
      for (const socket of sockets) socket.destroy();
      proxy.close(() => resolve());
    }),
  };
}

const scenarioCsp = "sandbox allow-scripts allow-same-origin; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

async function runScenario<T>(name: BrowserScenario, signal: AbortSignal, callback: (page: BrowserScenarioPage) => Promise<T>): Promise<T> {
  const allowed = scenarioHosts[name];
  const pins = await resolvePins(resolveAddresses, AbortSignal.any([signal, AbortSignal.timeout(3000)]), allowed);
  signal.throwIfAborted();
  if (pins.size !== allowed.length) throw new ApiError('UPSTREAM_BLOCKED', 'Provider browser scenario host has no validated public address', 403);
  const proxy = await scenarioProxy(pins);
  let browser: Browser | undefined;
  try {
    const client = browser = await launchBrowser(pins, signal, proxy.port);
    const deadline = AbortSignal.any([signal, client.stopped.signal]);
    const { browserContextId } = await abortable(client.call<{ browserContextId: string }>('Target.createBrowserContext', { disposeOnDetach: true }), deadline);
    const session = await attachHiddenPage(client, browserContextId, deadline);
    const call = <R = void>(method: string, params: object) => {
      deadline.throwIfAborted();
      return abortable(client.call<R>(method, params, session), deadline);
    };
    await abortable(client.call('Browser.setDownloadBehavior', { behavior: 'deny', browserContextId }), deadline);
    let document: string | undefined;
    let documentStarted = false;
    const loaded = new Set<string>();
    let onLoaded: (() => void) | undefined;
    const observers = new Set<(url: string, headers?: Record<string, string>) => void>();
    client.loaded.set(session, id => {
      loaded.add(id);
      onLoaded?.();
    });
    const scripts: string[] = [];
    const handleRequests = (session: string) => (event: PausedRequest) => {
      const { requestId, request, resourceType, redirectedRequestId, responseStatusCode, responseErrorReason } = event;
      const url = secureUrl(request.url);
      if (diagnostics()) trace(`scenario ${name} ${resourceType} ${request.method} ${url?.hostname ?? 'non-https'} ${responseStatusCode ?? ''}`);
      const fail = () => client.call('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }, session);
      const continueRequest = (interceptResponse = false) => client.call('Fetch.continueRequest', { requestId, interceptResponse }, session);
      if (url && document && responseStatusCode === undefined && !responseErrorReason && !redirectedRequestId) {
        const referer = Object.entries(request.headers ?? {}).find(([name]) => name.toLowerCase() === 'referer')?.[1];
        for (const observer of observers) {
          try { observer(url.href, referer ? { referer } : undefined); } catch { /* Observers cannot affect network policy. */ }
        }
      }
      let resume: Promise<void>;
      if (!url || !pins.has(url.hostname) || !document || redirectedRequestId || responseErrorReason) {
        resume = fail();
      } else if (resourceType === 'Document') {
        const childFrame = name === 'mkissa-player' && url.hostname === 'n1mwq.org' && /^\/[a-z0-9_-]{1,128}\/[a-z0-9_-]{1,128}$/i.test(url.pathname);
        if ((!childFrame && url.href !== document) || request.method !== 'GET') resume = fail();
        else if (responseStatusCode === 200) {
          resume = client.call('Fetch.continueResponse', {
            requestId, responseCode: 200,
            responseHeaders: [...event.responseHeaders ?? [], { name: 'Content-Security-Policy', value: name === 'mkissa-player' ? scenarioCsp.replace("frame-src 'none'", 'frame-src https://n1mwq.org') : scenarioCsp }],
          }, session);
        } else if ((childFrame || !documentStarted) && responseStatusCode === undefined) {
          documentStarted = true;
          resume = continueRequest(true);
        } else resume = fail();
      } else {
        resume = responseStatusCode !== undefined ? client.call('Fetch.continueResponse', { requestId }, session) : resourceType !== 'Media' && resourceType !== 'Ping' &&
          ['GET', 'HEAD', 'POST', 'OPTIONS'].includes(request.method) ? continueRequest(name === 'mkissa-player' && (resourceType === 'XHR' || resourceType === 'Fetch')) : fail();
      }
      void resume.catch(() => {});
    };
    client.requests.set(session, handleRequests(session));
    client.attached.set(session, (child, type) => {
      void (async () => {
        if (type === 'iframe') {
          client.requests.set(child, handleRequests(child));
          await client.call('Page.enable', {}, child);
          for (const source of scripts) await client.call('Page.addScriptToEvaluateOnNewDocument', { source }, child);
          await client.call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, child);
        }
        await client.call('Runtime.runIfWaitingForDebugger', {}, child);
        if (type === 'iframe' && name === 'mkissa-player') {
          for (let attempt = 0; attempt < 10 && !deadline.aborted; attempt++) {
            await delay(500, undefined, { signal: deadline });
            await client.call('Runtime.evaluate', {
              expression: `if(location.hostname==='n1mwq.org'){const b=[...document.querySelectorAll('button,[role="button"]')].find(b=>/^(play|play video|start playback)$/i.test(b.getAttribute('aria-label')||b.textContent.trim()));if(b)b.click();}`,
              userGesture: true,
            }, child);
          }
        }
      })().catch(() => {});
    });
    await call('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    await call('Page.enable', {});
    await call('Page.setLifecycleEventsEnabled', { enabled: true });
    await call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    return await abortable(callback({
      async navigate(value) {
        const url = secureUrl(value);
        const validPath = name === 'mkissa-episode'
          ? url?.hostname === 'mkissa.to' && /^\/anime(?:\/[a-z0-9_-]{1,128}(?:\/p-[\d.]{1,12}-(?:sub|dub))?)?\/?$/i.test(url.pathname)
          : url?.hostname === 'n1mwq.org' && /^\/[a-z0-9_-]{1,128}\/[a-z0-9_-]{1,128}$/i.test(url.pathname) || url?.hostname === 'bysekoze.com' && /^\/e\/[a-z0-9_-]{1,128}$/i.test(url.pathname);
        if (!validPath || !url || url.search) throw new ApiError('UPSTREAM_BLOCKED', 'Unsafe provider browser scenario URL', 403);
        document = url.href;
        documentStarted = false;
        const result = await call<{ errorText?: string; loaderId?: string }>('Page.navigate', {
          url: document, ...(name === 'mkissa-player' ? { referrer: 'https://bysekoze.com/' } : {}),
        });
        if (result.errorText) throw new ApiError('UPSTREAM_ERROR', 'Provider browser scenario navigation failed');
        const id = result.loaderId;
        if (id && !loaded.has(id)) {
          await abortable(new Promise<void>(resolve => {
            onLoaded = () => { if (loaded.has(id)) resolve(); };
          }), deadline);
          onLoaded = undefined;
        }
      },
      async addInitScript(source) {
        if (source.length > 32_000) throw tooLarge();
        scripts.push(source);
        await call('Page.addScriptToEvaluateOnNewDocument', { source });
      },
      async evaluate<R>(expression: string) {
        if (expression.length > 32_000) throw tooLarge();
        const reply = await call<{ result: { value: R }; exceptionDetails?: unknown }>('Runtime.evaluate', {
          expression, awaitPromise: true, returnByValue: true, userGesture: true,
        });
        if (reply.exceptionDetails) throw new ApiError('UPSTREAM_ERROR', 'Provider browser scenario evaluation failed');
        if ((JSON.stringify(reply.result.value)?.length ?? 0) > 512_000) throw tooLarge();
        return reply.result.value;
      },
      onRequest(listener) {
        observers.add(listener);
        return () => { observers.delete(listener); };
      },
    }), deadline);
  } finally {
    await browser?.close('scenario finished');
    await proxy.close();
  }
}

export async function withBrowserScenario<T>(name: BrowserScenario, parent: AbortSignal,
  callback: (page: BrowserScenarioPage) => Promise<T>): Promise<T> {
  if (!Object.hasOwn(scenarioHosts, name)) throw new ApiError('UPSTREAM_BLOCKED', 'Unknown provider browser scenario', 403);
  const lifetime = new AbortController();
  const signal = AbortSignal.any([parent, lifetime.signal, AbortSignal.timeout(30_000)]);
  requests.add(lifetime);
  try {
    while (scenarioJob) await abortable(scenarioJob.then(() => {}, () => {}), signal);
    signal.throwIfAborted();
    const operation = scenarioJob = runScenario(name, signal, callback);
    const release = () => { if (scenarioJob === operation) scenarioJob = undefined; };
    void operation.then(release, release);
    return await abortable(operation, signal);
  } finally {
    requests.delete(lifetime);
  }
}
