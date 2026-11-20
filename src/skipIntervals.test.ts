import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSkipIntervals } from './playback/skipIntervals';

test('provider intervals take precedence and fallback fills each missing interval', () => {
  const intro = { start: 20, end: 110 }, outro = { start: 1300, end: 1390 };
  assert.deepEqual(mergeSkipIntervals(1440, { intro }, { intro: { start: 0, end: 90 }, outro }), { intro, outro });
  assert.deepEqual(mergeSkipIntervals(1440, { outro }, { intro }), { intro, outro });
  assert.deepEqual(mergeSkipIntervals(1440, { intro, outro }), { intro, outro });
});

test('invalid provider timings use valid fallback, and invalid fallback is omitted', () => {
  const intro = { start: 0, end: 90 };
  for (const invalid of [{ start: -1, end: 90 }, { start: 100, end: 90 }, { start: 0, end: 1500 }, { start: NaN, end: 90 }, { start: 0, end: Infinity }]) {
    assert.deepEqual(mergeSkipIntervals(1440, { intro: invalid }, { intro, outro: invalid }), { intro, outro: undefined });
  }
  for (const duration of [0, NaN, Infinity]) assert.deepEqual(mergeSkipIntervals(duration, { intro }), { intro: undefined, outro: undefined });
});
