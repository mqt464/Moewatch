import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultHomeLayout, homeRowIds, moveHomeRow, readHomeLayout } from './homeLayout';
import { defaultPreferences, readPreferences } from './preferences';

test('old settings migrate and malformed layouts recover safely', () => {
  assert.deepEqual(readPreferences('{}').homeLayout, defaultHomeLayout);
  for (const value of [null, 3, [], {}, { order: 'bad', hidden: 'bad' }]) assert.deepEqual(readHomeLayout(value), defaultHomeLayout);
  const layout = readHomeLayout({ order: ['Action', 'Action', 'removed'], hidden: ['watching', 'watching', 'removed'], hero: false, continueStyle: 'landscape' });
  assert.equal(layout.order[0], 'Action');
  assert.equal(layout.order.length, homeRowIds.length);
  assert.deepEqual(layout.hidden, ['watching']);
  assert.equal(layout.hero, false);
  assert.equal(layout.continueStyle, 'landscape');
  assert.deepEqual(readPreferences(JSON.stringify({ ...defaultPreferences, homeLayout: layout })).homeLayout, layout);
});

test('moving in either direction preserves all rows without mutating saved order', () => {
  const order = [...homeRowIds];
  const down = moveHomeRow(order, 'watching', 'Action');
  assert.equal(down[3], 'watching');
  assert.equal(moveHomeRow(down, 'watching', 'recommended')[0], 'watching');
  assert.deepEqual(order, homeRowIds);
  assert.equal(new Set(down).size, homeRowIds.length);
});
