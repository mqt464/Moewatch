import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWatchSession, needsWatchCheck, recordActivity } from './playback/watchSession';

test('three distinct unattended episodes block autoplay, including across series', () => {
  const session = createWatchSession();
  assert.equal(needsWatchCheck(session, '1/1'), false);
  assert.equal(needsWatchCheck(session, '1/1'), false);
  assert.equal(needsWatchCheck(session, '1/2'), false);
  assert.equal(needsWatchCheck(session, '2/1'), true);
  recordActivity(session);
  assert.equal(needsWatchCheck(session, '2/2'), false);
});

test('90 minutes of unattended playback blocks autoplay and activity resets it', () => {
  const session = createWatchSession();
  session.unattendedMs = 90 * 60_000 - 1;
  assert.equal(needsWatchCheck(session, '1/1'), false);
  session.unattendedMs += 1;
  assert.equal(needsWatchCheck(session, '1/1'), true);
  session.sleepUntil = Date.now() + 60_000;
  recordActivity(session);
  assert.equal(session.unattendedMs, 0);
  assert.equal(needsWatchCheck(session, '1/2'), false);
  assert.ok(session.sleepUntil > Date.now());
});
