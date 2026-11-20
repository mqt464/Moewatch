import { createServer } from 'node:http';
import { connect, type Socket } from 'node:net';
import { Impit } from 'impit';
import { ApiError } from './errors';
import { validated } from './network';

const hosts = new Set(['www.miruro.tv', 'miruro.tv', 'embed.settlar.io', 'media.settlar.io']);
export const providerNetwork = { validated };

export async function directProviderRequest(input: string | URL, options: {
  signal: AbortSignal; headers?: HeadersInit; method?: 'GET' | 'HEAD'; maxBytes?: number;
}): Promise<Response> {
  const url = new URL(input);
  if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.port || url.username || url.password || url.hash) {
    throw new ApiError('UPSTREAM_BLOCKED', 'Unsafe provider HTTP URL', 403);
  }
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(15_000)]);
  signal.throwIfAborted();
  const ceiling = (url.hostname === 'media.settlar.io' ? 32 : 8) * 1024 * 1024;
  const maxBytes = options.maxBytes ?? ceiling;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > ceiling) {
    throw new ApiError('INVALID_REQUEST', 'Invalid provider HTTP size limit', 400);
  }
  const pinned = await providerNetwork.validated(url);
  signal.throwIfAborted();
  // Impit cannot pin DNS itself. A private CONNECT tunnel preserves SNI and the validated address.
  const sockets = new Set<Socket>();
  const proxy = createServer((_req, res) => res.writeHead(403).end());
  proxy.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
  });
  proxy.on('connect', (request, socket, head) => {
    if (request.url !== `${url.hostname}:443` || head.length) { socket.destroy(); return; }
    const upstream = connect({ host: pinned.address, port: 443 }, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      socket.pipe(upstream).pipe(socket);
    });
    sockets.add(upstream);
    upstream.setTimeout(15_000, () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
    upstream.on('close', () => { sockets.delete(upstream); socket.destroy(); });
    socket.on('close', () => upstream.destroy());
  });
  const abort = () => { for (const socket of sockets) socket.destroy(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      proxy.once('error', reject);
      proxy.listen(0, '127.0.0.1', resolve);
    });
    signal.throwIfAborted();
    const address = proxy.address();
    if (!address || typeof address === 'string') throw new Error('Provider tunnel unavailable');
    const client = new Impit({ browser: 'chrome', proxyUrl: `http://127.0.0.1:${address.port}`, timeout: 15_000 });
    const headers = new Headers({ Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9',
      Referer: `${url.origin}/`, 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty' });
    for (const [name, value] of new Headers(options.headers)) {
      if (/^(accept|range|if-range|if-none-match|if-modified-since|origin|referer|x-settlar-key-proof)$/i.test(name)) headers.set(name, value);
    }
    const response = await client.fetch(url, { signal, headers, method: options.method ?? 'GET', redirect: 'error' });
    const chunks: Uint8Array[] = [];
    let length = 0;
    const reader = response.body?.getReader();
    try {
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        signal.throwIfAborted();
        length += value.byteLength;
        if (length > maxBytes) throw new ApiError('UPSTREAM_ERROR', 'Provider HTTP response is too large', 502);
        chunks.push(value);
      }
    } finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
    const resultHeaders = new Headers(response.headers);
    for (const name of ['content-encoding', 'transfer-encoding', 'connection', 'set-cookie']) resultHeaders.delete(name);
    if (options.method !== 'HEAD') resultHeaders.delete('content-length');
    return new Response(options.method === 'HEAD' || [204, 205, 304].includes(response.status) ? null : Buffer.concat(chunks), { status: response.status, headers: resultHeaders });
  } finally {
    signal.removeEventListener('abort', abort);
    abort();
    await new Promise<void>(resolve => proxy.close(() => resolve()));
  }
}
