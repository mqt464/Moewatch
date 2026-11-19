import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveMkissaPlayerEmbed } from '../extractors/mkissa-player';

const signal = new AbortController().signal;
const embed = 'https://bysekoze.com/e/AbC_012';
const frame = 'https://n1mwq.org/player/def012';

test('MKissa Fm-Hls resolves the public iframe from Byse embed details', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://bysekoze.com/api/videos/AbC_012/embed/details');
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get('Referer'), embed);
    return Response.json({ code: 'AbC_012', owner_private: false, embed_frame_url: frame });
  });
  assert.deepEqual(await resolveMkissaPlayerEmbed(embed, signal), { url: frame, referer: 'https://bysekoze.com/' });
  assert.equal(fetch.mock.callCount(), 1);
});

test('MKissa Fm-Hls rejects unsafe URLs before sending a request', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw Error('unexpected fetch'); });
  for (const value of [
    'https://bysekoze.com.evil.test/e/AbC_012', 'https://bysekoze.com:443/e/AbC_012',
    'https://bysekoze.com/e/../e/AbC_012', 'https://bysekoze.com/e/%2fAbC_012',
    'https://bysekoze.com/e/AbC_012?token=value', 'https://user@bysekoze.com/e/AbC_012'
  ]) {
    await assert.rejects(resolveMkissaPlayerEmbed(value, signal), { code: 'INVALID_REQUEST' });
  }
  await assert.rejects(resolveMkissaPlayerEmbed(embed, AbortSignal.abort(new Error('cancelled'))), { message: 'cancelled' });
  assert.equal(fetch.mock.callCount(), 0);
});

test('MKissa Fm-Hls rejects private, mismatched and off-host iframe responses', async t => {
  let body: unknown;
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(body));
  const details = { code: 'AbC_012', owner_private: false, embed_frame_url: frame };
  for (const candidate of [
    { ...details, code: 'other' },
    { ...details, embed_frame_url: 'https://n1mwq.org.evil.test/player/def012' },
    { ...details, embed_frame_url: 'https://n1mwq.org/player/def012?token=value' }
  ]) {
    body = candidate;
    await assert.rejects(resolveMkissaPlayerEmbed(embed, signal), { code: 'UNSUPPORTED_MEDIA' });
  }
  body = { ...details, owner_private: true };
  await assert.rejects(resolveMkissaPlayerEmbed(embed, signal), { code: 'UPSTREAM_BLOCKED' });
  assert.equal(fetch.mock.callCount(), 4);
});
