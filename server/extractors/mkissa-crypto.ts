import { createCipheriv, createDecipheriv, createHash, createHmac } from 'node:crypto';
import { ApiError } from '../infrastructure/errors';
import { record } from '../providers/common';

// Public build-193 client constants recovered from CkL4bHwD.js, not user credentials.
export const mkissaBuild = '193';
export const mkissaEpochMs = 315_360_000_000;
const mask = Buffer.from('nBKBEWrlVikc0SV8gUw5hWidhrgmx1tiXLFUQnDKUXI=', 'base64');
const fail = () => new ApiError('UPSTREAM_ERROR', 'Invalid MKissa encrypted response', 502, 'mkissa');

export function mkissaBootstrapProof(epoch: number): string {
  const key = createHmac('sha256', mask).update(`ueQcEF8Ty:${mkissaBuild}`).digest();
  return createHmac('sha256', key).update(`k7:${mkissaBuild}:youtu-chan.com:mirror:${epoch}`).digest('hex');
}

export function decodeMkissaBootstrap(value: unknown, epoch: number, now = Date.now()) {
  const data = record(value);
  if (data?.epoch !== epoch || data.epochMs !== mkissaEpochMs || data.k !== 'k7' ||
      typeof data.switchAt !== 'number' || !Number.isSafeInteger(data.switchAt) || data.switchAt <= now ||
      typeof data.partB !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(data.partB)) throw fail();
  const part = Buffer.from(data.partB, 'base64');
  if (part.length !== 32 || part.toString('base64') !== data.partB) throw fail();
  return { epoch, key: Buffer.from(part.map((byte, index) => byte ^ mask[index])), expiresAt: data.switchAt };
}

export function mkissaRequestEnvelope(key: Buffer, epoch: number, queryHash: string, now = Date.now()): string {
  const ts = Math.floor(now / 300_000) * 300_000;
  const iv = createHash('sha256').update(`${epoch}:${mkissaBuild}:${queryHash}:${ts}:k7`).digest().subarray(0, 12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = JSON.stringify({ v: 1, ts, epoch, buildId: mkissaBuild, qh: queryHash, k: 'k7' });
  return Buffer.concat([Buffer.from([1]), iv, cipher.update(body), cipher.final(), cipher.getAuthTag()]).toString('base64');
}

export function decodeMkissaPayload(value: unknown, key: Buffer): unknown {
  try {
    if (typeof value !== 'string' || value.length > 8 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw fail();
    const bytes = Buffer.from(value, 'base64');
    if (bytes.length < 30 || bytes[0] !== 1 || bytes.toString('base64') !== value) throw fail();
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(1, 13));
    decipher.setAuthTag(bytes.subarray(-16));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(13, -16)), decipher.final()]).toString('utf8'));
  } catch { throw fail(); }
}
