import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { curated } from '../src/catalog';
import { readFileSync } from 'node:fs';
import { emptyParty, type PartyStatus } from '../shared/watchparty';
const media=readFileSync('tests/fixtures/player-flower.mp4');
async function fixture(page:Page, options: { waitForMedia?: boolean; dub?: boolean; subtitles?: boolean; providerSkips?: { intro?: { start: number; end: number }; outro?: { start: number; end: number } }; skipUnavailable?: boolean; party?: boolean } = {}) {
 let party: PartyStatus = { ...emptyParty, enabled: true, room: 'fixture-room', self: '10', members: ['Mina', 'Alex', 'Sam', 'Rin', 'Yuki', 'Kai'].map((name,index) => ({ id: String(index + 10), name, avatar: 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30"><rect width="30" height="30" fill="${['#4aaf74','#e4b37c','#8b83c9','#d58e9d','#7da6bf','#c59cba'][index]}"/><circle cx="15" cy="11" r="5" fill="#fff"/><path d="M5 30v-3a10 10 0 0 1 20 0v3" fill="#fff"/></svg>`) })) };
 if (options.party) await page.addInitScript(() => {
   Object.defineProperty(window, 'EventSource', { value: class {
     onmessage: ((event: MessageEvent) => void) | null = null;
     onerror: (() => void) | null = null;
     private receive = (event: Event) => {
       const value = (event as CustomEvent).detail;
       document.documentElement.dataset.fixturePartyClock = String(value.playback?.clock || 0);
       this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent);
     };
     private fail = () => this.onerror?.();
     constructor() { window.addEventListener('fixture-party-state', this.receive); window.addEventListener('fixture-party-error', this.fail); }
     close() { window.removeEventListener('fixture-party-state', this.receive); window.removeEventListener('fixture-party-error', this.fail); }
   } });
 });
 await page.route('**/api/v1/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 if(path.endsWith('/discord/party')) return route.fulfill({json:options.party?party:emptyParty});
 if(options.party && path.includes('/discord/party/')) {
   if(path.endsWith('/leave')) party = { ...emptyParty, enabled: true };
   if(path.endsWith('/action')) party = { ...party, playback: { ...route.request().postDataJSON(), clock: (party.playback?.clock || 0) + 1, sender: party.self } };
   await route.fulfill({json:{ok:true}});
   if(!path.endsWith('/playback')) await page.evaluate(value => window.dispatchEvent(new CustomEvent('fixture-party-state', { detail: value })), party).catch(() => {});
   return;
 }
 if(path.endsWith('/account')) return route.fulfill({json:{user:null,configured:false}});
 if(path.endsWith('/availability'))return route.fulfill({json:{animeId:154587,providers:[{provider:'anikoto',status:'available',episodes:[1,3].map(number=>({id:String(number),number,kind:'regular',audio:options.dub===false?['sub']:['sub','dub']}))}]}});
 if(path.endsWith('/servers'))return route.fulfill({json:{servers:[{id:'main',name:'Main',audio:'sub'},{id:'backup',name:'Backup',audio:'sub'}]}});
 if(path.endsWith('/playback'))return route.fulfill({json:{provider:'anikoto',server:{id:'main',name:'Main'},...options.providerSkips,sources:[{url:'/media/fixture.mp4',type:'mp4',quality:'1080p'},{url:'/media/second.mp4',type:'mp4',quality:'720p'}],subtitles:options.subtitles===false?[]:[{url:'/media/sub.vtt',format:'vtt',label:'English',language:'en'}],attempts:[]}});
 if(path.includes('/skip-times/'))return route.fulfill({json:options.skipUnavailable?{status:'unavailable'}:{status:'available',malId:52991,intro:{start:0,end:2},outro:{start:4,end:5}}});
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
 if (options.waitForMedia !== false) await expect.poll(()=>page.locator('video').evaluate(v=>(v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
}
test('picture-in-picture toggles, follows native dismissal and handles rejection', async ({ page }) => {
 await page.addInitScript(() => {
   let current: HTMLVideoElement | null = null;
   Object.defineProperty(document, 'pictureInPictureEnabled', { value: true });
   Object.defineProperty(document, 'pictureInPictureElement', { get: () => current });
   HTMLVideoElement.prototype.requestPictureInPicture = async function () {
     current = this;
     this.dispatchEvent(new Event('enterpictureinpicture'));
     return {} as PictureInPictureWindow;
   };
   document.exitPictureInPicture = async () => {
     const video = current;
     current = null;
     video?.dispatchEvent(new Event('leavepictureinpicture'));
   };
 });
 await fixture(page);
 await page.getByRole('button', { name: 'Picture-in-picture', exact: true }).click();
 const exit = page.getByRole('button', { name: 'Exit picture-in-picture', exact: true });
 await expect(exit).toHaveAttribute('aria-pressed', 'true');
 await exit.click();
 await page.getByRole('button', { name: 'Picture-in-picture', exact: true }).click();
 await page.evaluate(() => document.exitPictureInPicture());
 await expect(page.getByRole('button', { name: 'Picture-in-picture', exact: true })).toHaveAttribute('aria-pressed', 'false');
 await page.locator('video').evaluate(video => {
   video.requestPictureInPicture = async () => { throw new Error('Denied'); };
 });
 await page.getByRole('button', { name: 'Picture-in-picture', exact: true }).click();
 await expect(page.getByRole('status').filter({ hasText: 'Picture-in-picture is unavailable' })).toBeVisible();
 await expect(page.locator('.player-empty')).toHaveCount(0);
});

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


test('player settings contain only provider and server controls',async({page})=>{
 await fixture(page);
 await page.getByRole('button',{name:'Playback settings',exact:true}).click();
 const menu=page.getByRole('region',{name:'Playback settings'});
 await expect(menu.getByRole('heading')).toHaveCount(0);
 await expect(menu.getByRole('button')).toHaveCount(0);
 await expect(menu.getByRole('combobox')).toHaveCount(2);
 await expect(menu.getByRole('combobox',{name:'Provider',exact:true})).toBeVisible();
 await expect(menu.getByRole('combobox',{name:'Sleep timer',exact:true})).toHaveCount(0);
 await expect(menu.getByLabel('Autonext')).toHaveCount(0);
 const request=page.waitForRequest(r=>r.url().endsWith('/playback') && r.postDataJSON().serverId==='backup');
 await page.getByRole('combobox',{name:'Server',exact:true}).selectOption('backup');
 expect((await request).postDataJSON()).toMatchObject({provider:'anikoto',serverId:'backup'});

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
   await expect(card).toHaveCSS('transition-property','opacity, transform');
   await expect(card).toHaveAttribute('data-open','true');
   await page.locator('.cinema-header h1').click();
   await expect(card).toHaveClass(/is-closing/);
   await expect(card).toHaveAttribute('inert','');
   await expect(card).toHaveCount(0);
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.getByRole('button',{name:'Playback settings',exact:true}).click();
 await expect(page.locator('.cinema-panel')).toHaveCSS('transform','none');
 await expect(page.locator('.cinema-panel')).toHaveCSS('transition-duration','0.12s');
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
 await page.keyboard.press('Tab');
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


test('scrubbing shows a frame and timestamp without moving playback on hover', async ({ page }) => {
 await fixture(page);
 const main = page.locator('.player-shell video');
 const before = await main.evaluate(v => v.currentTime);
 const timeline = page.locator('.timeline');
 const bounds = (await timeline.boundingBox())!;
 await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
 const preview = page.locator('.scrub-preview');
 await expect(preview).toBeVisible();
 await expect(preview.locator('span')).toHaveText('0:02');
 await expect.poll(() => preview.locator('canvas').evaluate(canvas => {
   const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
   return pixels.some((value, index) => index % 4 !== 3 && value > 0);
 })).toBe(true);
 expect(await main.evaluate(v => v.currentTime)).toBe(before);
 await page.mouse.move(20, 20);
 await expect(preview).toHaveCount(0);
 const slider = page.getByRole('slider', { name: 'Playback position' });
 await slider.focus();
 await slider.press('ArrowRight');
 await expect(preview).toBeVisible();
 await slider.blur();
 await expect(preview).toHaveCount(0);
});

test('playback errors use one mascot message and clear when switching servers', async ({ page }) => {
 await fixture(page);
 await page.locator('video').dispatchEvent('error');
 await expect(page.locator('.player-empty[role="alert"] .source-mascot')).toBeVisible();
 await expect(page.locator('.player-empty .source-status')).toHaveText('This source cannot be played. Try another server.');
 await expect(page.locator('.watch-content > .notice, .cinema-note')).toHaveCount(0);
 await expect(page.getByLabel('Choose a local video')).toBeHidden();
 await page.getByRole('button', { name: 'Playback settings', exact: true }).click();
 await page.getByRole('combobox', { name: 'Server', exact: true }).selectOption('backup');
 await expect(page.locator('.player-empty')).toHaveCount(0);
 await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
});

test('play button failures use the mascot instead of a control banner', async ({ page }) => {
 await fixture(page);
 await page.locator('video').evaluate(v => { v.play = () => Promise.reject(new Error('Unsupported source')); });
 await page.getByRole('button', { name: 'Play', exact: true }).click();
 await expect(page.locator('.player-empty[role="alert"] .source-mascot')).toBeVisible();
 await expect(page.locator('.cinema-note, .watch-content > .notice')).toHaveCount(0);
});

test('source resolution failures use one mascot message at desktop and mobile sizes', async ({ page }) => {
 await fixture(page);
 await page.route('**/api/v1/playback', route => route.fulfill({ status: 502, json: { error: { code: 'UPSTREAM_ERROR', message: 'Upstream unavailable' } } }));
 await page.getByRole('button', { name: 'Playback settings', exact: true }).click();
 await page.getByRole('combobox', { name: 'Server', exact: true }).selectOption('backup');
 await page.locator('.cinema-header h1').click();
 await expect(page.locator('.player-empty[role="alert"]')).toHaveText('No playable source found. Try another server.');
 await expect(page.locator('.source-mascot')).toBeVisible();
 await expect(page.locator('.notice, .cinema-note, .player-loading')).toHaveCount(0);
 await expect(page.locator('.cinema-panel')).toHaveCount(0);
 for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]] as const) {
  await page.setViewportSize({ width, height });
  const message = page.locator('.source-status');
  expect(await message.evaluate(el => el.getBoundingClientRect().height <= parseFloat(getComputedStyle(el).lineHeight) + 1)).toBe(true);
  await page.screenshot({ path: `artifacts/player/error-${name}.png` });
 }
});

test('interrupted play does not show a playback error', async ({ page }) => {
 await fixture(page);
 await page.locator('video').evaluate(v => { v.play = () => Promise.reject(new DOMException('Interrupted', 'AbortError')); });
 await page.getByRole('button', { name: 'Play', exact: true }).click();
 await expect(page.locator('.player-empty, .notice, .cinema-note')).toHaveCount(0);
});

test('HLS uses MediaSource even when native playback reports maybe', async ({ page }) => {
 await page.addInitScript(() => {
  const original = HTMLMediaElement.prototype.canPlayType;
  HTMLMediaElement.prototype.canPlayType = function(type) { return type === 'application/vnd.apple.mpegurl' ? 'maybe' : original.call(this, type); };
 });
 await fixture(page);
 await page.route('**/api/v1/playback', route => route.fulfill({ json: { provider: 'anikoto', server: { id: 'main', name: 'Main' }, sources: [{ url: '/media/test.m3u8', type: 'hls' }], subtitles: [], attempts: [] } }));
 await page.route('**/media/test.m3u8', route => route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: '#EXTM3U\n' }));
 await page.reload();
 await expect(page.locator('video')).toHaveAttribute('src', /^blob:/);
});

test('subtitle and fullscreen failures leave playback usable', async ({ page }) => {
 await fixture(page);
 await page.route('**/media/sub.vtt', route => route.fulfill({ status: 503, body: '' }));
 await page.getByRole('button', { name: 'Play', exact: true }).click();
 await page.getByRole('button', { name: 'Subtitles', exact: true }).click();
 await page.getByRole('button', { name: 'On', exact: true }).click();
 await expect(page.getByRole('status')).toHaveText('Subtitles could not be loaded.');
 await expect(page.locator('video')).toHaveJSProperty('paused', false);
 await expect(page.locator('.player-empty')).toHaveCount(0);
 await page.getByRole('button', { name: 'Off', exact: true }).click();
 await expect(page.getByText('Subtitles could not be loaded.')).toHaveCount(0);
 await page.locator('.cinema-header h1').click();
 await page.locator('.player-shell video').evaluate(element => { element.closest('.watch-content')!.requestFullscreen = () => Promise.reject(new Error('Unavailable')); });
 await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
 await expect(page.getByRole('status')).toHaveText('Fullscreen is unavailable in this browser.');
 await expect(page.locator('video')).toHaveJSProperty('paused', false);
 await expect(page.locator('.player-empty')).toHaveCount(0);
});

test('failed availability checks can be retried from the mascot', async ({ page }) => {
 await fixture(page);
 await page.route('**/api/v1/anime/*/availability', route => route.fulfill({ status: 503, json: { error: { message: 'Unavailable' } } }));
 await page.reload();
 await expect(page.getByRole('alert')).toContainText('Sources could not be checked.');
 await page.unroute('**/api/v1/anime/*/availability');
 await page.getByRole('button', { name: 'Retry source check', exact: true }).click();
 await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
 await expect(page.locator('.player-empty')).toHaveCount(0);
});


test('player artwork fades after the first frame and stays hidden during buffering', async ({ page }) => {
 await fixture(page);
 const backdrop = page.locator('.player-backdrop');
 await expect(backdrop).toHaveClass(/is-revealed/);
 await page.locator('video').evaluate(video => video.dispatchEvent(new Event('waiting')));
 await expect(backdrop).toHaveClass(/is-revealed/);
 await page.emulateMedia({ reducedMotion: 'reduce' });
 await expect(backdrop).toHaveCSS('transition-duration', '0s');
});


test('artwork waits for a presented video frame rather than canplay', async ({ page }) => {
 await page.addInitScript(() => {
   HTMLVideoElement.prototype.requestVideoFrameCallback = function(callback) {
     (window as unknown as { presentFrame: () => void }).presentFrame = () => callback(0, {} as VideoFrameCallbackMetadata);
     return 1;
   };
   HTMLVideoElement.prototype.cancelVideoFrameCallback = () => {};
 });
 await fixture(page);
 await expect(page.locator('.player-backdrop')).not.toHaveClass(/is-revealed/);
 await page.locator('video').evaluate(video => video.dispatchEvent(new Event('canplay')));
 await expect(page.locator('.player-backdrop')).not.toHaveClass(/is-revealed/);
 await page.evaluate(() => (window as unknown as { presentFrame: () => void }).presentFrame());
 await expect(page.locator('.player-backdrop')).toHaveClass(/is-revealed/);
});

test('Back to series shares the player surface with the destination hero', async ({ page }) => {
 await fixture(page);
 await page.evaluate(() => {
   const start = document.startViewTransition.bind(document);
   document.startViewTransition = ((update: () => Promise<void>) => start(async () => {
     await update();
     const hero = document.querySelector('.detail-hero');
     if (hero) document.documentElement.dataset.returnSurface = getComputedStyle(hero).viewTransitionName;
   })) as typeof document.startViewTransition;
 });
 await page.getByRole('link', { name: 'Back to series' }).click();
 await expect(page).toHaveURL(/\/anime\/154587$/);
 await expect(page.locator('html')).toHaveAttribute('data-return-surface', 'playback-surface');
 await expect(page.locator('.detail-hero')).toBeVisible();
});


test('provider opening wins, AniSkip fills ending and timeline marks both intervals', async ({ page }) => {
 await fixture(page, { providerSkips: { intro: { start: 0, end: 1 } } });
 await expect(page.locator('.timeline-segment')).toHaveCount(2);
 await expect(page.locator('.timeline-segment-intro')).toHaveCSS('background-color', 'rgb(131, 170, 165)');
 await expect(page.locator('.timeline-segment-outro')).toHaveCSS('background-color', 'rgb(158, 142, 170)');
 await page.getByRole('button', { name: 'Skip opening', exact: true }).click();
 await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).currentTime)).toBeCloseTo(1, 1);
 await page.getByRole('slider', { name: 'Playback position' }).fill('4.2');
 await expect(page.getByRole('button', { name: 'Skip ending', exact: true })).toBeVisible();
 await page.getByRole('button', { name: 'Skip ending', exact: true }).click();
 await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).currentTime)).toBeGreaterThanOrEqual(5);
 await page.getByLabel('Choose a local video').setInputFiles({ name: 'local.mp4', mimeType: 'video/mp4', buffer: media });
 await expect(page.locator('.timeline-segment')).toHaveCount(0);
 await expect(page.locator('.skip-segment')).toHaveCount(0);
});

test('complete provider timings skip AniSkip lookup and render at desktop and mobile sizes', async ({ page }) => {
 const requests: string[] = [];
 page.on('request', r => { if (r.url().includes('/skip-times/')) requests.push(r.url()); });
 await fixture(page, { providerSkips: { intro: { start: 0, end: 1 }, outro: { start: 4, end: 5 } } });
 await expect(page.locator('.timeline-segment')).toHaveCount(2);
 for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]] as const) {
  await page.setViewportSize({ width, height });
  await page.getByRole('slider', { name: 'Playback position' }).fill('2');
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.screenshot({ path: 'artifacts/player/segments-' + name + '.png' });
  const rail = await page.locator('.timeline').boundingBox();
  const marker = await page.locator('.timeline-segment-outro').boundingBox();
  expect(marker!.x).toBeGreaterThan(rail!.x);
  expect(marker!.x + marker!.width).toBeLessThanOrEqual(rail!.x + rail!.width);
 }
 expect(requests).toEqual([]);
});

test('provider timings survive AniSkip outage', async ({ page }) => {
 await fixture(page, { providerSkips: { intro: { start: 0, end: 1 } }, skipUnavailable: true });
 await expect(page.locator('.timeline-segment')).toHaveCount(1);
 await expect(page.getByRole('button', { name: 'Skip opening', exact: true })).toBeVisible();
});


test('changing sources clears previous provider and fallback markers', async ({ page }) => {
 await fixture(page, { providerSkips: { intro: { start: 0, end: 1 } } });
 await expect(page.locator('.timeline-segment')).toHaveCount(2);
 await page.route('**/api/v1/**/skip-times/*?*', route => route.fulfill({ json: { status: 'unavailable' } }));
 await page.route('**/api/v1/**/playback', route => route.fulfill({ json: {
  provider: 'anikoto', server: { id: 'backup', name: 'Backup' },
  sources: [{ url: '/media/second.mp4', type: 'mp4' }], subtitles: [], attempts: [],
 } }));
 await page.getByRole('button', { name: 'Playback settings', exact: true }).click();
 await page.getByRole('combobox', { name: 'Server', exact: true }).selectOption('backup');
 await expect(page.locator('video')).toHaveAttribute('src', /second.mp4/);
 await expect(page.locator('.timeline-segment')).toHaveCount(0);
 await expect(page.locator('.skip-segment')).toHaveCount(0);
});


test('Resume restores progress and starts playing without another click', async ({ page }) => {
 await fixture(page);
 const duration = await page.locator('video').evaluate(v => (v as HTMLVideoElement).duration);
 await page.evaluate(({ anime, duration }) => localStorage.setItem('moewatch-library-v1', JSON.stringify({ saved: [], progress: [{ anime, episode: 1, time: 2, duration, updated: Date.now() }] })), { anime: curated[0], duration });
 await page.goto('/anime/154587');
 await page.getByRole('link', { name: 'Resume episode 1', exact: true }).click();
 await expect.poll(() => page.locator('video').evaluate(v => !(v as HTMLVideoElement).paused)).toBe(true);
 await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).currentTime)).toBeGreaterThan(2);
});

test.describe('touch player', () => {
 test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
 test('touch seek preview clears after release and toolbar taps do not seek', async ({ page }) => {
  await fixture(page);
  const slider = page.getByRole('slider', { name: 'Playback position' });
  await slider.tap();
  await expect(page.locator('.scrub-preview')).toHaveCount(0);
  const before = await page.locator('video').evaluate(v => v.currentTime);
  await page.getByRole('button', { name: 'Play', exact: true }).tap();
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
  await page.getByRole('button', { name: 'Pause', exact: true }).tap();
  expect(Math.abs(await page.locator('video').evaluate(v => v.currentTime) - before)).toBeLessThan(1);
  await page.getByRole('button', { name: 'Playback settings', exact: true }).tap();
  await expect(page.getByRole('combobox', { name: 'Provider', exact: true })).toBeVisible();
 });
});

test('touch drag releases its seek preview', async ({ page }) => {
 await fixture(page);
 const slider = page.getByRole('slider', { name: 'Playback position' });
 await slider.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 7 });
 await slider.dispatchEvent('pointermove', { pointerType: 'touch', pointerId: 7, clientX: 300 });
 await expect(page.locator('.scrub-preview')).toBeVisible();
 await slider.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 7 });
 await expect(page.locator('.scrub-preview')).toHaveCount(0);
});

test.describe('landscape touch controls', () => {
 test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
 test('toolbar edges and volume taps do not move playback position', async ({ page }) => {
  await fixture(page);
  const video = page.locator('.player-shell video');
  const before = await video.evaluate(v => v.currentTime);
  await page.getByRole('button', { name: 'Mute', exact: true }).tap({ position: { x: 22, y: 2 } });
  await expect(video).toHaveJSProperty('muted', true);
  await page.getByRole('slider', { name: 'Volume', exact: true }).tap();
  await expect(video).toHaveJSProperty('muted', false);
  expect(await video.evaluate(v => v.currentTime)).toBe(before);
  await page.getByRole('button', { name: 'Play', exact: true }).tap({ position: { x: 22, y: 2 } });
  await expect(video).toHaveJSProperty('paused', false);
  await page.getByRole('button', { name: 'Pause', exact: true }).tap();
  await expect(video).toHaveJSProperty('paused', true);
  expect(Math.abs(await video.evaluate(v => v.currentTime) - before)).toBeLessThan(1);
  await expect(page.locator('.scrub-preview')).toHaveCount(0);
 });
});

test('watchparty shows four avatars and overflow, retains audio, and leaves with a bare icon', async ({ page }) => {
  await fixture(page, { party: true });
  await expect(page.locator('.party-avatar:not(.party-overflow)')).toHaveCount(4);
  await expect(page.locator('.party-overflow')).toHaveText('+2');
  await expect(page.locator('.party-avatar').first()).toHaveCSS('border-width', '0px');
  expect(await page.locator('.party-avatar').first().evaluate(node => getComputedStyle(node).maskImage)).toContain('radial-gradient');
  expect(await page.locator('.view-controls').evaluate(node => node.firstElementChild?.classList.contains('watchparty'))).toBe(true);
  const leave = page.getByRole('button', { name: 'Leave watchparty' });
  await expect(leave).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await leave.hover();
  await expect(leave).toHaveCSS('color', 'rgb(241, 108, 120)');
  await expect(leave).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.getByRole('button', { name: 'Subtitles', exact: true }).click();
  const resolution = page.waitForRequest(request => request.url().endsWith('/api/v1/playback') && request.postDataJSON().audio === 'dub');
  await page.getByRole('button', { name: 'Dub', exact: true }).click();
  await resolution;
  await expect(page.getByRole('button', { name: 'Dub', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.cinema-header h1').click();
  await expect(page.locator('.cinema-panel')).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/watchparty/desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(leave).toBeVisible();
  expect(await page.locator('.watchparty').evaluate(node => node.getBoundingClientRect().right <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/watchparty/mobile.png' });
  await leave.click();
  await expect(page.locator('.watchparty')).toHaveCount(0);
  await expect(page.locator('.player-shell video')).toHaveCount(1);
});

test.describe('watchparty landscape mobile', () => {
 test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
 test('party controls fit beside Next and skip controls align with the timestamp', async ({ page }) => {
  await fixture(page, { party: true });
  await expect(page.locator('.player-backdrop')).toHaveCSS('opacity', '0');
  const party = await page.locator('.watchparty').boundingBox();
  const next = await page.getByRole('button', { name: 'Next episode', exact: true }).boundingBox();
  const time = await page.locator('.player-time').boundingBox();
  const skip = await page.getByRole('button', { name: 'Skip opening', exact: true }).boundingBox();
  expect(party!.x + party!.width).toBeLessThanOrEqual(next!.x);
  expect(Math.abs(time!.y + time!.height / 2 - skip!.y - skip!.height / 2)).toBeLessThan(1);
  expect(await page.locator('.view-controls').evaluate(node => node.getBoundingClientRect().right <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/watchparty/landscape-mobile.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator('.watch-content').evaluate(node => ({ width: Math.round(node.clientWidth), height: Math.round(node.clientHeight) }))).toEqual({ width: 844, height: 390 });
  const root = await page.locator('.watch-content').boundingBox();
  expect(Math.round(root!.width)).toBe(390);
  expect(Math.round(root!.height)).toBe(844);
  await page.screenshot({ path: 'artifacts/watchparty/portrait-landscape-fallback.png' });
  await page.getByRole('button', { name: 'Leave watchparty' }).tap();
  await expect(page.locator('.watchparty')).toHaveCount(0);
 });
});

test('remote controls correct drift without feedback, retain preferences, and reuse the mascot for errors', async ({ page }) => {
  const commands: unknown[] = [];
  page.on('request', request => { if (request.url().endsWith('/discord/party/action')) commands.push(request.postDataJSON()); });
  await fixture(page, { party: true });
  const video = page.locator('.player-shell video');
  await page.getByRole('slider', { name: 'Volume', exact: true }).fill('0.35');
  const remote = async (clock: number, time: number, error = '') => page.evaluate(({ clock, time, error }) => {
    window.dispatchEvent(new CustomEvent('fixture-party-state', { detail: {
      enabled: true, room: 'fixture-room', self: '10', members: [{ id: '10', name: 'Mina', avatar: '' }, { id: '20', name: 'Alex', avatar: '' }], error,
      playback: { animeId: 154587, episode: 1, time, paused: true, rate: 1, at: Date.now(), clock, sender: '20', action: 'pause' },
    } }));
  }, { clock, time, error });
  await remote(1, 3);
  await expect.poll(() => video.evaluate(v => v.currentTime)).toBeCloseTo(3, 1);
  await expect(video).toHaveJSProperty('volume', 0.35);
  expect(commands).toHaveLength(0);
  await remote(2, 3.5);
  await expect(video).toHaveJSProperty('paused', true);
  expect(await video.evaluate(v => v.currentTime)).toBeCloseTo(3, 1);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => commands.length).toBe(1);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(() => commands.length).toBe(2);
  await expect(page.locator('html')).toHaveAttribute('data-fixture-party-clock', '2');
  await remote(5, 3, 'Watchparty sync disconnected. Leave the party to continue watching on your own.');
  await expect(page.locator('.player-empty .source-mascot')).toBeVisible();
  await expect(page.locator('.player-empty')).toContainText('Watchparty sync disconnected');
  await page.getByRole('button', { name: 'Leave watchparty' }).click();
  await expect(page.locator('.player-empty')).toHaveCount(0);
});

test('an accepted Discord invite opens its episode from home without automatically leaving', async ({ page }) => {
  let leaves = 0;
  page.on('request', request => { if (request.url().endsWith('/discord/party/leave')) ++leaves; });
  await fixture(page, { party: true });
  await page.goto('/');
  await expect(page.locator('main')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('fixture-party-state', { detail: {
    enabled: true, active: false, destination: { animeId: 154587, episode: 3 }, room: '', self: '10', members: [], playback: null, error: '',
  } })));
  await expect(page).toHaveURL(/\/watch\/154587\/3$/);
  await expect(page.locator('.cinema-header p')).toHaveText('Episode 3');
  expect(leaves).toBe(0);
});

test('local event stream recovery restores playback without sending another group command', async ({ page }) => {
  const commands: unknown[] = [];
  page.on('request', request => { if (request.url().endsWith('/discord/party/action')) commands.push(request.postDataJSON()); });
  await fixture(page, { party: true });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-fixture-party-clock', '1');
  await page.evaluate(() => window.dispatchEvent(new Event('fixture-party-error')));
  await expect(page.locator('.player-empty')).toContainText('Watchparty sync disconnected');
  await expect(page.locator('.player-shell video')).toHaveJSProperty('paused', true);
  await page.evaluate(async () => {
    const status = await (await fetch('/api/v1/discord/party')).json();
    window.dispatchEvent(new CustomEvent('fixture-party-state', { detail: status }));
  });
  await expect(page.locator('.player-shell video')).toHaveJSProperty('paused', false);
  await expect(page.locator('.player-empty')).toHaveCount(0);
  expect(commands).toHaveLength(1);
});


test.describe('mobile immersive player', () => {
 test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
 test('mobile landscape stays inline until native fullscreen is requested', async ({ page }) => {
  await fixture(page);
  await expect(page.getByRole('button', { name: 'Fullscreen', exact: true })).toBeVisible();
  const bounds = (await page.locator('.watch-content').boundingBox())!;
  expect(Math.round(bounds.width)).toBe(390);
  expect(Math.round(bounds.height)).toBe(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.evaluate(() => {
   Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
   document.documentElement.requestFullscreen = async () => { document.documentElement.dataset.mobileFullscreenRequested = 'true'; };
  });
  await page.getByRole('button', { name: 'Play', exact: true }).tap();
  await expect(page.locator('html')).not.toHaveAttribute('data-mobile-fullscreen-requested', 'true');
  await page.getByRole('button', { name: 'Pause', exact: true }).tap();
  const video = page.locator('.player-shell video');
  await video.evaluate(element => {
   Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false });
   Object.defineProperty(element, 'webkitEnterFullscreen', { value: () => element.dispatchEvent(new Event('webkitbeginfullscreen')) });
  });
  await page.getByRole('button', { name: 'Subtitles', exact: true }).tap();
  await page.getByRole('button', { name: 'On', exact: true }).tap();
  await expect(page.locator('.subtitle-overlay')).toHaveText('A journey begins.');
  await page.locator('.cinema-header h1').tap();
  const time = await video.evaluate(element => element.currentTime);
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).tap();
  await expect(video).toHaveJSProperty('controls', true);
  await expect.poll(() => video.evaluate(element => element.textTracks[0]?.mode)).toBe('showing');
  await video.dispatchEvent('click');
  await expect(video).toHaveJSProperty('paused', true);
  await video.dispatchEvent('webkitendfullscreen');
  await expect(video).toHaveJSProperty('controls', false);
  await expect.poll(() => video.evaluate(element => element.textTracks[0]?.mode)).toBe('disabled');
  expect(await video.evaluate(element => element.currentTime)).toBe(time);
  await video.dispatchEvent('webkitbeginfullscreen');
  expect(await video.evaluate(element => element.textTracks[0]?.cues?.length)).toBe(1);
  await video.dispatchEvent('webkitendfullscreen');
 });
});
test('player reverses pointer menus and keyboard opens immediately', async ({ page }) => {
 await fixture(page);
 const trigger = page.getByRole('button', { name: 'Playback settings', exact: true });
 await trigger.click();
 const panel = page.locator('.cinema-panel');
 await page.evaluate(() => document.querySelector<HTMLButtonElement>('#player-settings')?.click());
 await expect(panel).toHaveAttribute('inert', '');
 await page.evaluate(() => document.querySelector<HTMLButtonElement>('#player-settings')?.click());
 await expect(panel).toHaveAttribute('data-open', 'true');
 await expect(panel).toHaveCSS('opacity', '1');
 await page.keyboard.press('Escape'); await expect(panel).toHaveCount(0);
 await trigger.press('Enter'); await expect(panel).toHaveCSS('transition-duration', '0s');
 await page.keyboard.press('Escape');
 await page.setViewportSize({ width: 390, height: 844 });
 await trigger.click(); await expect(panel).toHaveCSS('transform-origin', /.+/);
 await expect(panel).toHaveCSS('transition-duration', '0.22s, 0.22s');
 await page.keyboard.press('Escape');
 await page.evaluate(() => { document.documentElement.dataset.reduceMotion = 'true'; });
 await trigger.click(); await expect(panel).toHaveCSS('transition-duration', '0.12s');
 await expect(panel).toHaveCSS('transform', 'none');
});

test('next preview uses keyboard instantly and touch does not synthesize a reveal', async ({ page, browser }) => {
 await fixture(page);
 await page.getByRole('button', { name: 'Next episode', exact: true }).focus();
 await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
 await expect(page.locator('.next-preview')).toHaveCSS('transition-duration', '0s');
 await expect(page.locator('.next-preview')).toHaveCSS('opacity', '1');
 const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
 const touch = await context.newPage(); await fixture(touch);
 await touch.locator('.next-control').dispatchEvent('pointerover', { pointerType: 'touch' });
 await expect(touch.locator('.next-preview')).toHaveCSS('visibility', 'hidden');
 await context.close();
});

test.describe('mobile player scroll lock', () => {
 test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
 test('player has no page scrollbar, blocks page swipes and unlocks after Back', async ({ page }) => {
  await fixture(page, { waitForMedia: false });
  await expect(page.getByRole('scrollbar', { name: 'Page scroll' })).toHaveCount(0);
  await expect(page.locator('body')).toHaveCSS('position', 'fixed');
  const prevented = await page.locator('.watch-content').evaluate(root => {
   const event = new Event('touchmove', { bubbles: true, cancelable: true });
   root.dispatchEvent(event);
   return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await page.getByRole('button', { name: 'Playback settings', exact: true }).tap();
  const panelPrevented = await page.locator('.cinema-panel').evaluate(root => {
   const event = new Event('touchmove', { bubbles: true, cancelable: true });
   root.dispatchEvent(event);
   return event.defaultPrevented;
  });
  expect(panelPrevented).toBe(false);
  await page.getByRole('link', { name: 'Back to series' }).tap();
  await expect(page).toHaveURL(/\/anime\/154587$/);
  await expect(page.locator('body')).not.toHaveCSS('position', 'fixed');
 });
});


test('custom fullscreen keeps player controls and restores the button on exit', async ({ page }) => {
 await fixture(page);
 await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
 await expect.poll(() => page.evaluate(() => document.fullscreenElement?.className)).toContain('watch-content');
 await expect(page.locator('.player-shell video')).toHaveJSProperty('controls', false);
 await expect(page.getByRole('button', { name: 'Exit fullscreen', exact: true })).toBeVisible();
 await page.evaluate(() => document.exitFullscreen());
 await expect(page.getByRole('button', { name: 'Fullscreen', exact: true })).toBeVisible();
 await expect(page.locator('.player-shell video')).toHaveJSProperty('controls', false);
});


test('native player controls sync watchparty actions without remote echoes', async ({ page }) => {
 const commands: unknown[] = [];
 page.on('request', request => { if (request.url().endsWith('/discord/party/action')) commands.push(request.postDataJSON()); });
 await fixture(page, { party: true });
 const video = page.locator('.player-shell video');
 await video.dispatchEvent('webkitbeginfullscreen');
 await video.evaluate(element => element.play());
 await expect.poll(() => commands.length).toBe(1);
 await video.evaluate(element => element.pause());
 await expect.poll(() => commands.length).toBe(2);
 await video.evaluate(element => { element.currentTime = 3; });
 await expect.poll(() => commands.length).toBe(3);
 await video.evaluate(element => { element.playbackRate = 1.25; });
 await expect.poll(() => commands.length).toBe(4);
 await page.evaluate(() => window.dispatchEvent(new CustomEvent('fixture-party-state', { detail: {
  enabled: true, active: true, destination: null, room: 'room', self: '10', members: [], error: '',
  playback: { animeId: 154587, episode: 1, time: 1, paused: true, rate: 1, at: Date.now(), action: 'seek', clock: 100, sender: '20' },
 } })));
 await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(1, 1);
 await video.dispatchEvent('webkitendfullscreen');
 expect(commands).toHaveLength(4);
});

test('watchparty readiness stays below the spinner and playback waits for the group', async ({ page }) => {
  await fixture(page, { party: true });
  const readiness: string[] = [];
  await page.route('**/api/v1/discord/party/ready', async route => {
    readiness.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  await page.evaluate(async () => {
    const state = await (await fetch('/api/v1/discord/party')).json();
    window.dispatchEvent(new CustomEvent('fixture-party-state', { detail: { ...state,
      loading: { id: '5:10', animeId: 154587, episode: 1, ready: ['10', '11'] },
      playback: { animeId: 154587, episode: 1, time: 0, paused: true, rate: 1, at: Date.now(), action: 'episode', clock: 5, sender: '10', transition: '5:10' },
    } }));
  });
  await expect(page.locator('.party-ready-count')).toHaveText('(2/6)');
  await expect(page.locator('.party-ready-avatar.is-ready')).toHaveCount(2);
  await expect(page.locator('.party-ready-avatar:not(.is-ready)')).toHaveCount(4);
  await expect(page.locator('.party-ready-avatar:not(.is-ready)').first()).toHaveCSS('opacity', '0.3');
  await expect(page.locator('.player-shell video')).toHaveJSProperty('paused', true);
  await expect.poll(() => readiness.includes('5:10')).toBe(true);
  const spinner = (await page.locator('.buffer-spinner').boundingBox())!;
  const avatars = (await page.locator('.party-ready-avatars').boundingBox())!;
  expect(avatars.y).toBeGreaterThan(spinner.y + spinner.height);
  await page.evaluate(async () => {
    const state = await (await fetch('/api/v1/discord/party')).json();
    window.dispatchEvent(new CustomEvent('fixture-party-state', { detail: { ...state,
      playback: { animeId: 154587, episode: 1, time: 0, paused: false, rate: 1, at: Date.now(), action: 'play', clock: 8, sender: '10', transition: '5:10' },
    } }));
  });
  await expect(page.locator('.party-readiness')).toHaveCount(0);
  await expect(page.locator('.player-shell video')).toHaveJSProperty('paused', false);
});

test('sleep timer pauses playback, cancels autoplay and resumes only on confirmation', async ({ page }) => {
 await page.clock.install();
 await fixture(page);
 await page.evaluate(async () => {
   const { watchSession } = await import('/src/playback/watchSession.ts');
   watchSession.sleepUntil = Date.now() + 15 * 60_000;
 });
 await page.locator('video').evaluate(video => video.dispatchEvent(new Event('ended')));
 await expect(page.locator('.next-countdown')).toBeVisible();
 await page.clock.fastForward(15 * 60_000);
 const dialog = page.getByRole('dialog', { name: 'Sleep timer finished' });
 await expect(dialog).toBeVisible();
 await expect(dialog.locator('img')).toHaveAttribute('src', '/error-mascot.png');
 await expect(page.locator('.next-countdown')).toHaveCount(0);
 await expect.poll(() => page.locator('video').evaluate(video => video.paused)).toBe(true);
 await dialog.getByRole('button', { name: 'Keep watching' }).click();
 await expect(dialog).toHaveCount(0);
 await expect.poll(() => page.locator('video').evaluate(video => video.paused)).toBe(false);
});

test('unattended playback requires confirmation before another episode', async ({ page }) => {
 await fixture(page);
 await page.evaluate(async () => {
   const modulePath = '/src/playback/watchSession.ts';
   const { watchSession } = await import(modulePath);
   watchSession.unattendedMs = 90 * 60_000;
 });
 await page.locator('video').evaluate(video => video.dispatchEvent(new Event('ended')));
 const dialog = page.getByRole('dialog', { name: 'Still watching?' });
 await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('button', { name: 'Keep watching' })).toBeFocused();
 await expect(page.locator('.next-countdown')).toHaveCount(0);
 await page.keyboard.press('Escape');
 await expect(dialog).toBeVisible();
 await dialog.getByRole('button', { name: 'Stop watching' }).click();
 await expect(dialog).toHaveCount(0);
 await expect(page).toHaveURL(/\/1$/);
 await expect.poll(() => page.locator('video').evaluate(video => video.paused)).toBe(true);
});

test('video fullscreen remains available without element fullscreen', async ({ page }) => {
 await fixture(page);
 await page.evaluate(() => Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false }));
 await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
 await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName)).toBe('VIDEO');
 await expect(page.locator('.player-shell video')).toHaveJSProperty('controls', true);
 await page.evaluate(() => document.exitFullscreen());
 await expect(page.locator('.player-shell video')).toHaveJSProperty('controls', false);
 await expect(page.getByRole('button', { name: 'Fullscreen', exact: true })).toBeVisible();
});

test('touch devices keep custom controls when element fullscreen is available', async ({ browser }) => {
 const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
 const page = await context.newPage();
 try {
  await fixture(page);
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.className)).toContain('watch-content');
  await expect(page.locator('.player-shell video')).toHaveJSProperty('controls', false);
  const bounds = await page.locator('.watch-content').boundingBox();
  expect(Math.round(bounds!.width)).toBe(390);
  expect(Math.round(bounds!.height)).toBe(844);
  const timeline = page.locator('.timeline');
  const timelineBounds = (await timeline.boundingBox())!;
  await timeline.dispatchEvent('pointerdown', { pointerType: 'touch' });
  await timeline.dispatchEvent('pointermove', { pointerType: 'touch', clientX: timelineBounds.x + timelineBounds.width / 2, clientY: timelineBounds.y + timelineBounds.height / 2 });
  const duration = await page.locator('video').evaluate(video => video.duration);
  const previewTime = await page.locator('.scrub-preview span').textContent();
  expect(previewTime).toBe('0:' + String(Math.floor(duration / 2)).padStart(2, '0'));
  await timeline.dispatchEvent('pointercancel');
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
 } finally { await context.close(); }
});

test('failed native fullscreen exit retains native controls', async ({ page }) => {
 await fixture(page);
 const video = page.locator('video');
 await video.dispatchEvent('webkitbeginfullscreen');
 await video.evaluate(element => {
  Object.defineProperty(element, 'webkitExitFullscreen', { value: () => { throw new Error('Exit failed'); } });
 });
 await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
 await expect(page.getByRole('status')).toHaveText('Fullscreen is unavailable in this browser.');
 await expect(video).toHaveJSProperty('controls', true);
 await video.dispatchEvent('webkitendfullscreen');
 await expect(video).toHaveJSProperty('controls', false);
});

test('saved playback preferences disable resume and skip openings automatically', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('moewatch-settings-v1', JSON.stringify({ resumePlayback: false, skipOpening: true, autoNext: false }));
    localStorage.setItem('moewatch-autonext', 'true');
  });
  await fixture(page, { providerSkips: { intro: { start: 0, end: 2 } } });
  await expect(page.locator('video')).toHaveJSProperty('currentTime', 0);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThanOrEqual(2);
  await page.locator('video').evaluate(video => video.dispatchEvent(new Event('ended')));
  await expect(page.getByText('Next episode in 5')).not.toBeVisible();
});

test('subtitle appearance applies without a delay control', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('moewatch-settings-v1', JSON.stringify({ subtitles: true, subtitleSize: 150, subtitleBackground: 75 })));
  await fixture(page);
  await expect(page.locator('.subtitle-overlay span')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.75)');
  await page.getByRole('button', { name: 'Subtitles', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Subtitle delay in seconds' })).toHaveCount(0);
  await page.getByRole('slider', { name: 'Playback position' }).fill('3');
  await expect(page.locator('.subtitle-overlay')).toHaveText('A journey begins.');
});

test('player preference updates preserve focus in captions and settings', async ({ page }) => {
 await fixture(page);
 await page.getByRole('button', { name: 'Subtitles', exact: true }).click();
 const off = page.getByRole('button', { name: 'Off', exact: true });
 await off.focus();
 await page.keyboard.press('Enter');
 await expect(off).toBeFocused();
 await expect(off).toHaveAttribute('aria-pressed', 'true');
 await page.getByRole('button', { name: 'Playback settings', exact: true }).click();
 const provider = page.getByRole('combobox', { name: 'Provider', exact: true });
 await provider.focus();
 await page.locator('video').evaluate(video => { video.volume = 0.4; });
 await expect(page.getByRole('slider', { name: 'Volume', exact: true })).toHaveValue('0.4');
 await expect(provider).toBeFocused();
});
