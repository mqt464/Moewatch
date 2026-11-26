// Run with node --import tsx scripts/probe-mkissa-direct.mts [titleId] [sub|dub] [Yt-mp4|Mp4].
// Signed URLs and session keys stay in memory and are excluded from the output.
import assert from 'node:assert/strict';
import { mkissa } from '../server/providers/mkissa';
import { idEncode } from '../server/providers/common';

const titleId = process.argv[2] ?? 'Qwi4hM3qzcwv9Rbaa';
const audio = process.argv[3] ?? 'sub';
const source = process.argv[4] ?? 'Yt-mp4';
assert(audio === 'sub' || audio === 'dub');
assert(source === 'Yt-mp4' || source === 'Mp4');
const signal = AbortSignal.timeout(60_000);
const servers = await mkissa.servers(idEncode({ titleId, episode: '1' }), signal);
const server = servers.find(server => server.audio === audio && server.name === `MKissa ${source} (${audio})`);
assert(server, 'No supported direct server for the requested audio');
const playback = await mkissa.resolve(server.id, signal);
const response = await fetch(playback.sources[0].url, {
  signal, redirect: 'error', headers: { ...playback.headers, Range: 'bytes=0-1023' }
});
const sample = Buffer.from(await response.arrayBuffer());
assert.equal(response.status, 206);
assert.equal(sample.toString('ascii', 4, 8), 'ftyp');
console.log(JSON.stringify({ provider: 'mkissa', audio, server: server.name,
  type: playback.sources[0].type, status: response.status, bytes: sample.length, container: 'mp4' }));
