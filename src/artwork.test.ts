import test from 'node:test';
import assert from 'node:assert/strict';
import { heroFraming } from './artwork';
import { curated } from './catalog';

test('curated heroes have distinct, responsive framing and unknown titles have a safe fallback', () => {
  const fallback = heroFraming(99999999);
  for (const anime of curated) {
    const style = heroFraming(anime.id);
    assert.notDeepEqual(style, fallback);
    for (const position of [style['--art-position'], style['--art-position-mobile']]) {
      assert.match(position, /^\d+% \d+%$/);
      assert.ok(position.split(' ').every(value => Number.parseInt(value) >= 0 && Number.parseInt(value) <= 100));
    }
  }
  assert.notDeepEqual(heroFraming(1), heroFraming(154587));
  assert.equal(fallback['--art-position'], '65% 45%');
});
