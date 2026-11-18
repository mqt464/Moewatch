import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSkipService } from '../aniskip';

test('AniSkip maps AniList to MAL, passes duration and caches successful lookups', async () => {
  const urls: string[] = [];
  const request: typeof fetch = async (input, options) => {
    urls.push(String(input));
    if (String(input).includes('anilist')) { assert.equal(JSON.parse(String(options?.body)).variables.id,154587); return Response.json({data:{Media:{idMal:52991}}}); }
    assert.match(String(input),/skip-times\/52991\/1/); assert.match(String(input),/episodeLength=1440.000/);
    return Response.json({found:true,results:[{skipType:'op',interval:{startTime:20,endTime:110},episodeLength:1440},{skipType:'ed',interval:{startTime:1500,endTime:1600},episodeLength:1440}]});
  };
  const skip=createSkipService(request);const signal=new AbortController().signal;
  const result=await skip(154587,1,1440,signal);
  assert.deepEqual(result,{status:'available',malId:52991,intro:{start:20,end:110}});
  await skip(154587,1,1440,signal);assert.equal(urls.length,2);
});
test('missing mapping never sends AniList ID to AniSkip',async()=>{
  let calls=0;const skip=createSkipService(async()=>{calls++;return Response.json({data:{Media:{idMal:null}}});});
  assert.deepEqual(await skip(123,1,100,new AbortController().signal),{status:'unmapped'});assert.equal(calls,1);
});
test('outages fail open and invalid or mismatched intervals are ignored',async()=>{
 const signal=new AbortController().signal;
 assert.deepEqual(await createSkipService(async()=>{throw Error();})(1,1,100,signal),{status:'unavailable'});
 const skip=createSkipService(async input=>String(input).includes('anilist')?Response.json({data:{Media:{idMal:2}}}):Response.json({found:true,results:[{skipType:'op',interval:{startTime:0,endTime:90},episodeLength:200},{skipType:'ed',interval:{startTime:-5,endTime:90},episodeLength:100}]}));
 assert.deepEqual(await skip(1,1,100,signal),{status:'not-found',malId:2});
});
