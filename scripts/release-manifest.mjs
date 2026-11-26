import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createHash, createPublicKey, verify } from 'node:crypto';

const [tag, installer] = process.argv.slice(2);
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(tag, `v${version}`);
assert.equal(basename(installer), `Moewatch_${version}_x64-setup.exe`);
const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
assert.equal(config.version, version);
const publicText = Buffer.from(config.plugins.updater.pubkey, 'base64').toString('utf8').trim();
const publicBytes = Buffer.from(publicText.split(/\r?\n/).at(-1), 'base64');
const signature = readFileSync(`${installer}.sig`, 'utf8').trim();
const lines = Buffer.from(signature, 'base64').toString('utf8').trim().split(/\r?\n/);
const raw = Buffer.from(lines[1], 'base64');
assert.equal(publicBytes.length, 42);
assert.equal(raw.length, 74);
assert.deepEqual(raw.subarray(2, 10), publicBytes.subarray(2, 10), 'Signing key differs from installed clients');
const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), publicBytes.subarray(10)]), format: 'der', type: 'spki' });
const bytes = readFileSync(installer);
assert.equal(raw.subarray(0, 2).toString(), 'ED', 'Expected prehashed Minisign signature');
assert(verify(null, createHash('blake2b512').update(bytes).digest(), key, raw.subarray(10)), 'Invalid installer signature');
assert(lines[2].startsWith('trusted comment: '));
assert(verify(null, Buffer.concat([raw.subarray(10), Buffer.from(lines[2].slice('trusted comment: '.length))]), key, Buffer.from(lines[3], 'base64')), 'Invalid signature comment');
const url = `https://github.com/mqt464/Moewatch/releases/download/${tag}/${basename(installer)}`;
writeFileSync(join(dirname(installer), 'latest.json'), JSON.stringify({ version, notes: 'Keep custom player controls in fullscreen on supported desktops and mobile browsers. Use native video fullscreen when element fullscreen is unavailable. Fix fullscreen exit state, subtitles, and portrait touch scrubbing.', pub_date: new Date().toISOString(), platforms: {
  'windows-x86_64': { signature, url }, 'windows-x86_64-nsis': { signature, url },
} }, null, 2) + '\n');
console.log(`Verified updater signature and manifest for ${tag}`);
