// Diagnostic only. This does not solve CAPTCHA or advertise working playback.
import { createHmac, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { Impit } from 'impit';
const mask = Buffer.from([69, 232, 122, 165, 0, 248, 30, 143, 143, 255, 217, 70, 236, 31, 113, 167, 139, 87, 109, 3, 175, 64, 19, 175, 212, 220, 42, 199, 249, 97, 234, 21].map(x => x ^ 32));
const epoch = Math.floor(Date.now() / 604800000);
const proof = createHmac('sha256', createHmac('sha256', mask).update('rEVwtVi:190').digest()).update(`mkissa.to~k7~190~mkissa~${epoch}`).digest('hex');
// Public build-190 client mask, recovered from B3DA467b.js. No session keys are persisted.
const boot = await (await fetch('https://api.mkissa.net/client-crypto/v1/bootstrap?buildId=190&k=k7', { headers: { 'x-build-id': '190', 'x-aa-boot': proof, Referer: 'https://mkissa.to/' } })).json();
if (typeof boot.partB !== 'string')
    throw new Error('MKissa bootstrap rejected');
console.log('bootstrap accepted', { epoch: boot.epoch, lane: boot.k });
const key = Buffer.from(boot.partB, 'base64').map((x, i) => x ^ mask[i]);
const hash = '670bbf38d0868f446e2346c1e956ca2c40c416e733ca248fd54e04f1c8b99145';
const ts = Math.floor(Date.now() / 300000) * 300000;
const iv = createHash('sha256').update(`${boot.epoch}:190:${hash}:${ts}:k7`).digest().subarray(0, 12);
const cipher = createCipheriv('aes-256-gcm', key, iv);
const req = Buffer.concat([Buffer.from([1]), iv, cipher.update(JSON.stringify({ v: 1, ts, epoch: boot.epoch, buildId: '190', qh: hash, k: 'k7' })), cipher.final(), cipher.getAuthTag()]).toString('base64');
const url = 'https://api.mkissa.net/api?' + new URLSearchParams({ variables: JSON.stringify({ showId: process.argv[2] || 'Qwi4hM3qzcwv9Rbaa', translationType: 'sub', episodeString: '1' }), extensions: JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hash }, k: 'k7', aaReq: req }) });
const r = await new Impit({ browser: 'chrome' }).fetch(url, { headers: { Referer: 'https://mkissa.to/', 'x-build-id': '190', 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', Origin: 'https://mkissa.to' } });
const body = await r.json();
console.log('episode', r.status, Object.keys(body), Object.keys(body.data || {}));
const enc = body.data?.tobeparsed;
console.log('envelope type', typeof enc, Array.isArray(enc), body.errors?.map(x => x.message));
if (typeof enc === 'string') {
    const bytes = Buffer.from(enc, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(1, 13));
    decipher.setAuthTag(bytes.subarray(-16));
    const decoded = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(13, -16)), decipher.final()]));
    console.log('decoded keys', Object.keys(decoded));
    console.log('source names', decoded.episode?.sourceUrls?.map(x => x.sourceName));
}
