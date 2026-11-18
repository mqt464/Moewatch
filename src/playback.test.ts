import assert from 'node:assert/strict';
import { test } from 'node:test';
import { availableEpisodes } from './playback/availability';
import { canResume } from './playback/Player';
import type { AvailabilityResponse } from '../shared/api';

test('episode availability respects audio, provider, gaps and special episodes', () => {
  const response: AvailabilityResponse = { animeId: 1, providers: [
    { provider: 'anikoto', status: 'available', episodes: [
      { id: 'a', number: 1, kind: 'regular', audio: ['sub', 'dub'] },
      { id: 'b', number: 3, kind: 'regular', audio: ['sub'] },
      { id: 'special', number: 2, kind: 'special', audio: ['sub'] },
    ] },
    { provider: 'miruro', status: 'available', episodes: [{ id: 'c', number: 1, kind: 'regular', audio: ['sub'] }, { id: 'd', number: 2, kind: 'regular', audio: ['dub'] }] },
    { provider: 'reanime', status: 'error', episodes: [] },
  ] };
  assert.deepEqual(availableEpisodes(response, 'sub'), [1, 3]);
  assert.deepEqual(availableEpisodes(response, 'dub'), [1, 2]);
  assert.deepEqual(availableEpisodes(response, 'dub', 'anikoto'), [1]);
  assert.deepEqual(availableEpisodes(null, 'sub'), []);
});

test('resume requires compatible runtimes and unfinished valid progress', () => {
  assert.equal(canResume(30, 1440, 1441), true);
  assert.equal(canResume(30, 1440, 1200), false);
  assert.equal(canResume(1430, 1440, 1440), false);
  assert.equal(canResume(0, 1440, 1440), false);
  assert.equal(canResume(30, 1440, Infinity), false);
});
