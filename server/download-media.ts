import { createWriteStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { DownloadQuality } from '../shared/downloads';

export type DownloadReader = (url: string, signal: AbortSignal) => Promise<{ body: AsyncIterable<Buffer>; type: string; length: number }>;
export type SavedFile = { name: string; type: string; bytes: number; category: 'video' | 'artwork' | 'subtitles' };

export function selectVariant(text: string, quality: number): string {
  const lines = text.split(/\r?\n/);
  const variants = lines.flatMap((line, index) => {
    if (!line.startsWith('#EXT-X-STREAM-INF:')) return [];
    const height = Number(line.match(/RESOLUTION=\d+x(\d+)/)?.[1]) || 0;
    const bandwidth = Number(line.match(/[:,]BANDWIDTH=(\d+)/)?.[1]) || 0;
    const uri = lines.slice(index + 1).find(value => value.trim() && !value.startsWith('#'));
    return uri ? [{ line, uri, height, bandwidth }] : [];
  });
  if (!variants.length) return text;
  const ordered = [...variants].sort((a, b) => a.height - b.height || a.bandwidth - b.bandwidth);
  const selected = ordered.filter(item => item.height <= quality).at(-1) || ordered[0];
  const audio = selected.line.match(/(?:^|,)AUDIO="([^"]+)"/)?.[1];
  const subtitles = selected.line.match(/(?:^|,)SUBTITLES="([^"]+)"/)?.[1];
  return lines.filter(line => line.startsWith('#') && !/^#EXT-X-(?:STREAM-INF|I-FRAME-STREAM-INF|IMAGE-STREAM-INF|MEDIA):/.test(line))
    .concat(lines.filter(line => line.startsWith('#EXT-X-MEDIA:') && (audio && line.includes(`GROUP-ID="${audio}"`) || subtitles && line.includes(`GROUP-ID="${subtitles}"`))), selected.line, selected.uri).join('\n');
}

export function retryableDownloadError(error: unknown): boolean {
  const failure = error as { retryable?: boolean; code?: string };
  if (typeof failure?.retryable === 'boolean') return failure.retryable;
  return ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE', 'TIMEOUT', 'RATE_LIMITED'].includes(failure?.code || '');
}

export type DownloadProgress = { transferredBytes: number; totalBytes?: number };
type Asset = { url: string; name: string; playlist: boolean; text?: string; bytes: number; length?: number; duration: number; group?: string; complete: boolean; opened?: Awaited<ReturnType<DownloadReader>> };

export async function saveMedia(options: { url: string; directory: string; read: DownloadReader; quality: DownloadQuality; signal: AbortSignal; category?: SavedFile['category']; onProgress?: (progress: number, bytes: number, estimate?: DownloadProgress) => void }) {
  const { directory, read, quality } = options;
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  const category = options.category || 'video';
  await mkdir(directory, { recursive: true });
  const files: SavedFile[] = [];
  const known = new Map<string, Asset>();
  let transferredBytes = 0, bandwidth = 0, duration = 0, lastReport = 0;
  const binary = () => [...known.values()].filter(asset => !asset.playlist);
  function report(done = false, force = false) {
    if (!done && !force && Date.now() - lastReport < 100) return;
    lastReport = Date.now();
    const assets = binary();
    const bytes = [...known.values()].reduce((sum, asset) => sum + asset.bytes, 0);
    const measured = assets.filter(asset => asset.complete || asset.length);
    const measuredBytes = measured.reduce((sum, asset) => sum + (asset.length || asset.bytes), 0);
    const groups = new Map<string, Asset[]>();
    for (const asset of assets) if (asset.group && asset.duration) {
      const group = groups.get(asset.group) || []; group.push(asset); groups.set(asset.group, group);
    }
    const estimates = [...groups.values()].map(group => {
      const sampled = group.filter(asset => asset.complete || asset.length);
      const sampledDuration = sampled.reduce((sum, asset) => sum + asset.duration, 0);
      return sampledDuration ? sampled.reduce((sum, asset) => sum + (asset.length || asset.bytes), 0) / sampledDuration * group.reduce((sum, asset) => sum + asset.duration, 0) : undefined;
    });
    let totalBytes: number | undefined;
    if (assets.length && measured.length === assets.length) totalBytes = measuredBytes;
    else if (estimates.length && estimates.every(value => value !== undefined)) totalBytes = estimates.reduce<number>((sum, value) => sum + value!, 0) + assets.filter(asset => !asset.group).reduce((sum, asset) => sum + (asset.length || asset.bytes), 0);
    else if (bandwidth && duration) totalBytes = bandwidth * duration / 8;
    else if (!groups.size && measured.length) totalBytes = measuredBytes / measured.length * assets.length;
    if (totalBytes !== undefined) totalBytes = Math.max(bytes, totalBytes);
    const fallback = assets.length ? assets.filter(asset => asset.complete).length / assets.length : 0;
    options.onProgress?.(done ? 1 : Math.min(.99, totalBytes ? bytes / totalBytes : fallback), bytes, { transferredBytes, totalBytes });
  }
  async function retry<T>(operation: () => Promise<T>) {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      try { return await operation(); }
      catch (error) {
        if (signal.aborted || attempt >= 2 || !retryableDownloadError(error)) throw error;
        await delay(250 * 2 ** attempt, undefined, { signal });
      }
    }
  }
  async function plan(url: string, playlist: boolean | undefined, depth = 0, ancestors = new Set<string>()): Promise<string> {
    signal.throwIfAborted();
    if (depth > 6 || ancestors.has(url)) throw new Error('Invalid nested playlist');
    const existing = known.get(url);
    if (existing) return existing.name;
    if (known.size >= 30000) throw new Error('Too many download assets');
    const asset: Asset = { url, name: `${known.size}.bin`, playlist: !!playlist, bytes: 0, duration: 0, complete: false };
    known.set(url, asset);
    if (playlist === false) return asset.name;
    const text = await retry(async () => {
      const source = await read(url, signal);
      if (!/mpegurl/i.test(source.type)) {
        if (playlist) throw new Error('Expected an HLS playlist');
        asset.opened = source; asset.length = source.length || undefined;
        return undefined;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of source.body) {
        size += chunk.length; transferredBytes += chunk.length;
        if (size > 2 * 1024 * 1024) throw new Error('Playlist too large');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks).toString('utf8');
    });
    if (text === undefined) return asset.name;
    asset.playlist = true; asset.name = asset.name.replace('.bin', '.m3u8');
    if (!text.startsWith('#EXTM3U')) throw new Error('Invalid playlist');
    const master = text.includes('#EXT-X-STREAM-INF');
    if (!master && !text.includes('#EXT-X-ENDLIST')) throw new Error('Live streams cannot be downloaded');
    if (/#EXT-X-(?:KEY|SESSION-KEY):.*(?:METHOD=SAMPLE-AES|KEYFORMAT=)/.test(text)) throw new Error('This encrypted stream does not support downloads');
    const selected = selectVariant(text, quality);
    if (master) bandwidth = Number(selected.match(/AVERAGE-BANDWIDTH=(\d+)/)?.[1] || selected.match(/[:,]BANDWIDTH=(\d+)/)?.[1]) || bandwidth;
    const lines = selected.split(/\r?\n/);
    const next = new Set(ancestors).add(url);
    const local = new Map<string, string>();
    let segmentDuration = 0, playlistDuration = 0;
    for (const line of lines) {
      if (line.startsWith('#')) {
        if (line.startsWith('#EXTINF:')) segmentDuration = Number(line.slice(8).split(',')[0]) || 0;
        for (const match of line.matchAll(/URI="([^"]+)"/g)) local.set(match[1], await plan(match[1], line.startsWith('#EXT-X-MEDIA:'), depth + 1, next));
      } else if (line.trim()) {
        const ref = line.trim();
        local.set(ref, await plan(ref, master, depth + 1, next));
        if (!master) { const child = known.get(ref)!; child.duration += segmentDuration; child.group = url; playlistDuration += segmentDuration; segmentDuration = 0; }
      }
    }
    duration = Math.max(duration, playlistDuration);
    asset.text = lines.map(line => line.startsWith('#') ? line.replace(/URI="([^"]+)"/g, (_, uri: string) => `URI="${local.get(uri)}"`) : local.get(line.trim()) || line).join('\n');
    return asset.name;
  }
  async function transfer(asset: Asset) {
    const path = join(directory, asset.name);
    await retry(async () => {
      asset.bytes = 0;
      await rm(path, { force: true });
      const source = asset.opened || await read(asset.url, signal);
      asset.opened = undefined;
      asset.length = source.length || undefined;
      const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        const firstChunk = asset.bytes === 0;
        asset.bytes += chunk.length; transferredBytes += chunk.length;
        if (asset.bytes > 4 * 1024 ** 3) { callback(new Error('Download asset is too large')); return; }
        report(false, firstChunk); callback(null, chunk);
      } });
      try {
        await pipeline(Readable.from(source.body), meter, createWriteStream(path, { flags: 'wx' }), { signal });
        if (source.length && asset.bytes !== source.length) throw Object.assign(new Error('Download was truncated'), { code: 'ERR_STREAM_PREMATURE_CLOSE' });
      } catch (error) { asset.bytes = 0; await rm(path, { force: true }); report(); throw error; }
      let type = source.type.split(';')[0].trim().toLowerCase();
      if (category === 'artwork' && !/^image\/(?:jpeg|png|webp|gif|avif)$/.test(type)) throw new Error('Unsupported artwork format');
      if (category === 'subtitles') type = 'text/plain; charset=utf-8';
      else if (category === 'video' && !/^(?:video\/(?:mp4|webm|mp2t)|audio\/(?:aac|mp4|mpeg)|application\/(?:octet-stream|vnd\.apple\.mpegurl|x-mpegurl))$/.test(type)) type = 'application/octet-stream';
      files.push({ name: asset.name, type, bytes: asset.bytes, category });
      asset.complete = true; report();
    });
  }
  try {
    const entry = await plan(options.url, undefined);
    report();
    const groups = new Map<string, Asset[]>();
    for (const asset of binary()) { const group = groups.get(asset.group || '') || []; group.push(asset); groups.set(asset.group || '', group); }
    const assets: Asset[] = [];
    const iterators = [...groups.values()].map(group => group.values());
    let added = true;
    while (added) {
      added = false;
      for (const iterator of iterators) { const item = iterator.next(); if (!item.done) { assets.push(item.value); added = true; } }
    }
    let next = 0, failure: unknown;
    await Promise.allSettled(Array.from({ length: Math.min(4, assets.length) }, async () => {
      try {
        while (next < assets.length) { signal.throwIfAborted(); await transfer(assets[next++]); }
      } catch (error) { failure ??= error; controller.abort(error); }
    }));
    if (failure) throw failure;
    signal.throwIfAborted();
    for (const asset of known.values()) if (asset.playlist) {
      await writeFile(join(directory, asset.name), asset.text!, { signal });
      asset.bytes = Buffer.byteLength(asset.text!); asset.complete = true;
      files.push({ name: asset.name, type: 'application/vnd.apple.mpegurl', bytes: asset.bytes, category });
    }
    report(true);
    return { entry, files, bytes: files.reduce((sum, file) => sum + file.bytes, 0) };
  } catch (error) { controller.abort(error); throw error; }
}
