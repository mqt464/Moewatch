import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWatchparty, type DiscordPartyEvent, type DiscordPartyTransport } from '../watchparty';
import type { PartyUpdate } from '../../shared/watchparty';

const playback = { animeId: 1, episode: 1, time: 30, paused: false, rate: 1, at: 100000 };
const member = (id: string) => ({ id, name: `User ${id}`, avatar: '' });
function fixture() {
  let listener: (event: DiscordPartyEvent) => void = () => {};
  const sent: PartyUpdate[] = [];
  let fail = false;
  let leaveFails = false;
  const transport: DiscordPartyTransport = {
    subscribe(callback) { listener = callback; return () => { listener = () => {}; }; },
    async advertise() {}, async send(update) { if (fail) throw new Error('Rate limited'); sent.push(update); },
    async leave() { if (leaveFails) throw new Error('Native process stopped'); }, close() {},
  };
  const party = createWatchparty(transport);
  return { party, sent, event: (event: DiscordPartyEvent) => listener(event), fail: () => { fail = true; }, failLeave: () => { leaveFails = true; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('invite diagnostics retain safe failure codes without blocking solo playback and clear on lobby recovery', async () => {
  const f = fixture();
  await f.party.advertise(playback);
  f.event({ type: 'diagnostic', stage: 'lobby', code: 50001, status: 403 });
  assert.deepEqual(f.party.diagnostics(), { hasPlayback: true, connection: { stage: 'lobby', code: 50001, status: 403 } });
  assert.equal(f.party.status().error, '');
  f.event({ type: 'members', room: 'room', self: '10', members: [member('10')] });
  assert.equal(f.party.diagnostics().connection, null);
  f.party.close();
});

test('SDK absence stays disabled and does not break standalone playback', async () => {
  const party = createWatchparty();
  assert.equal(party.status().enabled, false);
  await party.advertise(playback);
  party.action({ ...playback, action: 'play' });
  assert.equal(party.status().playback, null);
  party.close();
});

test('accepted invites identify the episode before the first shared state arrives', () => {
  const f = fixture();
  f.event({ type: 'invite', animeId: 154587, episode: 3 });
  assert.deepEqual(f.party.status().destination, { animeId: 154587, episode: 3 });
  f.event({ type: 'members', room: 'room', self: '10', members: [member('10'), member('20')] });
  f.event({ type: 'message', room: 'room', sender: '20', data: { ...playback, action: 'sync', clock: 1, sender: '20' } });
  assert.equal(f.party.status().destination, null);
  f.party.close();
});

test('solo lobbies stay hidden and the last remaining participant can still leave an active party', () => {
  const f = fixture();
  f.event({ type: 'members', room: 'room', self: '10', members: [member('10')] });
  assert.equal(f.party.status().active, false);
  f.event({ type: 'members', room: 'room', self: '10', members: [member('10'), member('20')] });
  assert.equal(f.party.status().active, true);
  f.event({ type: 'members', room: 'room', self: '10', members: [member('10')] });
  assert.equal(f.party.status().active, true);
  f.party.close();
});

test('leaving a disconnected party clears local state even when the native helper has stopped', async () => {
  const f = fixture();
  f.event({ type: 'members', room: 'room', self: '10', members: [member('10'), member('20')] });
  f.event({ type: 'disconnected' });
  f.failLeave();
  await f.party.leave();
  assert.equal(f.party.status().room, '');
  assert.equal(f.party.status().error, '');
  assert.equal(f.party.status().active, false);
  f.party.close();
});

test('solo playback sends nothing; existing party sends one snapshot when a guest joins', async () => {
  const f = fixture();
  f.event({ type: 'members', room: 'room', self: '10', members: [member('10')] });
  await f.party.advertise(playback);
  f.party.action({ ...playback, action: 'pause' });
  await settle();
  assert.equal(f.sent.length, 0);
  f.event({ type: 'members', room: 'room', self: '10', members: [member('10'), member('20')] });
  await settle();
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].action, 'sync');
  f.party.close();
});

test('a new party never welcomes guests with playback cached before leaving', async () => {
  const f = fixture();
  await f.party.advertise(playback);
  await f.party.leave();
  f.event({ type: 'members', room: 'new-room', self: '10', members: [member('10')] });
  f.event({ type: 'members', room: 'new-room', self: '10', members: [member('10'), member('20')] });
  await settle();
  assert.equal(f.sent.length, 0);
  f.party.close();
});

test('only connected authenticated members can send controls; echoes and old messages send nothing', async () => {
  const f = fixture();
  f.event({ type: 'members', room: 'room', self: '10', members: [member('10'), member('20')] });
  const update: PartyUpdate = { ...playback, sender: '20', action: 'pause', clock: 2, paused: true };
  f.event({ type: 'message', room: 'wrong', sender: '20', data: update });
  f.event({ type: 'message', room: 'room', sender: '30', data: { ...update, sender: '30' } });
  f.event({ type: 'message', room: 'room', sender: '20', data: { ...update, sender: '10' } });
  assert.equal(f.party.status().playback, null);
  f.event({ type: 'message', room: 'room', sender: '20', data: update });
  assert.equal(f.party.status().playback?.paused, true);
  f.event({ type: 'message', room: 'room', sender: '20', data: { ...update, clock: 1, paused: false } });
  assert.equal(f.party.status().playback?.paused, true);
  await settle();
  assert.equal(f.sent.length, 0);
  f.party.action({ ...playback, action: 'play' });
  await settle();
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].clock, 3);
  f.party.close();
});

test('rate-limit failures stop queued sends and leave clears party state', async () => {
  const f = fixture();
  f.event({ type: 'members', room: 'room', self: '10', members: [member('10'), member('20')] });
  f.fail();
  f.party.action({ ...playback, action: 'pause' });
  f.party.action({ ...playback, action: 'play' });
  await settle();
  assert.match(f.party.status().error, /disconnected/);
  assert.equal(f.sent.length, 0);
  assert.throws(() => f.party.action({ ...playback, action: 'play' }), /disconnected/);
  await f.party.leave();
  assert.equal(f.party.status().room, '');
  assert.equal(f.party.status().error, '');
  f.party.close();
});

test('two clients share controls in either direction without feedback or shared preferences', async () => {
  const listeners = new Map<string, (event: DiscordPartyEvent) => void>();
  const sent: PartyUpdate[] = [];
  const make = (id: string): DiscordPartyTransport => ({
    subscribe(listener) { listeners.set(id, listener); return () => { listeners.delete(id); }; },
    async advertise() {}, async leave() {}, close() {},
    async send(update) {
      sent.push(update);
      for (const listener of listeners.values()) listener({ type: 'message', room: 'room', sender: id, data: update });
    },
  });
  const host = createWatchparty(make('10'));
  const guest = createWatchparty(make('20'));
  for (const [self, listener] of listeners) listener({ type: 'members', room: 'room', self, members: [member('10'), member('20')] });
  host.action({ ...playback, action: 'pause', paused: true, audio: 'sub', volume: 0.2 });
  await settle();
  assert.equal(guest.status().playback?.paused, true);
  guest.action({ ...playback, action: 'seek', time: 60, audio: 'dub', volume: 0.8 });
  await settle();
  assert.equal(host.status().playback?.time, 60);
  assert.deepEqual(host.status().playback, guest.status().playback);
  assert.equal(sent.length, 2);
  assert.equal('audio' in sent[0], false);
  assert.equal('volume' in sent[1], false);
  host.close(); guest.close();
});
