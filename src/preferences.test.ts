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

test('Discord preferences preserve independent toggles and reject invalid values', () => {
  for (const discordRpc of [true, false]) {
    for (const discordWatchParty of [true, false]) {
      const preferences = { ...defaultPreferences, discordRpc, discordWatchParty };
      assert.deepEqual(readPreferences(JSON.stringify(preferences)), preferences);
    }
  }
  assert.deepEqual(readPreferences('{"discordRpc":"false","discordWatchParty":0}'), defaultPreferences);
});

test('volume preferences validate range and preserve silence', () => {
  for (const volume of [0, 0.35, 1]) assert.equal(readPreferences(JSON.stringify({volume})).volume, volume);
  for (const volume of [-1, 2, '0.5', null]) assert.equal(readPreferences(JSON.stringify({volume})).volume, 1);
  assert.equal(readPreferences('{"muted":true}').muted, true);
  assert.equal(readPreferences('{"muted":"true"}').muted, false);
});

test('download quality defaults to 720p and accepts only supported resolutions', () => {
  for (const quality of [480, 720, 1080]) assert.equal(readPreferences(JSON.stringify({ downloadQuality: quality })).downloadQuality, quality);
  for (const quality of [0, 2160, '720', null]) assert.equal(readPreferences(JSON.stringify({ downloadQuality: quality })).downloadQuality, 720);
});

test('provider priority preserves order and repairs stale or duplicate entries', () => {
  const result = readPreferences(JSON.stringify({ providerOrder: ['miruro', 'unknown', 'miruro', 'anikoto'] }));
  assert.deepEqual(result.providerOrder, ['miruro', 'anikoto', 'reanime', 'anipm', 'gotaku', 'mkissa']);
  assert.deepEqual(readPreferences('{"providerOrder":"miruro"}').providerOrder, defaultPreferences.providerOrder);
});

test('playback and accessibility preferences reject invalid values and preserve supported choices', () => {
  const supported = { ...defaultPreferences, autoNext: false, resumePlayback: false, skipOpening: true, skipEnding: true, subtitleLanguage: 'fr', subtitleSize: 150, subtitleBackground: 75, textSize: 125, titleLanguage: 'romaji' };
  assert.deepEqual(readPreferences(JSON.stringify(supported)), supported);
  assert.deepEqual(readPreferences(JSON.stringify({ autoNext: 'no', resumePlayback: 0, skipOpening: 'yes', skipEnding: 1, subtitleLanguage: 'unknown', subtitleSize: 999, subtitleBackground: -1, textSize: 900 })), defaultPreferences);
});
