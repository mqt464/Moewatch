import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { readMkissaEpisode, readMkissaPlayer, type MkissaBrowserPage } from '../extractors/mkissa-browser';

const signal = new AbortController().signal;
const episode = { titleId: 'AbC123', episode: '1.5', audio: 'sub' } as const;
const titlePath = '/anime/AbC123';
const subSource = { sourceName: 'Fm-Hls', sourceUrl: 'https://bysekoze.com/e/Sub' };
const dubSource = { sourceName: 'Fm-Hls', sourceUrl: 'https://bysekoze.com/e/Dub' };
const iframe = 'https://n1mwq.org/player/Video123';
const master = 'https://media.example.test/hls/master.m3u8';

function episodePage() {
  const location = { origin: '', pathname: '' };
  class SubtleCrypto {
    async decrypt(result: ArrayBuffer) { return result; }
  }
  const received: Array<Promise<void>> = [];
  const emit = async (audio: 'sub' | 'dub', titleId = episode.titleId as string, number = episode.episode as string) => {
    const track = audio === 'sub' ? subSource : dubSource;
    const sourceUrls = [
      track,
      { sourceName: 'HTTP', sourceUrl: 'http://media.example.test/' },
      { sourceName: 'Private', sourceUrl: 'https://[::ffff:127.0.0.1]/' },
      { sourceName: 'Credentials', sourceUrl: 'https://user@media.example.test/' },
      { sourceName: false, sourceUrl: 'https://media.example.test/' },
      null
    ];
    const bytes = new TextEncoder().encode(JSON.stringify({ episode: {
      show: { _id: titleId }, episodeString: number, pageStatus: { pageId: `anime-canonical_${audio}_${number}` }, sourceUrls
    } })).buffer;
    assert.equal(await new SubtleCrypto().decrypt(bytes), bytes);
  };
  let toggled = false;
  const dub = {
    textContent: 'Dub', matches: () => false,
    click() {
      toggled = true;
      location.pathname = titlePath + '/p-1.5-dub';
      received.push(emit('sub'), emit('dub', 'WrongTitle'), emit('dub', episode.titleId, '1'));
    }
  };
  const window: Record<string, unknown> = {};
  window.top = window;
  const document = {
    querySelector(selector: string) {
      assert.equal(selector, '[data-href$="/anime/AbC123/p-1.5-sub"]');
      return {
        click() {
          location.pathname = titlePath + '/p-1.5-sub';
          received.push(emit('sub'), emit('dub'));
        }
      };
    },
    querySelectorAll: () => [dub]
  };
  const context = createContext({ location, document, window, SubtleCrypto, TextDecoder });
  let init: string | undefined;
  let dubRead = false;
  const page: MkissaBrowserPage = {
    async addInitScript(source) { init = source; },
    async navigate(url) {
      assert.equal(url, 'https://mkissa.to' + titlePath);
      location.origin = new URL(url).origin;
      location.pathname = new URL(url).pathname;
      assert.ok(init);
      runInContext(init, context);
    },
    async evaluate<T>(expression: string): Promise<T> {
      const value = runInContext(expression, context);
      await Promise.all(received);
      if (toggled && !dubRead && expression.includes('function readSources')) {
        assert.equal(value, null, 'Dub state must reject stale Sub and mismatched Dub results');
        dubRead = true;
        await emit('dub');
      }
      return structuredClone(value);
    },
    onRequest() { assert.fail('Episode flow should use the client decrypt observer'); }
  };
  return { page, switched: () => toggled };
}

test('MKissa reads the exact in-app episode and does not touch Dub for Sub results', async () => {
  const { page, switched } = episodePage();
  assert.deepEqual(await readMkissaEpisode(page, episode, signal), [subSource]);
  assert.equal(switched(), false);
});

test('MKissa clears the prior result on Dub and waits for an exact title, episode and audio match', async () => {
  const { page, switched } = episodePage();
  assert.deepEqual(await readMkissaEpisode(page, { ...episode, episode: 1.5, audio: 'dub' }, signal), [dubSource]);
  assert.equal(switched(), true);
});

test('MKissa rejects malformed input and pre-cancellation before using the page', async () => {
  const page = new Proxy({} as MkissaBrowserPage, { get: () => assert.fail('Unexpected page use') });
  for (const request of [
    { ...episode, titleId: '../title' }, { ...episode, titleId: 'AbC123\n' }, { ...episode, titleId: 'る' },
    { ...episode, episode: '1e2' }, { ...episode, episode: '1/2' }, { ...episode, episode: '01' },
    { ...episode, episode: Infinity }, { ...episode, audio: 'raw' as 'sub' }
  ]) {
    await assert.rejects(readMkissaEpisode(page, request, signal), { code: 'INVALID_REQUEST' });
  }
  for (const value of [
    'http://n1mwq.org/player/Video123', 'https://n1mwq.org.evil.test/player/Video123', iframe + '?x=1',
    'https://n1mwq.org:443/player/Video123', 'https://user@n1mwq.org/player/Video123', iframe + '\n'
  ]) {
    await assert.rejects(readMkissaPlayer(page, value, signal), { code: 'INVALID_REQUEST' });
  }
  await assert.rejects(readMkissaPlayer(page, iframe, signal, 'https://bysekoze.com/'), { code: 'INVALID_REQUEST' });
  await assert.rejects(readMkissaEpisode(page, episode, AbortSignal.abort(new Error('cancelled'))), /cancelled/);
});

test('MKissa returns the first player master, its explicit expiry and actual subtitle metadata', async () => {
  const events: Array<[string, Record<string, string>?]> = [
    ['http://media.example.test/hls/master.m3u8'],
    ['https://127.1/hls/master.m3u8'],
    ['https://192.168.1.4/hls/master.m3u8'],
    ['https://name@media.example.test/hls/master.m3u8'],
    [master, { Referer: 'https://bysekoze.com/' }],
    [master.replace('master', 'variant')],
    [master + '?expires=1900000000', { Referer: 'https://n1mwq.org' }],
    [master + '?expires=1900000001']
  ];
  let listener: Parameters<MkissaBrowserPage['onRequest']>[0] | undefined;
  let installed = false;
  const page: MkissaBrowserPage = {
    async addInitScript() { installed = true; },
    async navigate(url) {
      assert.equal(url, dubSource.sourceUrl);
      assert.ok(installed && listener);
      for (const event of events) listener(...event);
    },
    async evaluate<T>(): Promise<T> {
      return [
        { src: 'https://media.example.test/captions.vtt', label: 'English CC', srclang: 'en' },
        { src: 'https://[::1]/captions.vtt', label: 'Unsafe', srclang: 'en' }
      ] as T;
    },
    onRequest(observe) { listener = observe; return () => { listener = undefined; }; }
  };
  assert.deepEqual(await readMkissaPlayer(page, iframe, signal, dubSource.sourceUrl), {
    sources: [{ url: master + '?expires=1900000000', type: 'hls' }],
    headers: { Referer: 'https://n1mwq.org/' },
    expiresAt: 1900000000000,
    subtitles: [{ url: 'https://media.example.test/captions.vtt', label: 'English CC', language: 'en', format: 'vtt' }]
  });
  assert.equal(listener, undefined);
});

test('MKissa omits expiry and subtitles when the observed player provides neither', async () => {
  const url = master + '?e=1234&exp=short-lived';
  let installed: string | undefined;
  let tick: (() => void) | undefined;
  let request: Parameters<MkissaBrowserPage['onRequest']>[0] | undefined;
  const button = {
    getClientRects: () => [1], matches: () => false, getAttribute: () => 'Play video',
    click: () => request?.(url)
  };
  const document = {
    querySelectorAll: (selector: string) => selector === 'track[src]'
      ? [{ kind: 'chapters', src: 'https://media.example.test/chapters.vtt', srclang: 'en', label: 'Chapters' }]
      : [button],
    querySelector: () => null
  };
  const context = createContext({
    location: new URL(iframe), document, window: {},
    setInterval: (callback: () => void) => { tick = callback; return 1; },
    setTimeout: () => {}, clearInterval: () => {}
  });
  const page: MkissaBrowserPage = {
    async addInitScript(source) { installed = source; },
    async navigate(value) {
      assert.equal(value, iframe);
      assert.ok(installed);
      runInContext(installed, context);
      assert.ok(tick);
      tick();
    },
    async evaluate<T>(expression: string): Promise<T> { return structuredClone(runInContext(expression, context)); },
    onRequest(listener) { request = listener; return () => { request = undefined; }; }
  };
  assert.deepEqual(await readMkissaPlayer(page, iframe, signal), {
    sources: [{ url, type: 'hls' }], headers: { Referer: 'https://n1mwq.org/' }, subtitles: []
  });
});

test('MKissa abort interrupts a pending page command and removes the player request observer', async () => {
  const controller = new AbortController();
  const reason = new Error('caller cancelled');
  let subscribed = false;
  const page: MkissaBrowserPage = {
    async addInitScript() {},
    async navigate(): Promise<void> {
      controller.abort(reason);
      return new Promise(() => {});
    },
    async evaluate() { return assert.fail('Cancelled before evaluation'); },
    onRequest() { subscribed = true; return () => { subscribed = false; }; }
  };
  await assert.rejects(readMkissaPlayer(page, iframe, controller.signal), error => error === reason);
  assert.equal(subscribed, false);
  const episodeController = new AbortController();
  await assert.rejects(readMkissaEpisode({
    ...page,
    async navigate() {},
    async evaluate() {
      episodeController.abort(reason);
      return new Promise(() => {});
    }
  }, episode, episodeController.signal), error => error === reason);
});
