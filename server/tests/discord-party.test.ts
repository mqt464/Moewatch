import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { spawn } from 'node:child_process';
import { test } from 'node:test';
import { createNativeDiscordParty } from '../discord-party';
import type { DiscordPartyEvent } from '../watchparty';

const playback = { animeId: 1, episode: 1, time: 30, paused: false, rate: 1, at: 100000 };
test('native transport exchanges commands and SDK events without exposing credentials', { skip: process.platform !== 'win32' }, async t => {
  const emitter = new EventEmitter();
  const child = Object.assign(emitter, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill() { emitter.emit('exit', 0); return true; } });
  const commands: Array<{ id: number; type: string; playback?: object }> = [];
  let args: readonly string[] = [];
  child.stdin.on('data', chunk => {
    const command = JSON.parse(String(chunk)); commands.push(command);
    child.stdout.write(JSON.stringify({ id: command.id, ok: true }) + '\n');
  });
  const transport = createNativeDiscordParty({ binary: process.execPath, dataDir: 'C:/fixture/private', launchCommand: '"C:/Program Files/Moewatch/moewatch.exe"',
    windowPid: 123, spawnProcess: ((_binary: string, values: string[]) => { args = values; setImmediate(() => child.stdout.write('{"ready":true}\n')); return child; }) as unknown as typeof spawn })!;
  t.after(() => { transport.close(); child.kill(); child.stdout.end(); child.stderr.end(); });
  const events: DiscordPartyEvent[] = [];
  transport.subscribe(event => events.push(event));
  await transport.advertise(playback);
  await transport.send({ ...playback, action: 'pause', paused: true, sender: '10', clock: 1 });
  assert.deepEqual(commands.map(command => command.type), ['advertise', 'send']);
  assert.match(args[1], /discord-credentials.bin$/);
  assert.equal(args[2], '"C:/Program Files/Moewatch/moewatch.exe"');
  assert.equal(args[3], '123');
  child.stdout.write('{"event":{"type":"invite","animeId":1,"episode":2}}\n');
  child.stdout.write('{"event":{"type":"members","room":"1","self":"10","members":[{"id":"10","name":"Mina","avatar":""}]}}\n');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.length, 2);
  assert.equal(events[0].type, 'invite');
  child.stdout.write('{"event":{"type":"diagnostic","stage":"lobby","code":50001,"status":403,"token":"must not cross boundary"}}\n');
  child.stdout.write('{"event":{"type":"diagnostic","stage":"arbitrary secret","code":0,"status":0}}\n');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events.at(-1), { type: 'diagnostic', stage: 'lobby', code: 50001, status: 403 });
  assert.equal(events.length, 3);
  await transport.leave();
  assert.equal(commands.at(-1)?.type, 'leave');
  assert.equal(JSON.stringify(events).includes('refresh'), false);
});

test('native transport rejects failed SDK commands and reports process exit', { skip: process.platform !== 'win32' }, async t => {
  const emitter = new EventEmitter();
  const child = Object.assign(emitter, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill() { emitter.emit('exit', 1); return true; } });
  child.stdin.on('data', chunk => { const command = JSON.parse(String(chunk)); child.stdout.write(JSON.stringify({ id: command.id, ok: false }) + '\n'); });
  const transport = createNativeDiscordParty({ binary: process.execPath,
    spawnProcess: (() => { setImmediate(() => child.stdout.write('{"ready":true}\n')); return child; }) as unknown as typeof spawn })!;
  t.after(() => { transport.close(); child.kill(); child.stdout.end(); child.stderr.end(); });
  const events: DiscordPartyEvent[] = [];
  transport.subscribe(event => events.push(event));
  await assert.rejects(transport.send({ ...playback, action: 'play', sender: '10', clock: 1 }), /request failed/);
  child.emit('exit', 1);
  assert.deepEqual(events, [{ type: 'disconnected' }]);
  await assert.rejects(transport.advertise(playback), /unavailable/);
});
