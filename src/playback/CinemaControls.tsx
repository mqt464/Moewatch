import { usePresence } from '../motion';
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, Settings2, Captions, SkipForward, PictureInPicture2 } from 'lucide-react';
import type { AudioPreference, SkipInterval, SkipTimesResponse, SubtitleTrack } from '../../shared/api';
import { apiRequest } from '../api';
import { usePreferences } from '../PreferencesContext';
import { clock, parseSubtitles, type Cue } from './subtitles';
import { mergeSkipIntervals } from './skipIntervals';
import { ScrubPreview } from './ScrubPreview';
import { togglePlayback } from './Player';
import { notifyPartyControl } from './partyPlayback';
import { needsWatchCheck, recordActivity, watchSession } from './watchSession';
import { useWatchSession } from './useWatchSession';

export function CinemaControls({ videoRef, sourceUrl, sourceType = 'mp4', intro, outro, tracks, audio, audioAvailable, onAudioChange, animeId, episode, next, nextEpisode, local, children, onError, partyControls }: { videoRef: RefObject<HTMLVideoElement | null>; sourceUrl?: string; sourceType?: 'mp4' | 'webm' | 'hls'; intro?: SkipInterval; outro?: SkipInterval; tracks: SubtitleTrack[]; audio: AudioPreference; audioAvailable: Record<AudioPreference, boolean>; onAudioChange: (audio: AudioPreference) => void; animeId: number; episode: number; next?: () => void; nextEpisode?: { number: number; title?: string; image: string; series: string }; local: boolean; children: ReactNode; onError: (message: string) => void; partyControls?: ReactNode }) {
  const { preferences, update } = usePreferences();
  const track = preferences.subtitles && tracks.length ? Math.max(0, tracks.findIndex(entry => entry.language === 'en')) : -1;
  const [time, setTime] = useState(0), [duration, setDuration] = useState(0), [paused, setPaused] = useState(true), [muted, setMuted] = useState(false), [volume, setVolume] = useState(1), [buffered, setBuffered] = useState(0);
  const [panel, setPanel] = useState(''), [cues, setCues] = useState<Cue[]>([]), [fullscreenMode, setFullscreenMode] = useState<'inline' | 'custom' | 'native'>('inline'), [note, setNote] = useState('');
  const [fallback, setFallback] = useState<{ key: string; value: SkipTimesResponse } | null>(null), [autoNext, setAutoNext] = useState(() => { try { return localStorage.getItem('moewatch-autonext') !== 'false'; } catch { return true; } });
  const [countdown, setCountdown] = useState<number | null>(null), [idle, setIdle] = useState(false);
  const [watchPrompt, setWatchPrompt] = useState<'still' | 'sleep' | null>(null);
  const watchDialog = useRef<HTMLDialogElement>(null);
  const resumeRequested = useRef(false);
  const sleep = useCallback(() => { setCountdown(null); setPanel(''); setWatchPrompt('sleep'); }, []);
  const { sleepUntil, minutesLeft, setSleepTimer } = useWatchSession(videoRef, sourceUrl, sleep);
  useEffect(() => {
    if (!watchPrompt) {
      if (resumeRequested.current) {
        resumeRequested.current = false;
        if (videoRef.current?.ended && nextRef.current) nextRef.current();
        else if (videoRef.current) void videoRef.current.play().catch(() => onError('Playback could not start. Try again.'));
      }
      return;
    }
    const dialog = watchDialog.current;
    const video = videoRef.current;
    const pause = () => video?.pause();
    pause();
    video?.addEventListener('play', pause);
    dialog?.showModal();
    if (document.pictureInPictureElement === video) void document.exitPictureInPicture().catch(() => {});
    if (document.fullscreenElement === video) void document.exitFullscreen().catch(() => {});
    if (video && 'webkitExitFullscreen' in video && typeof video.webkitExitFullscreen === 'function') video.webkitExitFullscreen();
    return () => { video?.removeEventListener('play', pause); dialog?.close(); };
  }, [watchPrompt, videoRef, sourceUrl]);
  function keepWatching() {
    recordActivity(watchSession);
    resumeRequested.current = true;
    setWatchPrompt(null);
  }
  const [remaining, setRemaining] = useState(false);
  const [pip, setPip] = useState(false);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => setPip(document.pictureInPictureElement === video);
    video.addEventListener('enterpictureinpicture', sync);
    video.addEventListener('leavepictureinpicture', sync);
    sync();
    return () => {
      video.removeEventListener('enterpictureinpicture', sync);
      video.removeEventListener('leavepictureinpicture', sync);
      if (document.pictureInPictureElement === video) void document.exitPictureInPicture().catch(() => {});
    };
  }, [videoRef, sourceUrl]);
  const [scrub, setScrub] = useState<{ time: number; position: number } | null>(null);
  useEffect(() => setScrub(null), [sourceUrl]);
  const touchScrubbing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const panelRef = useRef<HTMLElement>(null);
  const [renderedPanel, setRenderedPanel] = useState('');
  const { mounted, ...presence } = usePresence(Boolean(panel));
  useEffect(() => { if (panel) setRenderedPanel(panel); else if (!mounted) setRenderedPanel(''); }, [panel, mounted]);
  useEffect(() => {
    if (!panel) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Element && !panelRef.current?.contains(event.target) && !event.target.closest('#player-captions, #player-settings')) setPanel('');
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [panel]);
  const nextRef = useRef(next); nextRef.current = next;
  useEffect(() => {
    const element = videoRef.current; if (!element) return;
    const sync = () => { setTime(element.currentTime); setDuration(Number.isFinite(element.duration) ? element.duration : 0); setPaused(element.paused); setVolume(element.volume); setMuted(element.muted); setBuffered(element.buffered.length ? element.buffered.end(element.buffered.length-1) : 0); };
    const ended = () => {
      if (!autoNext || !nextRef.current || local) return;
      if (watchSession.sleepUntil && Date.now() >= watchSession.sleepUntil) { sleep(); return; }
      if (needsWatchCheck(watchSession, animeId + '/' + episode)) { setPanel(''); setWatchPrompt('still'); }
      else setCountdown(5);
    };
    const events = ['timeupdate','loadedmetadata','play','pause','volumechange','progress','seeking'];
    events.forEach(event => element.addEventListener(event,sync)); element.addEventListener('ended',ended); sync();
    return () => { events.forEach(event => element.removeEventListener(event,sync)); element.removeEventListener('ended',ended); };
  }, [videoRef, sourceUrl, autoNext, local, animeId, episode, sleep]);
  const skipKey = JSON.stringify([animeId, episode, audio, sourceUrl, duration]);
  const providerSkip = mergeSkipIntervals(duration, local || !sourceUrl ? {} : { intro, outro });
  const skip = mergeSkipIntervals(duration, providerSkip, !local && fallback?.key === skipKey ? fallback.value : {});
  useEffect(() => {
    if (!duration || local || !sourceUrl || providerSkip.intro && providerSkip.outro) return;
    const controller = new AbortController();
    apiRequest<SkipTimesResponse>(`/anime/${animeId}/skip-times/${episode}?duration=${duration.toFixed(3)}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setFallback({ key: skipKey, value }); })
      .catch(() => { if (!controller.signal.aborted) setFallback({ key: skipKey, value: { status: 'unavailable' } }); });
    return () => controller.abort();
  }, [skipKey, local, !!providerSkip.intro, !!providerSkip.outro]);
  useEffect(() => {
    setCues([]); setNote(''); const selected=tracks[track]; if (!selected) return;
    const controller=new AbortController();
    fetch(selected.url,{signal:controller.signal}).then(async response => { if (!response.ok) throw new Error(); const text=await response.text(); const parsed=parseSubtitles(text,selected.format); if (!parsed.length) throw new Error(); if (!controller.signal.aborted) setCues(parsed); }).catch(() => { if (!controller.signal.aborted) setNote('Subtitles could not be loaded.'); });
    return () => controller.abort();
  }, [tracks,track]);
  useEffect(() => { if (countdown === null) return; if (countdown === 0) { setCountdown(null); nextRef.current?.(); return; } const timer=setTimeout(() => setCountdown(countdown-1),1000); return () => clearTimeout(timer); }, [countdown]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const root = video.closest('.watch-content');
    let nativeFull = false;
    const enter = () => { nativeFull = true; video.controls = true; setFullscreenMode('native'); };
    const leave = () => { nativeFull = false; video.controls = false; setFullscreenMode(root && document.fullscreenElement === root ? 'custom' : 'inline'); };
    const sync = () => { if (document.fullscreenElement === video) enter(); else leave(); };
    document.addEventListener('fullscreenchange', sync);
    video.addEventListener('webkitbeginfullscreen', enter);
    video.addEventListener('webkitendfullscreen', leave);
    sync();
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      video.removeEventListener('webkitbeginfullscreen', enter);
      video.removeEventListener('webkitendfullscreen', leave);
      if (nativeFull && 'webkitExitFullscreen' in video && typeof video.webkitExitFullscreen === 'function') {
        try { video.webkitExitFullscreen(); } catch { /* The browser may already have dismissed the player. */ }
      }
      video.controls = false;
      if (document.fullscreenElement === video || document.fullscreenElement === root) void document.exitFullscreen().catch(() => {});
      setFullscreenMode('inline');
    };
  }, [videoRef, sourceUrl]);
  const nativeCaptions = useRef<{ video: HTMLVideoElement; track: TextTrack } | null>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || fullscreenMode !== 'native' && !nativeCaptions.current) return;
    if (nativeCaptions.current?.video !== video) nativeCaptions.current = { video, track: video.addTextTrack('subtitles', 'Subtitles') };
    const nativeTrack = nativeCaptions.current.track;
    nativeTrack.mode = 'hidden';
    for (const cue of Array.from(nativeTrack.cues || [])) nativeTrack.removeCue(cue);
    for (const cue of cues) nativeTrack.addCue(new VTTCue(cue.start, cue.end, cue.text));
    nativeTrack.mode = fullscreenMode === 'native' && cues.length ? 'showing' : 'disabled';
    return () => { nativeTrack.mode = 'disabled'; };
  }, [fullscreenMode, cues, videoRef, sourceUrl]);
  function seek(value:number) { if (videoRef.current && duration) { videoRef.current.currentTime=Math.max(0,Math.min(duration,value)); setTime(videoRef.current.currentTime); notifyPartyControl(videoRef.current, 'seek'); } }
  function toggle() { togglePlayback(videoRef, onError); }
  async function pictureInPicture() {
    const video = videoRef.current;
    if (!video) return;
    setNote('');
    try {
      if (document.pictureInPictureElement === video) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      setNote('Picture-in-picture is unavailable. Try again once the video has loaded.');
    }
  }
  async function fullscreen() {
    const video = videoRef.current;
    if (!video) return;
    setNote('');
    const previousControls = video.controls;
    try {
      const root = video.closest<HTMLElement>('.watch-content');
      if (root && document.fullscreenElement === root || document.fullscreenElement === video) await document.exitFullscreen();
      else if (fullscreenMode === 'native' && 'webkitExitFullscreen' in video && typeof video.webkitExitFullscreen === 'function') video.webkitExitFullscreen();
      else if (root && document.fullscreenEnabled && typeof root.requestFullscreen === 'function') {
        await root.requestFullscreen({ navigationUI: 'hide' });
      }
      else {
        video.controls = true;
        if ('webkitEnterFullscreen' in video && typeof video.webkitEnterFullscreen === 'function') video.webkitEnterFullscreen();
        else await video.requestFullscreen();
      }
    } catch {
      video.controls = previousControls;
      setNote('Fullscreen is unavailable in this browser.');
    }
  }
  useEffect(() => {
    const key=(event:KeyboardEvent) => {
      if (watchPrompt || videoRef.current?.controls) return;
      if (event.key==='Escape' && panel) { setPanel(''); document.getElementById(panel==='settings'?'player-settings':'player-captions')?.focus(); return; }
      if (event.target instanceof HTMLElement && (event.target.closest('button,a,input,select,textarea') || event.target.isContentEditable)) return;
      if (event.key===' ' || event.key==='k') { event.preventDefault(); toggle(); }
      else if (event.key==='ArrowRight') {event.preventDefault();seek(time+10);}
      else if (event.key==='ArrowLeft') {event.preventDefault();seek(time-10);}
      else if (event.key==='m' && videoRef.current) videoRef.current.muted=!videoRef.current.muted;
      else if (event.key==='f') void fullscreen();
    };
    document.addEventListener('keydown',key);return () => document.removeEventListener('keydown',key);
  });
  useEffect(() => {
    const root=videoRef.current?.closest('.watch-content');
    const wake=() => {setIdle(false);clearTimeout(timer.current);timer.current=setTimeout(() => { if (!root?.querySelector('button:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible')) setIdle(true); },3000);};
    root?.addEventListener('pointermove',wake);root?.addEventListener('pointerdown',wake);root?.addEventListener('keydown',wake);root?.addEventListener('focusin',wake);wake();
    return () => {clearTimeout(timer.current);root?.removeEventListener('pointermove',wake);root?.removeEventListener('pointerdown',wake);root?.removeEventListener('keydown',wake);root?.removeEventListener('focusin',wake);};
  },[videoRef,sourceUrl]);
  const active=skip.intro && time>=skip.intro.start && time<skip.intro.end ? {label:'Skip opening',...skip.intro} : skip.outro && time>=skip.outro.start && time<skip.outro.end ? {label:'Skip ending',...skip.outro} : null;
  const hidden=idle && !scrub && !paused && !renderedPanel && countdown===null && !watchPrompt;
  useEffect(() => {const root=videoRef.current?.closest('.watch-content');root?.classList.toggle('controls-hidden',hidden);return () => root?.classList.remove('controls-hidden');},[hidden,videoRef]);
  const icon=(label:string,action:()=>void,child:ReactNode,disabled=false) => <button type="button" className={'cinema-icon'+(label==='Fullscreen'||label==='Exit fullscreen'?' fullscreen-control':'')} aria-label={label} title={label} onClick={action} disabled={disabled}>{child}{label==='Next episode'?<span className="control-caption">Next</span>:label==='Fullscreen'||label==='Exit fullscreen'?<span className="control-caption">Fullscreen</span>:null}</button>;
  return <>
    {watchPrompt && <dialog ref={watchDialog} className="watch-check" aria-labelledby="watch-check-title" onCancel={event => event.preventDefault()} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <img src="/error-mascot.png" alt="" width="180" height="188" />
      <h2 id="watch-check-title">{watchPrompt === 'sleep' ? 'Sleep timer finished' : 'Still watching?'}</h2>
      <div className="language-options"><button type="button" autoFocus onClick={keepWatching}>Keep watching</button><button type="button" onClick={() => setWatchPrompt(null)}>Stop watching</button></div>
    </dialog>}
    <div className="subtitle-overlay" role="group" aria-label="Subtitles">{cues.filter(cue => time>=cue.start && time<cue.end).map((cue,index) => <span key={index}>{cue.text}</span>)}</div>
    <div className={'cinema-bottom'+(hidden?' is-idle':'')+(renderedPanel?' has-panel':'')} inert={hidden} aria-hidden={hidden}>
      {note && <p role="status">{note}</p>}
      {renderedPanel && <section {...presence} ref={panelRef} className={"cinema-panel"+(renderedPanel==='subtitles'?' subtitle-panel':'')+(!panel?' is-closing':'')} aria-label={renderedPanel==='settings'?'Playback settings':'Subtitle settings'} onKeyDown={event => {if(event.key==='Escape'){setPanel('');document.getElementById(panel==='settings'?'player-settings':'player-captions')?.focus();}}}>
        {renderedPanel==='settings'? <>{children}<div className="player-options"><label className="autonext-option"><input type="checkbox" checked={autoNext} disabled={local} onChange={event=>{setAutoNext(event.target.checked);setCountdown(null);try{localStorage.setItem('moewatch-autonext',String(event.target.checked));}catch{/* Playback remains usable without storage. */}}}/>Autonext</label><label>Sleep timer<select aria-label="Sleep timer" value={sleepUntil ? 'active' : '0'} onChange={event => setSleepTimer(Number(event.target.value))}>
            {sleepUntil > 0 && <option value="active" disabled>{minutesLeft} min left</option>}
            <option value="0">Off</option>{[15,30,60,90,120].map(minutes => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
          </select></label></div></>: <>
          <div className="language-choice" role="group" aria-label="Subtitles">
            <p>Subtitles</p>
            <div className="language-options">{[false,true].map(enabled=><button key={String(enabled)} type="button" aria-pressed={enabled?track>=0:track<0} disabled={enabled&&!tracks.length} onClick={()=>update({ subtitles: enabled })}>{enabled?'On':'Off'}</button>)}</div>
          </div>
          <div className="language-choice" role="group" aria-label="Audio">
            <p>Audio</p>
            <div className="language-options">{(['sub','dub'] as const).map(value=><button key={value} type="button" aria-pressed={audio===value} disabled={!audioAvailable[value]} onClick={()=>onAudioChange(value)}>{value==='sub'?'Sub':'Dub'}</button>)}</div>
          </div>
        </>}
      </section>}
      <div className="player-status-row">
      <button type="button" className="player-time" title={remaining?'Show elapsed and total time':'Show time remaining'} aria-label={remaining?`-${clock(Math.max(0,duration-time))} remaining. Show elapsed and total time`:`${clock(time)} / ${clock(duration)}. Show time remaining`} onClick={()=>setRemaining(value=>!value)}>{remaining?`-${clock(Math.max(0,duration-time))} remaining`: <>{clock(time)} <span>/ {clock(duration)}</span></>}</button>
    {countdown!==null && <div className="next-countdown" role="status"><span>Next episode in {countdown}</span><button onClick={() => {setCountdown(null);next?.();}}>Play now</button><button onClick={() => setCountdown(null)}>Cancel</button></div>}
    {active && countdown===null && <button className="skip-segment" onClick={() => seek(active.end)}>{active.label}<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 2.5v11L11 8zM12 2.5h2v11h-2z"/></svg></button>}
      </div>
      <div className="timeline" onPointerDown={event => { touchScrubbing.current = event.pointerType === 'touch'; }} onPointerUp={event => { if (event.pointerType !== 'mouse') { touchScrubbing.current = false; setScrub(null); } }} onLostPointerCapture={() => { touchScrubbing.current = false; setScrub(null); }} onPointerMove={event => { if (!duration || event.pointerType === 'touch' && !touchScrubbing.current) return; const bounds = event.currentTarget.getBoundingClientRect(); const rotated = !event.currentTarget.closest('.watch-content')?.matches(':fullscreen') && window.matchMedia('(pointer: coarse) and (orientation: portrait) and (max-width: 600px)').matches; const position = Math.max(0, Math.min(1, ((rotated ? event.clientY - bounds.top : event.clientX - bounds.left) - 6) / ((rotated ? bounds.height : bounds.width) - 12))); setScrub({ time: position * duration, position }); }} onPointerLeave={() => setScrub(null)} onPointerCancel={() => { touchScrubbing.current = false; setScrub(null); }} style={{'--played':`${duration?time/duration*100:0}%`,'--buffered':`${duration?buffered/duration*100:0}%`} as React.CSSProperties}><div className="timeline-segments" aria-hidden="true">{(['intro', 'outro'] as const).map(kind => { const interval = skip[kind]; return interval ? <span key={kind} className={`timeline-segment timeline-segment-${kind}`} style={{ left: `${interval.start / duration * 100}%`, width: `${(interval.end - interval.start) / duration * 100}%` }} /> : null; })}</div><input aria-label="Playback position" aria-valuetext={`${clock(time)} of ${clock(duration)}${active ? active.label === 'Skip opening' ? ', opening' : ', ending' : ''}`} type="range" min={0} max={duration||1} step={0.1} value={time} disabled={!duration} onFocus={event => { if (event.currentTarget.matches(':focus-visible')) setScrub({ time, position: duration ? time / duration : 0 }); }} onBlur={() => setScrub(null)} onChange={event=>{ const value = Number(event.target.value); seek(value); if (touchScrubbing.current || event.currentTarget.matches(':focus-visible')) setScrub({ time: value, position: duration ? value / duration : 0 }); }}/>{scrub && sourceUrl && <ScrubPreview key={sourceUrl} source={{ url: sourceUrl, type: sourceType }} time={scrub.time} position={scrub.position} visible/>}</div>
      <div className="cinema-toolbar">
        <div className="transport">{icon(paused?'Play':'Pause',toggle,paused?<Play fill="currentColor"/>:<Pause fill="currentColor"/>,!sourceUrl)}<div className="volume-control">{icon(muted||!volume?'Unmute':'Mute',()=>{if(videoRef.current)videoRef.current.muted=!muted;},muted||!volume?<VolumeX/>:<Volume2/>)}<div className="volume-slider"><input style={{'--volume':`${(muted?0:volume)*100}%`} as React.CSSProperties} type="range" aria-label="Volume" aria-valuetext={`${Math.round((muted?0:volume)*100)}%`} min={0} max={1} step={0.05} value={muted?0:volume} onChange={event=>{if(videoRef.current){videoRef.current.volume=Number(event.target.value);videoRef.current.muted=false;}}}/><span className="volume-tooltip" aria-hidden="true" style={{left:`calc(${(muted?0:volume)*100}% + ${6-(muted?0:volume)*12}px)`}}>{Math.round((muted?0:volume)*100)}%</span></div></div></div>
        <div className="view-controls">{partyControls}<div className="next-control">{icon('Next episode',()=>next?.(),<SkipForward/>,!next)}{next && nextEpisode && <div className="next-preview" role="tooltip"><img src={nextEpisode.image} alt=""/><div><span className="next-preview-eyebrow">Up next &middot; Episode {nextEpisode.number}</span><strong>{nextEpisode.title || nextEpisode.series}</strong>{nextEpisode.title && <span>{nextEpisode.series}</span>}</div></div>}</div><button id="player-captions" className="cinema-icon" aria-label="Subtitles" aria-pressed={track>=0} aria-expanded={panel==='subtitles'} onClick={()=>setPanel(panel==='subtitles'?'':'subtitles')}><Captions/><span className="control-caption">Subtitles</span></button><button id="player-settings" className="cinema-icon" aria-label="Playback settings" aria-expanded={panel==='settings'} onClick={()=>setPanel(panel==='settings'?'':'settings')}><Settings2/><span className="control-caption">Settings</span></button>{document.pictureInPictureEnabled && <button type="button" className="cinema-icon" aria-label={pip ? 'Exit picture-in-picture' : 'Picture-in-picture'} title={pip ? 'Exit picture-in-picture' : 'Picture-in-picture'} aria-pressed={pip} disabled={!sourceUrl || !duration} onClick={() => void pictureInPicture()}><PictureInPicture2 aria-hidden="true"/></button>}{icon(fullscreenMode !== 'inline'?'Exit fullscreen':'Fullscreen',()=>void fullscreen(),fullscreenMode !== 'inline'?<Minimize/>:<Maximize/>,!sourceUrl)}</div>
      </div>
    </div>
  </>;
}
