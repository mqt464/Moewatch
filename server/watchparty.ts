import type { ServerResponse } from 'node:http';
import { emptyParty, isPartyPlayback, isPartyUpdate, newerPartyUpdate, type PartyAction, type PartyMember, type PartyPlayback, type PartyStatus, type PartyUpdate } from '../shared/watchparty';
import { ApiError } from './infrastructure/errors';

// The native Discord SDK adapter supplies authenticated identities and connected members.
// This boundary never accepts an identity or lobby membership from the web player.
export type DiscordPartyEvent =
  | { type: 'full' }
  | { type: 'diagnostic'; stage: string; code: number; status: number }
  | { type: 'invite'; animeId: number; episode: number }
  | { type: 'members'; room: string; self: string; members: PartyMember[]; reconnected?: boolean }
  | { type: 'message'; room: string; sender: string; data: unknown }
  | { type: 'disconnected' };
export interface DiscordPartyTransport {
  presence?(activity: object | null): Promise<void>;
  subscribe(listener: (event: DiscordPartyEvent) => void): () => void;
  advertise(playback: PartyPlayback | null): Promise<void>;
  send(update: PartyUpdate): Promise<void>;
  leave(): Promise<void>;
  close(): void;
}

export function createWatchparty(transport?: DiscordPartyTransport) {
  let state: PartyStatus = { ...emptyParty, enabled: !!transport };
  let localPlayback: PartyPlayback | null = null;
  let clock = 0;
  let blocked = false;
  let queue = Promise.resolve();
  let connection: { stage: string; code: number; status: number } | null = null;
  const streams = new Set<ServerResponse>();
  const publish = () => {
    for (const stream of streams) {
      if (!stream.write(`data: ${JSON.stringify(state)}\n\n`)) { streams.delete(stream); stream.end(); }
    }
  };
  function fail() {
    blocked = true;
    state = { ...state, playback: null, error: 'Watchparty sync disconnected. Leave the party to continue watching on your own.' };
    publish();
  }
  function send(action: PartyAction, playback: PartyPlayback) {
    if (!transport || !state.room || state.members.length < 2 || blocked) return;
    const { animeId, episode, time, paused, rate, at } = playback;
    const update: PartyUpdate = { animeId, episode, time, paused, rate, at, action, clock: ++clock, sender: state.self };
    state = { ...state, playback: update, error: '' };
    publish();
    const room = state.room;
    // Never retry control messages. An old play/pause command must not arrive after a newer one.
    queue = queue.then(async () => { if (!blocked && state.room === room) await transport.send(update); }).catch(() => { if (state.room === room) fail(); });
  }
  const unsubscribe = transport?.subscribe(event => {
    if (event.type === 'full') { state = { ...state, enabled: true, error: 'This watchparty is full. The limit is 10 people.' }; publish(); return; }
    if (event.type === 'diagnostic') { connection = { stage: event.stage, code: event.code, status: event.status }; return; }
    if (event.type === 'invite') { state = { ...state, destination: { animeId: event.animeId, episode: event.episode }, error: '' }; publish(); return; }
    if (event.type === 'disconnected') { if (state.room) fail(); return; }
    if (event.type === 'members') {
      const previous = state;
      const changedRoom = previous.room !== event.room;
      if (event.room) connection = null;
      if (changedRoom) { clock = 0; blocked = false; }
      if (event.reconnected) blocked = false;
      state = { ...state, room: event.room, self: event.self, members: event.members,
        active: event.members.length > 1 || !changedRoom && previous.active,
        playback: changedRoom ? null : state.playback, error: blocked ? state.error : '' };
      publish();
      const existing = previous.members.map(member => member.id).filter(id => event.members.some(member => member.id === id)).sort();
      const added = event.members.some(member => !previous.members.some(old => old.id === member.id));
      // One existing member welcomes a new guest; other clients do not echo the snapshot.
      const playback = state.playback || localPlayback;
      const coordinator = event.reconnected ? event.members.map(member => member.id).sort()[0] : existing[0];
      if (!changedRoom && (added || event.reconnected) && coordinator === state.self && playback) send('sync', playback);
      return;
    }
    if (blocked || event.room !== state.room || !state.members.some(member => member.id === event.sender)
      || !isPartyUpdate(event.data) || event.data.sender !== event.sender) return;
    clock = Math.max(clock, event.data.clock);
    if (!newerPartyUpdate(event.data, state.playback)) return;
    localPlayback = event.data;
    state = { ...state, playback: event.data, destination: null, error: '' };
    publish();
  });
  return {
    status: () => state,
    diagnostics: () => ({ hasPlayback: localPlayback !== null, connection }),
    stream(response: ServerResponse) {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
      response.write(`data: ${JSON.stringify(state)}\n\n`);
      streams.add(response);
      response.once('close', () => streams.delete(response));
    },
    async advertise(value: unknown) {
      if (value !== null && !isPartyPlayback(value)) throw new ApiError('INVALID_REQUEST', 'Invalid party playback', 400);
      localPlayback = value;
      if (transport) await transport.advertise(value);
    },
    action(value: unknown) {
      if (!value || typeof value !== 'object') throw new ApiError('INVALID_REQUEST', 'Invalid party action', 400);
      const p = value as PartyPlayback & { action: PartyAction };
      if (!isPartyPlayback(p) || !['play', 'pause', 'seek', 'episode'].includes(p.action)) throw new ApiError('INVALID_REQUEST', 'Invalid party action', 400);
      if (blocked) throw new ApiError('UNAVAILABLE', state.error, 503);
      localPlayback = p;
      send(p.action, p);
    },
    async leave() {
      blocked = true;
      await queue;
      try { await transport?.leave(); }
      catch { /* Leaving locally must remain possible when the native process or Discord is unavailable. */ }
      state = { ...emptyParty, enabled: !!transport };
      localPlayback = null;
      clock = 0; blocked = false;
      publish();
    },
    close() { unsubscribe?.(); transport?.close(); for (const stream of streams) stream.end(); streams.clear(); },
  };
}
