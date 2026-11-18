import { createConnection, type Socket } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { DiscordPlayback } from '../shared/discord';
import type { Anime } from '../src/catalog';
import { ApiError } from './infrastructure/errors';

export function validateDiscordPlayback(value: unknown): DiscordPlayback {
  const p = value as DiscordPlayback;
  if (!p || typeof p.session !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(p.session)
    || !Number.isSafeInteger(p.animeId) || p.animeId < 1
    || !Number.isSafeInteger(p.episode) || p.episode < 1 || p.episode > 10000
    || !Number.isFinite(p.duration) || p.duration <= 0 || p.duration > 86400
    || !Number.isFinite(p.time) || p.time < 0 || p.time > p.duration
    || !Number.isFinite(p.rate) || p.rate <= 0 || p.rate > 16 || typeof p.paused !== 'boolean') {
    throw new ApiError('INVALID_REQUEST', 'Invalid Discord playback update', 400);
  }
  return p;
}

export function discordActivity(p: DiscordPlayback, anime: Pick<Anime, 'title' | 'cover'>, now = Date.now()) {
  return {
    type: 3,
    details: anime.title.slice(0, 128),
    state: `Episode ${p.episode}${p.paused ? ' · Paused' : ''}`,
    ...(!p.paused ? { timestamps: { end: Math.ceil((now + (p.duration - p.time) / p.rate * 1000) / 1000) } } : {}),
    ...(anime.cover.startsWith('https://') ? { assets: { large_image: anime.cover, large_text: anime.title.slice(0, 128) } } : {}),
  };
}

function ipcPaths() {
  const roots = [...new Set([process.env.XDG_RUNTIME_DIR, process.env.TMPDIR, process.env.TMP, process.env.TEMP, tmpdir(), '/tmp'].filter(Boolean))] as string[];
  return Array.from({ length: 10 }, (_, n) => process.platform === 'win32'
    ? [`\\\\?\\pipe\\discord-ipc-${n}`]
    : roots.map(root => join(root, `discord-ipc-${n}`))).flat();
}

export function createDiscordPresence(clientId = process.env.MOEWATCH_DISCORD_APP_ID ?? '1572285226464317492', paths = ipcPaths()) {
  let socket: Socket | undefined;
  let ready = false;
  let activity: ReturnType<typeof discordActivity> | null = null;
  let owner = '';
  let expires = 0;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let connecting = false;

  function write(opcode: number, data: unknown) {
    if (!socket || socket.destroyed) return;
    const body = Buffer.from(JSON.stringify(data));
    const header = Buffer.alloc(8);
    header.writeUInt32LE(opcode); header.writeUInt32LE(body.length, 4);
    socket.write(Buffer.concat([header, body]));
  }
  function publish() {
    if (ready) write(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: randomUUID() });
  }
  function connect(index = 0) {
    if (index >= paths.length || !owner) { connecting = false; return; }
    connecting = true;
    const current = createConnection(paths[index]);
    socket = current;
    current.unref();
    let buffer = Buffer.alloc(0);
    let established = false;
    current.setTimeout(3000, () => current.destroy());
    current.on('connect', () => write(0, { v: 1, client_id: clientId }));
    current.on('error', () => {});
    current.on('close', () => {
      if (socket !== current) return;
      socket = undefined; ready = false;
      if (!established && owner) connect(index + 1);
      else connecting = false;
    });
    current.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 8) {
        const opcode = buffer.readUInt32LE(0), length = buffer.readUInt32LE(4);
        if (length > 1024 * 1024) { current.destroy(); return; }
        if (buffer.length < length + 8) return;
        const body = buffer.subarray(8, length + 8);
        buffer = buffer.subarray(length + 8);
        try {
          const data = JSON.parse(body.toString());
          if (opcode === 3) write(4, data);
          else if (opcode === 2) current.destroy();
          else if (data.evt === 'READY') {
            established = true; ready = true; connecting = false;
            current.setTimeout(0); publish();
          } else if (data.evt === 'ERROR') console.warn('Discord presence:', data.data?.message ?? 'RPC request failed');
        } catch { current.destroy(); return; }
      }
    });
  }
  function clear(session: string) {
    if (session !== owner) return;
    owner = ''; expires = 0; activity = null;
    clearTimeout(expiry); publish();
    const previous = socket;
    previous?.end();
    if (previous) setTimeout(() => previous.destroy(), 1000).unref();
    socket = undefined;
    ready = false; connecting = false;
  }
  return {
    enabled: /^\d+$/.test(clientId),
    update(p: DiscordPlayback, anime: Pick<Anime, 'title' | 'cover'>) {
      if (!/^\d+$/.test(clientId)) return false;
      if (owner && owner !== p.session && expires > Date.now()) return false;
      if (!owner && p.paused) return false;
      owner = p.session; expires = Date.now() + 60_000;
      clearTimeout(expiry); expiry = setTimeout(() => clear(p.session), 60_000); expiry.unref();
      activity = discordActivity(p, anime);
      if (ready) publish(); else if (!connecting) connect();
      return true;
    },
    clear,
    close() { clear(owner); },
  };
}
