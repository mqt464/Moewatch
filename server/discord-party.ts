import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import type { DiscordPartyEvent, DiscordPartyTransport } from './watchparty';
import type { PartyPlayback, PartyUpdate } from '../shared/watchparty';

export type NativeDiscordParty = DiscordPartyTransport & { presence(activity: object | null): Promise<void> };

export function createNativeDiscordParty(options: { binary?: string; applicationId?: string; dataDir?: string; launchCommand?: string; windowPid?: number; spawnProcess?: typeof spawn } = {}): NativeDiscordParty | undefined {
  const binary = options.binary || process.env.MOEWATCH_DISCORD_BRIDGE;
  const applicationId = options.applicationId ?? process.env.MOEWATCH_DISCORD_APP_ID ?? '1572285226464317492';
  if (process.env.MOEWATCH_DISABLE_DISCORD === '1' || process.platform !== 'win32' || !binary || !existsSync(binary) || !/^\d{1,20}$/.test(applicationId)) return;
  const tokenPath = resolve(options.dataDir || process.env.MOEWATCH_DATA_DIR || resolve(homedir(), '.moewatch'), 'discord-credentials.bin');
  const launch = options.launchCommand ?? process.env.MOEWATCH_DISCORD_LAUNCH_COMMAND ?? '';
  const pid = options.windowPid ?? Number(process.env.MOEWATCH_WINDOW_PID || 0);
  const listeners = new Set<(event: DiscordPartyEvent) => void>();
  const pending = new Map<number, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let child: ChildProcessWithoutNullStreams | undefined;
  let nextId = 0;
  let closed = false;
  let failed = false;
  let ready: Promise<void> | undefined;
  let readyResolve: (() => void) | undefined;
  let readyReject: ((error: Error) => void) | undefined;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  const emit = (event: DiscordPartyEvent) => { for (const listener of listeners) listener(event); };
  const fail = () => {
    if (failed || closed) return;
    failed = true;
    clearTimeout(startupTimer);
    const error = new Error('Discord watchparty connection unavailable');
    readyReject?.(error);
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
    pending.clear();
    emit({ type: 'disconnected' });
    child?.kill();
  };
  function start() {
    if (ready) return ready;
    ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    child = (options.spawnProcess || spawn)(binary!, [applicationId, tokenPath, launch, String(Number.isSafeInteger(pid) ? pid : 0)], {
      cwd: dirname(binary!), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.on('error', fail); child.on('exit', fail); child.stdin.on('error', fail);
    // SDK diagnostics can contain credentials. Never forward or persist native logs.
    child.stderr.resume();
    startupTimer = setTimeout(fail, 10000); startupTimer.unref();
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      if (line.length > 1048576) { fail(); return; }
      let value;
      try { value = JSON.parse(line); } catch { return; }
      if (!value || typeof value !== 'object') return;
      if (value.ready === true) { clearTimeout(startupTimer); readyResolve?.(); return; }
      if (value.id && pending.has(value.id)) {
        const request = pending.get(value.id)!; pending.delete(value.id); clearTimeout(request.timer);
        if (value.ok === true) request.resolve(); else request.reject(new Error('Discord watchparty request failed'));
        return;
      }
      const event = value.event;
      if (event?.type === 'diagnostic' && ['authorization', 'token', 'lobby', 'presence'].includes(event.stage)
        && Number.isSafeInteger(event.code) && Number.isSafeInteger(event.status)) { emit({ type: 'diagnostic', stage: event.stage, code: event.code, status: event.status }); return; }
      if (event?.type === 'invite' && Number.isSafeInteger(event.animeId) && event.animeId > 0
        && Number.isSafeInteger(event.episode) && event.episode > 0 && event.episode <= 10000) { emit(event); return; }
      if (event?.type === 'disconnected') { emit(event); return; }
      if (event?.type === 'members' && typeof event.room === 'string' && typeof event.self === 'string'
        && Array.isArray(event.members) && event.members.length <= 1000
        && event.members.every((member: { id: unknown; name: unknown; avatar: unknown }) => member && typeof member.id === 'string'
          && /^\d{1,20}$/.test(member.id) && typeof member.name === 'string' && typeof member.avatar === 'string')) emit(event);
      if (event?.type === 'message' && typeof event.room === 'string' && typeof event.sender === 'string') emit(event);
      if (value.error) fail();
    });
    void ready.catch(() => {});
    return ready;
  }
  async function request(type: string, body: object = {}) {
    if (closed || failed) throw new Error('Discord watchparty connection unavailable');
    await start();
    if (closed || failed || !child?.stdin.writable) throw new Error('Discord watchparty connection unavailable');
    if (pending.size >= 128) throw new Error('Too many pending watchparty commands');
    const id = ++nextId;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Discord watchparty request timed out')); }, 20000);
      timer.unref();
      pending.set(id, { resolve, reject, timer });
      child!.stdin.write(`${JSON.stringify({ id, type, ...body })}\n`, error => {
        if (!error) return;
        const item = pending.get(id); if (!item) return;
        pending.delete(id); clearTimeout(item.timer); item.reject(new Error('Discord watchparty connection unavailable'));
      });
    });
  }
  return {
    subscribe(listener) { listeners.add(listener); void start().catch(() => {}); return () => { listeners.delete(listener); }; },
    advertise: (playback: PartyPlayback | null) => request('advertise', { playback }),
    send: (playback: PartyUpdate) => request('send', { playback }),
    leave: () => request('leave'),
    presence: activity => request('presence', { activity }),
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(startupTimer);
      readyReject?.(new Error('Watchparty closed'));
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Watchparty closed')); }
      pending.clear(); listeners.clear();
      child?.stdin.end();
      const timeout = setTimeout(() => child?.kill(), 1500); timeout.unref();
      child?.once('exit', () => clearTimeout(timeout));
    },
  };
}
