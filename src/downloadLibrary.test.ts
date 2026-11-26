import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DownloadSeries } from '../shared/downloads';
import { curated } from './catalog';
import { downloadedTitles } from './downloadLibrary';

test('library includes playable downloads once per title and follows removals', () => {
  const job: DownloadSeries = {
    id: 'example', anime: curated[0], audio: 'sub', quality: 720,
    provider: 'auto', fallback: true, created: 1,
    episodes: [{ number: 1, status: 'complete', progress: 1, bytes: 100 }],
  };
  assert.deepEqual(downloadedTitles([]), []);
  for (const status of ['queued', 'downloading', 'failed'] as const) {
    assert.deepEqual(downloadedTitles([{ ...job, episodes: [{ ...job.episodes[0], status }] }]), []);
  }
  assert.deepEqual(downloadedTitles([job, { ...job, id: 'another-quality', quality: 1080 }]), [job.anime]);
  assert.deepEqual(downloadedTitles([{ ...job, episodes: [...job.episodes, { number: 2, status: 'downloading', progress: 0.5, bytes: 50 }] }]), [job.anime]);
});
