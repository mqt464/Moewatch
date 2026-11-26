import { ApiError } from '../infrastructure/errors';
import type { ResolvedPlayback } from '../../shared/api';
import { request } from '../providers/common';

export function mkissaMp4UploadEmbed(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const code = /^https:\/\/(?:www\.)?mp4upload\.com\/embed-([a-z0-9]{12})\.html$/.exec(value)?.[1];
  return code ? `https://www.mp4upload.com/embed-${code}.html` : undefined;
}

export async function resolveMkissaMp4Upload(value: unknown, signal: AbortSignal): Promise<ResolvedPlayback> {
  signal.throwIfAborted();
  const embed = mkissaMp4UploadEmbed(value);
  if (!embed) throw new ApiError('INVALID_REQUEST', 'Invalid MKissa Mp4 embed URL', 400, 'mkissa');
  const html = await (await request(embed, 'mkissa', signal, 'https://filelotion.fyi/')).text();
  if (/File (?:was|has been) deleted|File (?:not found|does not exist)/i.test(html)) {
    throw new ApiError('UNAVAILABLE', 'The MKissa Mp4 file is unavailable', 404, 'mkissa');
  }
  // Parse the player's literal source; never evaluate the embed's scripts.
  const source = /\bplayer\.src\(\s*\{[^{}]*\bsrc\s*:\s*(["'])(https:\/\/[^"'<>\s\\]+)\1/i.exec(html)?.[2];
  let url: URL;
  try { if (!source || source.length > 4096) throw Error(); url = new URL(source); }
  catch { throw new ApiError('UNSUPPORTED_MEDIA', 'MKissa Mp4 has no supported direct source', 502, 'mkissa'); }
  if (url.protocol !== 'https:' || !/^a\d{1,3}\.mp4upload\.com$/.test(url.hostname) ||
      url.port && url.port !== '183' || url.username || url.password || url.hash ||
      !/^\/d\/[A-Za-z0-9_-]{32,512}\/video\.mp4$/.test(url.pathname)) {
    throw new ApiError('UNSUPPORTED_MEDIA', 'Unsafe MKissa Mp4 media URL', 502, 'mkissa');
  }
  return { sources: [{ url: url.href, type: 'mp4' }], subtitles: [], headers: { Referer: 'https://www.mp4upload.com/' } };
}
