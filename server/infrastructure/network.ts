import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ApiError } from './errors';
import { TtlCache } from './cache';
const dnsCache = new TtlCache<{ address: string; family: 4 | 6 }>(256, 30_000);

function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 88 && c === 99) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (isIP(address) === 6) {
    const first = Number.parseInt(address.split(':')[0], 16);
    return first >= 0x2000 && first <= 0x3fff && !/^2001:(?:db8|0):|^2002:/i.test(address);
  }
  return false;
}

export async function validated(url: URL): Promise<{ address: string; family: 4 | 6 }> {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname || url.port && !/^\d+$/.test(url.port)) {
    throw new ApiError('UNSUPPORTED_MEDIA', 'Unsafe media URL', 400);
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const cached = dnsCache.get(hostname);
  if (cached) return cached;
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await Promise.race([
    lookup(hostname, { all: true, verbatim: true }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new ApiError('TIMEOUT', 'Media DNS timed out', 504)), 3000).unref()),
  ]);
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new ApiError('UPSTREAM_BLOCKED', 'Media host is not public', 403);
  const first = addresses[0];
  const result = { address: first.address, family: first.family as 4 | 6 };
  dnsCache.set(hostname, result);
  return result;
}
