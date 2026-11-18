import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSubtitles, clock } from './playback/subtitles';
test('custom subtitles parse VTT and SRT cue identifiers, settings and multiline dialogue safely',()=>{
 assert.deepEqual(parseSubtitles('WEBVTT\n\nfirst\n00:00:01.000 --> 00:00:03.000 align:center\n<b>Hello</b>\nWorld &amp; friends','vtt'),[{start:1,end:3,text:'Hello\nWorld & friends'}]);
 assert.deepEqual(parseSubtitles('1\n00:00:02,500 --> 00:00:04,000\n<script>plain text</script>','srt'),[{start:2.5,end:4,text:'plain text'}]);
 assert.equal(parseSubtitles('00:00:05 --> 00:00:01\nInvalid','vtt').length,0);
});
test('ASS strips positioning while preserving dialogue commas and line breaks',()=>{
 assert.deepEqual(parseSubtitles('Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\pos(1,1)}Hello, world\\NAgain','ass'),[{start:1,end:3,text:'Hello, world\nAgain'}]);
 assert.equal(clock(NaN),'0:00');assert.equal(clock(1440),'24:00');
});
