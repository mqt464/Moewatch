import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { curated } from '../src/catalog';
import { readFileSync } from 'node:fs';
const media=readFileSync('tests/fixtures/player-flower.mp4');
async function fixture(page:Page, options: { dub?: boolean; subtitles?: boolean } = {}) {
 await page.route('**/api/v1/**',route=>{
 const path=new URL(route.request().url()).pathname;
 if(path.endsWith('/account')) return route.fulfill({json:{user:null,configured:false}});
 if(path.endsWith('/availability'))return route.fulfill({json:{animeId:154587,providers:[{provider:'anikoto',status:'available',episodes:[1,3].map(number=>({id:String(number),number,kind:'regular',audio:options.dub===false?['sub']:['sub','dub']}))}]}});
 if(path.endsWith('/servers'))return route.fulfill({json:{servers:[{id:'main',name:'Main',audio:'sub'},{id:'backup',name:'Backup',audio:'sub'}]}});
 if(path.endsWith('/playback'))return route.fulfill({json:{provider:'anikoto',server:{id:'main',name:'Main'},sources:[{url:'/media/fixture.mp4',type:'mp4',quality:'1080p'},{url:'/media/second.mp4',type:'mp4',quality:'720p'}],subtitles:options.subtitles===false?[]:[{url:'/media/sub.vtt',format:'vtt',label:'English',language:'en'}],attempts:[]}});
 if(path.includes('/skip-times/'))return route.fulfill({json:{status:'available',malId:52991,intro:{start:0,end:2},outro:{start:4,end:5}}});
 if(path.endsWith('/anime/154587'))return route.fulfill({json:{anime:curated[0]}});
 return route.fulfill({json:{providers:[]}});
 });
 await page.route('**/media/**',route=>{
 if(route.request().url().endsWith('.vtt'))return route.fulfill({contentType:'text/vtt',body:'WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nA journey begins.'});
 const range=/bytes=(\d+)-(\d*)/.exec(route.request().headers().range||'');
 const start=range?Number(range[1]):0,end=range?.[2]?Math.min(Number(range[2]),media.length-1):media.length-1;
 return route.fulfill({status:range?206:200,contentType:'video/mp4',headers:{'Accept-Ranges':'bytes','Content-Length':String(end-start+1),...(range?{'Content-Range':`bytes ${start}-${end}/${media.length}`}:{})},body:media.subarray(start,end+1)});
 });
 await page.goto('/watch/154587/1');
 await expect.poll(()=>page.locator('video').evaluate(v=>(v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
}
test('custom player plays real media, seeks, renders subtitles, skips and resumes',async({page})=>{
 await fixture(page);
 await expect(page.locator('video')).not.toHaveAttribute('controls');
 await expect(page.getByRole('button',{name:'Skip opening',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Skip opening',exact:true}).click();
 await expect.poll(()=>page.locator('video').evaluate(v=>(v as HTMLVideoElement).currentTime)).toBeGreaterThanOrEqual(2);
 await page.getByRole('button',{name:'Subtitles',exact:true}).click();
 await page.getByRole('button',{name:'On',exact:true}).click();
 await page.locator('.cinema-header h1').click();
 await expect(page.locator('.subtitle-overlay')).toHaveText('A journey begins.');
 await page.evaluate(()=> (document.activeElement as HTMLElement)?.blur());
 await page.screenshot({path:'artifacts/player/subtitles-desktop.png'});
 await page.locator('video').focus();await page.keyboard.press('k');await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();await page.keyboard.press('k');
 await page.getByRole('button',{name:'Mute',exact:true}).click();await expect(page.locator('video')).toHaveJSProperty('muted',true);
 await page.getByRole('slider',{name:'Playback position'}).fill('2.5');
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('moewatch-library-v1')||'{}').progress?.[0]?.time||0)).toBeGreaterThan(2);
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('moewatch-library-v1')||'{}').progress?.[0]?.time||0)).toBeGreaterThan(2);
 await page.reload();await expect.poll(()=>page.locator('video').evaluate(v=>(v as HTMLVideoElement).currentTime)).toBeGreaterThan(2);
});
test('autonext countdown can cancel, respects availability gaps and excludes local files',async({page})=>{
 await fixture(page);
 await page.locator('video').evaluate(v=>v.dispatchEvent(new Event('ended')));
 await expect(page.getByText('Next episode in 5')).toBeVisible();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.locator('.next-countdown')).toHaveCount(0);
 await page.locator('video').evaluate(v=>v.dispatchEvent(new Event('ended')));await page.getByRole('button',{name:'Play now'}).click();await expect(page).toHaveURL(/\/3$/);
 await expect(page.locator('.cinema-header p')).toHaveText('Episode 3');
 await expect.poll(()=>page.locator('video').evaluate(v=>(v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
 await page.getByLabel('Choose a local video').setInputFiles({name:'local.mp4',mimeType:'video/mp4',buffer:media});
 await expect(page.locator('video')).toHaveAttribute('src',/^blob:/);
 await page.locator('video').evaluate(v=>v.dispatchEvent(new Event('ended')));await expect(page.locator('.next-countdown')).toHaveCount(0);
});
test('desktop and mobile playback layouts and settings are accessible',async({page})=>{
 await fixture(page);
 for(const [name,width,height] of [['desktop',1440,900],['mobile',390,844],['landscape',844,390]] as const){
 await page.setViewportSize({width,height});
 await page.getByRole('slider',{name:'Playback position'}).fill('2');
 await expect.poll(()=>page.locator('video').evaluate(v=>(v as HTMLVideoElement).currentTime)).toBeGreaterThanOrEqual(2);
 await page.locator('video').evaluate(v=>(v as HTMLVideoElement).pause());
 await page.evaluate(()=> (document.activeElement as HTMLElement)?.blur());
 await page.waitForTimeout(150);
 await expect(page.locator('.watch-content')).toHaveCSS('height',`${height}px`);
 const timeline=await page.locator('.timeline').boundingBox();const toolbar=await page.locator('.cinema-toolbar').boundingBox();expect(toolbar!.y).toBeGreaterThan(timeline!.y);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`artifacts/player/after-${name}.png`});
 await page.getByRole('button',{name:'Playback settings',exact:true}).click();await expect(page.getByRole('combobox',{name:'Provider',exact:true})).toBeVisible();await expect(page.getByRole('combobox',{name:'Server',exact:true})).toBeVisible();
 await page.screenshot({path:`artifacts/player/settings-${name}.png`});
 const results=await new AxeBuilder({page}).include('.watch-content').analyze();expect(results.violations).toEqual([]);
 await page.locator('.cinema-header h1').click();
 }
});


test('minimal settings preserve provider, server and autonext behavior',async({page})=>{
 await fixture(page);
 await page.getByRole('button',{name:'Playback settings',exact:true}).click();
 const menu=page.getByRole('region',{name:'Playback settings'});
 await expect(menu.getByRole('heading')).toHaveCount(0);
 await expect(menu.getByRole('button')).toHaveCount(0);
 await expect(menu.getByRole('combobox')).toHaveCount(2);
 await expect(menu.getByRole('combobox',{name:'Provider',exact:true})).toBeVisible();
 const request=page.waitForRequest(r=>r.url().endsWith('/playback') && r.postDataJSON().serverId==='backup');
 await page.getByRole('combobox',{name:'Server',exact:true}).selectOption('backup');
 expect((await request).postDataJSON()).toMatchObject({provider:'anikoto',serverId:'backup'});
 await page.getByLabel('Autonext').uncheck();
 await page.locator('.cinema-header h1').click();
 await page.locator('video').evaluate(v=>v.dispatchEvent(new Event('ended')));
 await expect(page.locator('.next-countdown')).toHaveCount(0);
 await page.reload();await page.getByRole('button',{name:'Playback settings',exact:true}).click();
 await expect(page.getByLabel('Autonext')).not.toBeChecked();
});


test('subtitle menu toggles captions, switches audio and dismisses outside',async({page})=>{
 await fixture(page);
 await page.getByRole('button',{name:'Subtitles',exact:true}).click();
 const menu=page.getByRole('region',{name:'Subtitle settings'});
 await expect(menu.getByRole('heading',{level:2})).toHaveCount(0);
 await expect(menu.getByRole('button',{name:'Close settings'})).toHaveCount(0);
 await expect(menu.getByRole('combobox')).toHaveCount(0);
 await menu.getByRole('button',{name:'On',exact:true}).click();
 await expect(page.locator('.subtitle-overlay')).toHaveText('A journey begins.');
 await expect(menu).toBeVisible();
 await menu.getByRole('button',{name:'Off',exact:true}).click();
 await expect(page.locator('.subtitle-overlay')).toBeEmpty();
 const dubRequest=page.waitForRequest(r=>r.url().endsWith('/playback')&&r.postDataJSON().audio==='dub');
 await menu.getByRole('button',{name:'Dub',exact:true}).click();
 await dubRequest;
 await expect(menu.getByRole('button',{name:'Dub',exact:true})).toHaveAttribute('aria-pressed','true');
 const subRequest=page.waitForRequest(r=>r.url().endsWith('/playback')&&r.postDataJSON().audio==='sub');
 await menu.getByRole('button',{name:'Sub',exact:true}).click();
 await subRequest;
 await page.locator('.cinema-header h1').click();
 await expect(menu).toHaveCount(0);
 await page.getByRole('button',{name:'Subtitles',exact:true}).click();
 await page.keyboard.press('Escape');
 await expect(menu).toHaveCount(0);
});

test('missing captions and unavailable dub are disabled',async({page})=>{
 await fixture(page,{dub:false,subtitles:false});
 await page.getByRole('button',{name:'Subtitles',exact:true}).click();
 const menu=page.getByRole('region',{name:'Subtitle settings'});
 await expect(menu.getByRole('button',{name:'On',exact:true})).toBeDisabled();
 await expect(menu.getByRole('button',{name:'Dub',exact:true})).toBeDisabled();
 await expect(menu.getByRole('button',{name:'Off',exact:true})).toBeEnabled();
 await expect(menu.getByRole('button',{name:'Sub',exact:true})).toBeEnabled();
 await page.screenshot({path:'artifacts/player/subtitle-menu-desktop.png'});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'artifacts/player/subtitle-menu-mobile.png'});
 const results=await new AxeBuilder({page}).include('.watch-content').analyze();expect(results.violations).toEqual([]);
 await page.mouse.click(190,200);
 await expect(menu).toHaveCount(0);
});

test('both menus animate in and out and respect reduced motion',async({page})=>{
 await fixture(page);
 for(const name of ['Playback settings','Subtitles']){
   await page.getByRole('button',{name,exact:true}).click();
   const card=page.locator('.cinema-panel');
   await expect(card).toHaveCSS('animation-name','player-menu-in');
   await page.locator('.cinema-header h1').click();
   await expect(card).toHaveClass(/is-closing/);
   await expect(card).toHaveAttribute('inert','');
   await expect(card).toHaveCount(0);
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.getByRole('button',{name:'Playback settings',exact:true}).click();
 await expect(page.locator('.cinema-panel')).toHaveCSS('animation-name','none');
 await page.locator('.cinema-header h1').click();
 await expect(page.locator('.cinema-panel')).toHaveCount(0);
});

test('next preview animates, time toggles above timeline and transport stays minimal',async({page})=>{
 await fixture(page);
 await expect(page.getByRole('button',{name:'Rewind 10 seconds'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Forward 10 seconds'})).toHaveCount(0);
 const time=page.getByRole('button',{name:'Show time remaining'});
 const timeline=await page.locator('.timeline').boundingBox();
 const timeBox=await time.boundingBox();
 expect(timeBox!.y+timeBox!.height).toBeLessThanOrEqual(timeline!.y);
 expect(timeBox!.x).toBe(timeline!.x);
 await time.click();
 await expect(page.getByRole('button',{name:'Show elapsed and total time'})).toHaveText(/remaining/);
 await page.getByRole('button',{name:'Show elapsed and total time'}).click();
 await expect(time).toHaveText(/0:00.*0:05/);
 const volume=page.getByRole('slider',{name:'Volume',exact:true});
 expect((await volume.boundingBox())!.width).toBeGreaterThanOrEqual(150);
 await volume.fill('0.5');
 await expect(page.locator('video')).toHaveJSProperty('volume',0.5);
 const next=page.getByRole('button',{name:'Next episode',exact:true});
 await next.hover();
 const preview=page.locator('.next-preview');
 await expect(preview).toHaveCSS('opacity','1');
 await expect(preview).toContainText('Episode 3');
 await page.screenshot({path:'artifacts/player/next-preview-desktop.png'});
 await page.mouse.move(700,300);
 await expect(preview).toHaveCSS('opacity','0');
 await expect(preview).toBeHidden();
 await next.focus();
 await expect(preview).toBeVisible();
 await page.keyboard.press('Enter');
 await expect(page).toHaveURL(/\/3$/);
});

test('idle mouse hides chrome and skip prompt while captions stay visible, motion restores it',async({page})=>{
 await fixture(page);
 await page.getByRole('button',{name:'Subtitles',exact:true}).click();
 await page.getByRole('button',{name:'On',exact:true}).click();
 await page.locator('.cinema-header h1').click();
 await page.getByRole('button',{name:'Play',exact:true}).click();
 await page.locator('video').evaluate(v=>(v as HTMLVideoElement).playbackRate=0.1);
 await page.mouse.move(720,350);
 await expect(page.locator('.watch-content')).toHaveClass(/controls-hidden/,{timeout:5000});
 await expect(page.locator('.cinema-header')).toHaveCSS('opacity','0');
 await expect(page.locator('.cinema-bottom')).toHaveCSS('opacity','0');
 await expect(page.locator('.skip-segment')).toHaveCSS('opacity','0');
 await expect(page.locator('.subtitle-overlay')).toHaveText('A journey begins.');
 await expect(page.locator('.subtitle-overlay')).toBeVisible();
 await page.mouse.move(721,351);
 await expect(page.locator('.watch-content')).not.toHaveClass(/controls-hidden/);
 await expect(page.locator('.cinema-bottom')).toHaveCSS('opacity','1');
});

test('volume bubble follows the thumb during dragging and hides after release',async({page})=>{
 await fixture(page);
 const slider=page.getByRole('slider',{name:'Volume',exact:true});
 const bounds=(await slider.boundingBox())!;
 await page.mouse.move(bounds.x+bounds.width-6,bounds.y+bounds.height/2);
 await page.mouse.down();
 await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
 const bubble=page.locator('.volume-tooltip');
 await expect(bubble).toHaveCSS('opacity','1');
 await expect(bubble).toHaveText('50%');
 const box=(await bubble.boundingBox())!;
 expect(Math.abs(box.x+box.width/2-(bounds.x+bounds.width/2))).toBeLessThan(2);
 expect(box.y+box.height).toBeLessThan(bounds.y+bounds.height/2);
 await page.screenshot({path:'artifacts/player/volume-tooltip.png'});
 await page.mouse.up();
 await expect(bubble).toHaveCSS('opacity','0');
 await expect(slider).toHaveAttribute('aria-valuetext','50%');
});

test('subtitle and audio choices persist across episodes and reloads', async ({page}) => {
 await fixture(page);
 await page.getByRole('button',{name:'Subtitles',exact:true}).click();
 await page.getByRole('button',{name:'On',exact:true}).click();
 await page.getByRole('button',{name:'Dub',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('moewatch-settings-v1')||'{}'))).toMatchObject({audio:'dub',subtitles:true});
 await page.locator('.cinema-header h1').click();
 await page.getByRole('button',{name:'Next episode',exact:true}).click();
 await expect(page).toHaveURL(/\/3$/);
 await page.reload();
 await page.getByRole('button',{name:'Subtitles',exact:true}).click();
 await expect(page.getByRole('button',{name:'Dub',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('button',{name:'On',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.subtitle-overlay')).toHaveText('A journey begins.');
 await page.getByRole('button',{name:'Off',exact:true}).click();
 await page.getByRole('button',{name:'Sub',exact:true}).click();
 await page.reload();
 await page.getByRole('button',{name:'Subtitles',exact:true}).click();
 await expect(page.getByRole('button',{name:'Sub',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('button',{name:'Off',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.subtitle-overlay')).toBeEmpty();
});

test('volume and mute persist across episodes and sessions', async ({page, browser}) => {
 await fixture(page);
 await page.getByRole('slider',{name:'Volume',exact:true}).fill('0.35');
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('moewatch-settings-v1')||'{}').volume)).toBe(0.35);
 await page.getByRole('button',{name:'Next episode',exact:true}).click();
 await expect(page).toHaveURL(/\/3$/);
 await expect(page.locator('video')).toHaveJSProperty('volume',0.35);
 await page.reload();
 await expect(page.locator('video')).toHaveJSProperty('volume',0.35);
 await expect(page.getByRole('slider',{name:'Volume',exact:true})).toHaveAttribute('aria-valuetext','35%');
 await page.getByRole('button',{name:'Mute',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('moewatch-settings-v1')||'{}').muted)).toBe(true);
 const state=await page.context().storageState();
 const context=await browser.newContext({storageState:state});
 try {
   const reopened=await context.newPage();
   await fixture(reopened);
   await expect(reopened.locator('video')).toHaveJSProperty('volume',0.35);
   await expect(reopened.locator('video')).toHaveJSProperty('muted',true);
   await reopened.getByRole('button',{name:'Unmute',exact:true}).click();
   await expect(reopened.getByRole('slider',{name:'Volume',exact:true})).toHaveAttribute('aria-valuetext','35%');
 } finally { await context.close(); }
});

test('source search shows only a spinner, then the mascot when no source exists', async ({ page }) => {
 let finishAvailability!: () => void;
 const pending = new Promise<void>(resolve => { finishAvailability = resolve; });
 await page.route('**/api/v1/**', async route => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith('/availability')) {
   await pending;
   return route.fulfill({ json: { animeId: 154587, providers: [] } });
  }
  if (path.endsWith('/anime/154587')) return route.fulfill({ json: { anime: curated[0] } });
  return route.fulfill({ json: { user: null, configured: false, providers: [] } });
 });
 await page.goto('/watch/154587/1', { waitUntil: 'domcontentloaded' });
 await expect(page.getByRole('status', { name: 'Finding video source' })).toBeVisible();
 await expect(page.locator('.buffer-spinner')).toBeVisible();
 await expect(page.locator('.player-empty')).toHaveCount(0);
 finishAvailability();
 await expect(page.locator('.player-empty')).toHaveText('no source could be found...');
 await expect(page.locator('.source-mascot')).toBeVisible();
 await expect(page.locator('.buffer-spinner')).toHaveCount(0);
});

