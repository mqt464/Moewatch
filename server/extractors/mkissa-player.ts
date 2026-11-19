import { ApiError } from '../infrastructure/errors';
import { json, record } from '../providers/common';

const byseOrigin = 'https://bysekoze.com';
const playerOrigin = 'https://n1mwq.org';
const publicEmbedPath = /^\/e\/([a-z0-9_-]{1,128})$/i;
const playerPath = /^\/[a-z0-9_-]{1,128}\/[a-z0-9_-]{1,128}$/i;

function exactUrl(value: unknown, origin: string): URL | undefined {
  if (typeof value !== 'string' || !value.startsWith(origin + '/') || value.length > 512 ||
      /[\s%\\?#]/.test(value)) return;
  const url = new URL(value);
  if (url.origin === origin && url.href === value) return url;
}

export async function resolveMkissaPlayerEmbed(value: unknown, signal: AbortSignal): Promise<{
  url: string;
  referer: string;
}> {
  signal.throwIfAborted();
  const embed = exactUrl(value, byseOrigin);
  const code = embed && publicEmbedPath.exec(embed.pathname)?.[1];
  if (!embed || !code) throw new ApiError('INVALID_REQUEST', 'Invalid MKissa Fm-Hls embed URL', 400, 'mkissa');

  const details = record(await json(`${byseOrigin}/api/videos/${code}/embed/details`, 'mkissa', signal, embed.href));
  if (details?.owner_private === true) {
    throw new ApiError('UPSTREAM_BLOCKED', 'The MKissa Fm-Hls embed is private', 502, 'mkissa');
  }
  const frame = exactUrl(details?.embed_frame_url, playerOrigin);
  if (details?.code !== code || !frame || !playerPath.test(frame.pathname)) {
    throw new ApiError('UNSUPPORTED_MEDIA', 'Invalid MKissa Fm-Hls player iframe', 502, 'mkissa');
  }
  return { url: frame.href, referer: byseOrigin + '/' };
}
