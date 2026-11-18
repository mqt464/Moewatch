import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDiscordPresence, discordActivity, validateDiscordPlayback } from '../discord';

const playback = { session: 'viewer-1', animeId: 1, episode: 5, time: 60, duration: 1440, rate: 1, paused: false };
const anime = { title: 'Example anime', cover: 'https://cdn.example.org/cover.jpg' };

test('presence uses CDN art and adjusts the timer for playback speed and pause', () => {
  const activity = discordActivity({ ...playback, rate: 2 }, anime, 100000);
  assert.equal(activity.type, 3);
  assert.equal(activity.assets?.large_image, anime.cover);
  assert.equal(activity.timestamps?.end, 790);
  const paused = discordActivity({ ...playback, paused: true }, { ...anime, cover: '/local.jpg' });
  assert.equal(paused.timestamps, undefined);
  assert.equal(paused.assets, undefined);
  assert.equal(paused.state, 'Episode 5 · Paused');
});

test('presence rejects invalid playback payloads', () => {
  assert.deepEqual(validateDiscordPlayback(playback), playback);
  for (const value of [null, {}, { ...playback, session: '../pipe' }, { ...playback, time: Infinity },
    { ...playback, time: 1500 }, { ...playback, rate: 0 }, { ...playback, paused: 'false' }, { ...playback, episode: -1 }]) {
    assert.throws(() => validateDiscordPlayback(value), /Invalid Discord playback/);
  }
});

test('IPC handshake, split frames, ownership, pause and clearing', async t => {
  const path = process.platform === 'win32' ? `\\\\?\\pipe\\moewatch-test-${randomUUID()}` : join(tmpdir(), `mw-${randomUUID()}.sock`);
  const connections = new Set<Socket>();
  const messages: Array<{ opcode: number; data: any }> = [];
  let notify: (() => void) | undefined;
  const server = createServer(socket => {
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));
    socket.on('error', () => {});
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 8 && buffer.length >= 8 + buffer.readUInt32LE(4)) {
        const opcode = buffer.readUInt32LE(0), length = buffer.readUInt32LE(4);
        const data = JSON.parse(buffer.subarray(8, 8 + length).toString());
        buffer = buffer.subarray(8 + length);
        messages.push({ opcode, data });
        if (opcode === 0) {
          const body = Buffer.from(JSON.stringify({ evt: 'READY' }));
          const frame = Buffer.alloc(8 + body.length);
          frame.writeUInt32LE(1); frame.writeUInt32LE(body.length, 4); body.copy(frame, 8);
          socket.write(frame.subarray(0, 5));
          setImmediate(() => socket.write(frame.subarray(5)));
        }
        notify?.();
      }
    });
  });
  await new Promise<void>(resolve => server.listen(path, resolve));
  const presence = createDiscordPresence('1572285226464317492', [path]);
  t.after(() => { presence.close(); for (const socket of connections) socket.destroy(); server.close(); });
  async function until(predicate: () => boolean) {
    while (!predicate()) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('IPC message timed out')), 2000);
        notify = () => { clearTimeout(timer); resolve(); };
      });
    }
  }
  assert.equal(presence.update({ ...playback, paused: true }, anime), false);
  assert.equal(presence.update(playback, anime), true);
  await until(() => messages.some(m => m.data.cmd === 'SET_ACTIVITY'));
  assert.deepEqual(messages[0].data, { v: 1, client_id: '1572285226464317492' });
  assert.equal(messages[1].data.args.activity.assets.large_image, anime.cover);
  assert.equal(presence.update({ ...playback, session: 'viewer-2' }, anime), false);
  presence.clear('viewer-2');
  assert.equal(presence.update({ ...playback, paused: true }, anime), true);
  await until(() => messages.some(m => m.data.args?.activity?.state === 'Episode 5 · Paused'));
  const paused = messages.at(-1)!.data.args.activity;
  assert.equal(paused.timestamps, undefined);
  presence.clear('viewer-1');
  await until(() => messages.some(m => m.data.cmd === 'SET_ACTIVITY' && m.data.args.activity === null));
  assert.equal(presence.update({ ...playback, session: 'viewer-2' }, anime), true);
});
