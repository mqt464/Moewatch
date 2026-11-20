import test from 'node:test';
import assert from 'node:assert/strict';
import { curated, normalizeAnime } from './catalog';
import { createHeroSelection, heroCandidates } from './featured';

test('hero pool requires a real banner, synopsis, released status and suitable format', () => {
  const valid = curated[0];
  assert.deepEqual(heroCandidates([valid,
    { ...valid, hasBanner: false }, { ...valid, banner: valid.cover },
    { ...valid, description: ' ' }, { ...valid, status: 'NOT_YET_RELEASED' },
    { ...valid, format: 'MUSIC' }, { ...valid, format: 'SPECIAL' }, { ...valid, isAdult: true },
  ]), [valid]);
  assert.equal(normalizeAnime({ id: 1, coverImage: { large: '/poster.jpg' } }).hasBanner, false);
  assert.equal(normalizeAnime({ id: 1, bannerImage: '/banner.jpg' }).hasBanner, true);
});

test('each launch rotates through the pool before repeating and navigation keeps the same hero', () => {
  let saved: string | null = null;
  const storage = () => ({ getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } });
  const pool = curated.slice(0, 3);
  const launch = () => createHeroSelection(storage, () => 0);
  const first = launch();
  assert.equal(first.current(), null);
  assert.equal(first.select(pool).id, pool[0].id);
  assert.equal(first.select([pool[1]]).id, pool[0].id);
  assert.equal(first.current()?.id, pool[0].id);
  assert.equal(launch().select(pool).id, pool[1].id);
  assert.equal(launch().select(pool).id, pool[2].id);
  assert.equal(launch().select(pool).id, pool[0].id);
});

test('exhausted pools avoid the last title even after the pool changes', () => {
  const storage = () => ({ getItem: () => JSON.stringify([curated[1].id, curated[0].id]), setItem: () => {} });
  assert.equal(createHeroSelection(storage, () => 0).select(curated.slice(0, 2)).id, curated[1].id);
});

test('empty live pools fall back to curated titles and tolerate broken or blocked storage', () => {
  for (const saved of ['invalid json', '{}', '[null,"bad",-1]']) {
    const selection = createHeroSelection(() => ({ getItem: () => saved, setItem: () => {} }), () => 0);
    assert.equal(selection.select([]).id, curated[0].id);
  }
  const selection = createHeroSelection(() => { throw new Error('Storage blocked'); }, () => 0);
  assert.equal(selection.select([]).id, curated[0].id);
});
