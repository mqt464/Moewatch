import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { miruro, decodeMiruroCatalog, parseMiruroEpisodes } from './miruro';
import { idEncode, providerBrowser } from './common';
const anime='NtG-RmIvubqYRTFExTD0_vejcY8Bplcn';
function encode(data: unknown) { const b=gzipSync(JSON.stringify(data)),k=Buffer.from('miruro/catalog');for(let i=0;i<b.length;i++)b[i]^=k[i%k.length];return b; }
test('current catalogue codec and episode metadata do not invent audio availability',()=>{
 const data={data:[{episode_number:1,title:'Session #1: Asteroid Blues',kind:'regular'}],has_more:false,next_cursor:null};
 assert.deepEqual(decodeMiruroCatalog(encode(data)),data);
 assert.deepEqual(parseMiruroEpisodes(data,anime)[0].audio,[]);
 assert.throws(()=>decodeMiruroCatalog(Buffer.from('bad')),{code:'UPSTREAM_ERROR'});
});

test('a blocked catalogue retries through the bounded browser transport', async t => {
 let drained = false, cancelled = false;
 t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
  start(controller) { controller.enqueue(new TextEncoder().encode('blocked')); },
  pull(controller) { drained = true; controller.close(); },
  cancel() { cancelled = true; }
 }), { status: 403 }));
 t.mock.method(providerBrowser, 'available', () => true);
 const calls: string[] = [];
 t.mock.method(providerBrowser, 'request', async (...[input, options]: Parameters<typeof providerBrowser.request>) => {
  calls.push(String(input));
  assert.equal(options.maxBytes, 8 * 1024 * 1024);
  options.signal.throwIfAborted();
  return new Response(encode({data:[{id:anime,title:{english:'Cowboy Bebop'},external_ids:{anilist:['1']}}]}), {headers:{'content-type':'application/octet-stream'}});
 });
 const titles = await miruro.search('Cowboy Bebop', new AbortController().signal);
 assert.equal(titles[0].anilistId, 1);
 assert.equal(calls.length, 1);
 assert.equal(drained, true);
 assert.equal(cancelled, false);
});
test('current request shapes, softsubs, server identity, headers and fresh resolve',async t=>{
 const calls:string[]=[];
 const provider={provider:'kickassanime',subtitles:[{file:'https://cdn.example/en.vtt',language:'en'}],servers:[{server:'Vid',headers:{Referer:'https://krussdomi.com/'},streams:[{url:'https://cdn.example/master.m3u8',format:'hls'}]},{server:'embed-only',streams:[],embed:{url:'https://example.com'}}]};
 const playback={episode_number:1,tracks:[{track:'ssub',providers:[provider]},{track:'dub',providers:[provider]}]};
 t.mock.method(globalThis,'fetch',async(input:unknown,init:RequestInit)=>{
  const url=String(input);calls.push(url);assert.equal(init.redirect,'error');
  if(url.includes('/play'))return Response.json(playback);
  if(url.includes('/episodes'))return new Response(encode({data:[{episode_number:1}],has_more:false}),{headers:{'content-type':'application/octet-stream'}});
  return new Response(encode({data:[{id:anime,title:{english:'Cowboy Bebop'},external_ids:{anilist:['1']},format:'TV',season_year:1998}]}),{headers:{'content-type':'application/octet-stream'}});
 });
 const signal=new AbortController().signal;
 const match=await miruro.match({id:1,title:'Cowboy Bebop',romaji:'Cowboy Bebop',format:'TV',year:1998,episodes:26},signal);
 assert.equal(match.status,'matched');
 const eps=await miruro.episodes(anime,signal),servers=await miruro.servers(eps[0].id,signal);
 assert.deepEqual(servers.map(s=>s.audio),['sub','dub']);assert.notEqual(servers[0].id,servers[1].id);
 const result=await miruro.resolve(servers[1].id,signal);
 assert.equal(result.audioLanguage,'en');assert.equal(result.headers?.Referer,'https://krussdomi.com/');
 assert.equal(calls.filter(s=>s.includes('/play')).length,2);
 assert.ok(calls[0].endsWith('q=Cowboy+Bebop&limit=15'));assert.ok(calls[1].endsWith('/episodes?limit=10000'));
 await assert.rejects(miruro.servers(idEncode({anime:'https://127.0.0.1',number:1}),signal),{code:'INVALID_REQUEST'});
 const controller=new AbortController();controller.abort();const count=calls.length;
 await assert.rejects(miruro.search('Cowboy',controller.signal));assert.equal(calls.length,count);
});

