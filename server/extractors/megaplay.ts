import { createDecipheriv } from 'node:crypto';
import { ApiError } from '../infrastructure/errors';

export function decryptMegaplay(token: unknown): Record<string, unknown> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,8192}$/.test(token)) throw new ApiError('UNSUPPORTED_MEDIA', 'Invalid Megaplay source token', 502, 'anikoto');
  const padded = (value: string, length: number) => Buffer.from(value.padEnd(length, '\0')).subarray(0, length);
  try {
    const decipher = createDecipheriv('aes-256-cbc', padded('i?LMTAx0Q6,:}50U', 32), padded("W0;27ToaUpl_P%'c", 16));
    const bytes = Buffer.concat([decipher.update(Buffer.from(token, 'base64url')), decipher.final()]);
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).file === 'string') return value as Record<string, unknown>;
  } catch {}
  throw new ApiError('UNSUPPORTED_MEDIA', 'Megaplay source encryption is unsupported', 502, 'anikoto');
}
