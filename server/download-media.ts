import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
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

export async function saveMedia(options: { url: string; directory: string; read: DownloadReader; quality: DownloadQuality; signal: AbortSignal; category?: SavedFile['category']; onProgress?: (progress: number, bytes: number) => void }) {
  const { directory, read, signal, quality } = options;
  const category = options.category || 'video';
  await mkdir(directory, { recursive: true });
  const files: SavedFile[] = [];
  const known = new Map<string, string>();
  let bytes = 0, finished = 0, discovered = 0;
  const report = () => options.onProgress?.(Math.min(.99, finished / Math.max(discovered, 1)), bytes);
  async function save(url: string, depth = 0, ancestors = new Set<string>()): Promise<string> {
    signal.throwIfAborted();
    if (depth > 6 || ancestors.has(url)) throw new Error('Invalid nested playlist');
    const existing = known.get(url);
    if (existing) return existing;
    if (++discovered > 30000) throw new Error('Too many download assets');
    const source = await read(url, signal);
    const playlist = /mpegurl/i.test(source.type);
    const name = `${known.size}.${playlist ? 'm3u8' : 'bin'}`;
    known.set(url, name);
    let size = 0;
    if (playlist) {
      let text = '';
      for await (const chunk of source.body) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) throw new Error('Playlist too large');
        text += chunk.toString('utf8');
      }
      if (!text.startsWith('#EXTM3U')) throw new Error('Invalid playlist');
      if (!text.includes('#EXT-X-STREAM-INF') && !text.includes('#EXT-X-ENDLIST')) throw new Error('Live streams cannot be downloaded');
      if (/#EXT-X-(?:KEY|SESSION-KEY):.*(?:METHOD=SAMPLE-AES|KEYFORMAT=)/.test(text)) throw new Error('This encrypted stream does not support downloads');
      text = selectVariant(text, quality);
      const next = new Set(ancestors).add(url);
      const lines = text.split(/\r?\n/);
      // Register the whole playlist first so progress advances across segments.
      const refs = [...new Set(lines.flatMap(line => line.startsWith('#') ? [...line.matchAll(/URI="([^"]+)"/g)].map(m => m[1]) : line.trim() ? [line.trim()] : []))];
      discovered += refs.length;
      const local = new Map<string, string>();
      for (const ref of refs) { discovered--; local.set(ref, await save(ref, depth + 1, next)); }
      text = lines.map(line => line.startsWith('#') ? line.replace(/URI="([^"]+)"/g, (_, uri: string) => `URI="${local.get(uri)}"`) : local.get(line.trim()) || line).join('\n');
      size = Buffer.byteLength(text);
      await writeFile(join(directory, name), text, { signal });
      bytes += size;
    } else {
      const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length; bytes += chunk.length;
        if (size > 4 * 1024 ** 3) { callback(new Error('Download asset is too large')); return; }
        options.onProgress?.(Math.min(.99, (finished + (source.length ? size / source.length : 0)) / Math.max(discovered, 1)), bytes);
        callback(null, chunk);
      } });
      await pipeline(Readable.from(source.body), meter, createWriteStream(join(directory, name), { flags: 'wx' }), { signal });
    }
    let type = source.type.split(';')[0].trim().toLowerCase();
    if (category === 'artwork' && !/^image\/(?:jpeg|png|webp|gif|avif)$/.test(type)) throw new Error('Unsupported artwork format');
    if (category === 'subtitles') type = 'text/plain; charset=utf-8';
    else if (category === 'video' && !/^(?:video\/(?:mp4|webm|mp2t)|audio\/(?:aac|mp4|mpeg)|application\/(?:octet-stream|vnd\.apple\.mpegurl|x-mpegurl))$/.test(type)) type = 'application/octet-stream';
    files.push({ name, type: playlist ? 'application/vnd.apple.mpegurl' : type, bytes: size, category });
    finished++; report();
    return name;
  }
  const entry = await save(options.url);
  options.onProgress?.(1, bytes);
  return { entry, files, bytes };
}
