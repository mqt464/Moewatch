import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPartyUpdate, newerPartyUpdate, partyPosition, partySeekTarget, type PartyUpdate } from '../shared/watchparty';
import { applyPartyPlayback } from './playback/partyPlayback';

const update: PartyUpdate = { animeId: 1, episode: 2, time: 30, paused: false, rate: 1, at: 100000, action: 'play', clock: 1, sender: '10' };

test('party positions account for elapsed time, speed and paused playback', () => {
  assert.equal(partyPosition(update, 102000), 32);
  assert.equal(partyPosition({ ...update, rate: 2 }, 102000), 34);
  assert.equal(partyPosition({ ...update, paused: true }, 102000), 30);
  assert.equal(partyPosition(update, 99000), 30);
});

test('play and pause only correct large drift; seeks and new sources always align', () => {
  assert.equal(partySeekTarget(update, 31, 100, false, 102000), null);
  assert.equal(partySeekTarget(update, 20, 100, false, 102000), 32);
  assert.equal(partySeekTarget({ ...update, action: 'seek' }, 31, 100, false, 102000), 32);
  assert.equal(partySeekTarget(update, 31, 100, true, 102000), 32);
  assert.equal(partySeekTarget({ ...update, time: 200 }, 20, 100, false, 102000), 99.95);
});

test('concurrent controls have deterministic ordering and reject duplicate delivery', () => {
  const concurrent = { ...update, sender: '20' };
  assert.equal(newerPartyUpdate(concurrent, update), true);
  assert.equal(newerPartyUpdate(update, concurrent), false);
  assert.equal(newerPartyUpdate(update, update), false);
  assert.equal(newerPartyUpdate({ ...update, clock: 2 }, concurrent), true);
});

test('untrusted controls reject malformed fields', () => {
  assert.equal(isPartyUpdate(update), true);
  for (const bad of [null, {}, { ...update, time: NaN }, { ...update, episode: -1 }, { ...update, paused: 1 },
    { ...update, clock: Infinity }, { ...update, sender: '../foo' }, { ...update, rate: 0 }, { ...update, action: 'volume' }]) {
    assert.equal(isPartyUpdate(bad), false);
  }
});

test('applying shared playback leaves all local media preferences untouched and emits no controls', async () => {
  const player = { currentTime: 0, duration: 100, paused: true, playbackRate: 1, volume: 0.3, muted: true,
    textTracks: [{ mode: 'showing', language: 'ja' }],
    async play() { this.paused = false; }, pause() { this.paused = true; },
    dispatchEvent() { throw new Error('Remote playback must not emit local commands'); } };
  await applyPartyPlayback(player as unknown as HTMLVideoElement, { ...update, at: Date.now(), paused: true }, true);
  assert.equal(player.currentTime, 30);
  assert.equal(player.volume, 0.3);
  assert.equal(player.muted, true);
  assert.equal(player.textTracks[0].language, 'ja');
  await applyPartyPlayback(player as unknown as HTMLVideoElement, { ...update, at: Date.now() }, true);
  assert.equal(player.paused, false);
});
