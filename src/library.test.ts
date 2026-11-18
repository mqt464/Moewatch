import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyLibrary, readLibrary, toggleSaved, recordProgress, episodeNumber } from './library';
import type { Anime } from './catalog';
import { curated } from './catalog';

const anime: Anime = { ...curated[0], id: 1, title: 'Example' };
test('invalid or corrupt storage recovers safely', () => {
  assert.deepEqual(readLibrary('{broken'), emptyLibrary);
  assert.deepEqual(readLibrary('{"saved":[null],"progress":[null]}'), emptyLibrary);
  assert.deepEqual(readLibrary('{"saved":[{"id":1,"title":"Broken","cover":"x"}],"progress":[]}'), emptyLibrary);
  assert.equal(readLibrary(JSON.stringify({ saved: [anime], progress: [] })).saved.length, 1);
});
test('saved titles toggle without duplicates', () => {
  const saved = toggleSaved(emptyLibrary, anime);
  assert.equal(saved.saved.length, 1);
  assert.equal(toggleSaved(saved, anime).saved.length, 0);
});
test('progress replaces existing series and rejects invalid duration', () => {
  const progress = { anime, episode: 1, time: 10, duration: 100, updated: 1 };
  const library = recordProgress(emptyLibrary, progress);
  assert.equal(recordProgress(library, { ...progress, episode: 2 }).progress.length, 1);
  assert.equal(recordProgress(library, { ...progress, duration: Infinity }), library);
});
test('episode route stays within known bounds', () => {
  assert.equal(episodeNumber('-2', 12), 1);
  assert.equal(episodeNumber('999', 12), 12);
  assert.equal(episodeNumber('no', null), 1);
  assert.equal(episodeNumber('9', null), 9);
  assert.equal(episodeNumber('999999999999', null), 1);
});
