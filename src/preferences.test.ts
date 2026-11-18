import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPreferences, readPreferences } from './preferences';

test('missing, malformed and invalid preferences recover to defaults', () => {
  for (const raw of [null, '{broken', 'null', '3', '[]', '{}', '{"showYears":"yes","reduceMotion":1,"volume":"50","playbackSpeed":"9","loop":null}']) {
    assert.deepEqual(readPreferences(raw), defaultPreferences);
  }
});

test('supported preferences survive serialization without extra properties', () => {
  const preferences = { ...defaultPreferences, showYears: true, reduceMotion: true, provider: 'anikoto' as const, audio: 'dub' as const, subtitles: true, volume: 0.35, muted: true, providerFallback: false };
  assert.deepEqual(readPreferences(JSON.stringify({ ...preferences, unknown: 'ignored' })), preferences);
});

test('provider settings migrate and reject unknown values', () => {
  assert.deepEqual(readPreferences('{"provider":"unknown","audio":"fr","providerFallback":1}'), defaultPreferences);
  assert.equal(readPreferences('{"provider":"anikoto","audio":"dub","providerFallback":false}').provider, 'anikoto');
  assert.equal(readPreferences('{"audio":"dub"}').audio, 'dub');
  assert.equal(readPreferences('{"providerFallback":false}').providerFallback, false);
  assert.deepEqual(readPreferences('{"volume":35,"playbackSpeed":"1.5","loop":true}'), defaultPreferences);
});

test('subtitle preferences migrate and reject invalid values', () => {
  assert.equal(readPreferences('{"subtitles":true}').subtitles, true);
  assert.equal(readPreferences('{"subtitles":false}').subtitles, false);
  assert.equal(readPreferences('{"subtitles":"true"}').subtitles, false);
});

test('volume preferences validate range and preserve silence', () => {
  for (const volume of [0, 0.35, 1]) assert.equal(readPreferences(JSON.stringify({volume})).volume, volume);
  for (const volume of [-1, 2, '0.5', null]) assert.equal(readPreferences(JSON.stringify({volume})).volume, 1);
  assert.equal(readPreferences('{"muted":true}').muted, true);
  assert.equal(readPreferences('{"muted":"true"}').muted, false);
});
