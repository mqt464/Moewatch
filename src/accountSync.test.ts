import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curated } from './catalog';
import { editEntry, freshAccount, mergeRemote, readAccount } from './accountSync';
import type { AccountEntry } from '../shared/account';
const anime = { ...curated[0], episodes: 12 };
const remote: AccountEntry = { id: 1, mediaId: anime.id, status: 'CURRENT', progress: 3, updatedAt: 100, anime };
test('remote import, status preservation, deletions and remote removals', () => {
  const imported = mergeRemote(freshAccount(), [remote]);
  assert.equal(imported.library.saved.length, 1);
  assert.equal(imported.library.progress[0].episode, 4);
  const deleted = editEntry(imported, anime, undefined, true);
  assert.equal(mergeRemote(deleted, [remote]).library.saved.length, 0);
  assert.equal(mergeRemote(imported, []).library.saved.length, 0);
});
test('unchanged completed episode does not queue another write; rewatches do not regress progress', () => {
  const imported = mergeRemote(freshAccount(), [remote]);
  const playing = { anime, episode: 4, time: 30, duration: 100, updated: 100001 };
  assert.equal(editEntry(imported, anime, playing), imported);
  assert.equal(editEntry(imported, anime, { ...playing, episode: 2 }), imported);
  assert.equal(editEntry(imported, anime, { ...playing, time: 96 }).pending[anime.id].progress, 4);
});
test('remote pull retains subepisode resume and durable pending edits', () => {
  let state = mergeRemote(freshAccount(), [remote]);
  const local = { anime, episode: 4, time: 40, duration: 100, updated: 100001 };
  state.library.progress = [local];
  assert.deepEqual(mergeRemote(state, [remote]).library.progress, [local]);
  state = editEntry(state, anime, undefined, true);
  const restored = readAccount(JSON.stringify(state));
  assert.equal(restored.pending[anime.id].deleted, true);
  assert.equal(mergeRemote(restored, [remote]).library.saved.length, 0);
});
import { setEntryStatus } from './accountSync';
import { libraryStatus, readLibrary, setLibraryStatus } from './library';
test('guest statuses persist and legacy saved titles default to planning', () => {
  const guest = { saved: [anime], progress: [] };
  assert.equal(libraryStatus(guest, anime), 'PLANNING');
  const watching = setLibraryStatus(guest, anime, 'CURRENT');
  assert.equal(libraryStatus(readLibrary(JSON.stringify(watching)), anime), 'CURRENT');
  assert.equal(libraryStatus(setLibraryStatus(watching, anime, null), anime), null);
});
test('explicit account statuses preserve episode counts and completed fills known total', () => {
  const imported = mergeRemote(freshAccount(), [remote]);
  const paused = setEntryStatus(imported, anime, 'PAUSED');
  assert.equal(paused.pending[anime.id].progress, 3);
  assert.equal(paused.library.statuses?.[anime.id], 'PAUSED');
  assert.equal(mergeRemote(paused, [remote]).library.statuses?.[anime.id], 'PAUSED');
  const done = setEntryStatus(paused, anime, 'COMPLETED');
  assert.equal(done.pending[anime.id].progress, 12);
  assert.equal(setEntryStatus(done, anime, 'DROPPED').pending[anime.id].progress, 12);
  const removed = setEntryStatus(done, anime, null);
  assert.equal(removed.pending[anime.id].deleted, true);
  assert.equal(removed.library.saved.length, 0);
});
