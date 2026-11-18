import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, Settings2, Captions, SkipForward } from 'lucide-react';
import type { AudioPreference, SkipTimesResponse, SubtitleTrack } from '../../shared/api';
import { apiRequest } from '../api';
import { usePreferences } from '../PreferencesContext';
import { clock, parseSubtitles, type Cue } from './subtitles';

export function CinemaControls({ videoRef, sourceUrl, tracks, audio, audioAvailable, onAudioChange, animeId, episode, next, nextEpisode, local, children }: { videoRef: RefObject<HTMLVideoElement | null>; sourceUrl?: string; tracks: SubtitleTrack[]; audio: AudioPreference; audioAvailable: Record<AudioPreference, boolean>; onAudioChange: (audio: AudioPreference) => void; animeId: number; episode: number; next?: () => void; nextEpisode?: { number: number; title?: string; image: string; series: string }; local: boolean; children: ReactNode }) {
  const { preferences, update } = usePreferences();
  const track = preferences.subtitles && tracks.length ? Math.max(0, tracks.findIndex(entry => entry.language === 'en')) : -1;
  const [time, setTime] = useState(0), [duration, setDuration] = useState(0), [paused, setPaused] = useState(true), [muted, setMuted] = useState(false), [volume, setVolume] = useState(1), [buffered, setBuffered] = useState(0);
  const [panel, setPanel] = useState(''), [cues, setCues] = useState<Cue[]>([]), [note, setNote] = useState(''), [full, setFull] = useState(false);
  const [skip, setSkip] = useState<SkipTimesResponse>({status:'not-found'}), [autoNext, setAutoNext] = useState(() => { try { return localStorage.getItem('moewatch-autonext') !== 'false'; } catch { return true; } });
  const [countdown, setCountdown] = useState<number | null>(null), [idle, setIdle] = useState(false);
  const [remaining, setRemaining] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const panelRef = useRef<HTMLElement>(null);
  const [renderedPanel, setRenderedPanel] = useState('');
  useEffect(() => {
    if (panel) { setRenderedPanel(panel); return; }
    const timeout = setTimeout(() => setRenderedPanel(''), window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 120);
    return () => clearTimeout(timeout);
  }, [panel]);
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
    const ended = () => { if (autoNext && nextRef.current && !local) setCountdown(5); };
    const events = ['timeupdate','loadedmetadata','play','pause','volumechange','progress','seeking'];
    events.forEach(event => element.addEventListener(event,sync)); element.addEventListener('ended',ended); sync();
    return () => { events.forEach(event => element.removeEventListener(event,sync)); element.removeEventListener('ended',ended); };
  }, [videoRef, sourceUrl, autoNext, local]);
  useEffect(() => {
    setSkip({status:'not-found'}); if (!duration || local) return;
    const controller = new AbortController();
    apiRequest<SkipTimesResponse>(`/anime/${animeId}/skip-times/${episode}?duration=${duration.toFixed(3)}`,{signal:controller.signal}).then(value => { if (!controller.signal.aborted) setSkip(value); }).catch(() => { if (!controller.signal.aborted) setSkip({status:'unavailable'}); });
    return () => controller.abort();
  }, [animeId,episode,duration,local,sourceUrl]);
  useEffect(() => {
    setCues([]); setNote(''); const selected=tracks[track]; if (!selected) return;
    const controller=new AbortController();
    fetch(selected.url,{signal:controller.signal}).then(async response => { if (!response.ok) throw new Error(); const text=await response.text(); const parsed=parseSubtitles(text,selected.format); if (!parsed.length) throw new Error(); if (!controller.signal.aborted) setCues(parsed); }).catch(() => { if (!controller.signal.aborted) setNote('Subtitles could not be loaded. Choose another track.'); });
    return () => controller.abort();
  }, [tracks,track]);
  useEffect(() => { if (countdown === null) return; if (countdown === 0) { setCountdown(null); nextRef.current?.(); return; } const timer=setTimeout(() => setCountdown(countdown-1),1000); return () => clearTimeout(timer); }, [countdown]);
  useEffect(() => { const update=() => setFull(Boolean(document.fullscreenElement)); document.addEventListener('fullscreenchange',update); return () => document.removeEventListener('fullscreenchange',update); }, []);
  function seek(value:number) { if (videoRef.current && duration) { videoRef.current.currentTime=Math.max(0,Math.min(duration,value)); setTime(videoRef.current.currentTime); } }
  function toggle() { const v=videoRef.current; if (!v) return; if (v.paused) void v.play().catch(() => setNote('Playback could not start. Try another source.')); else v.pause(); }
  async function fullscreen() { try { if (document.fullscreenElement) await document.exitFullscreen(); else await videoRef.current?.closest('.watch-content')?.requestFullscreen(); } catch { setNote('Fullscreen is unavailable in this browser.'); } }
  useEffect(() => {
    const key=(event:KeyboardEvent) => {
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
  const hidden=idle && !paused && !renderedPanel && countdown===null;
  useEffect(() => {const root=videoRef.current?.closest('.watch-content');root?.classList.toggle('controls-hidden',hidden);return () => root?.classList.remove('controls-hidden');},[hidden,videoRef]);
  const icon=(label:string,action:()=>void,child:ReactNode,disabled=false) => <button type="button" className="cinema-icon" aria-label={label} title={label} onClick={action} disabled={disabled}>{child}{label==='Next episode'?<span className="control-caption">Next</span>:label==='Fullscreen'||label==='Exit fullscreen'?<span className="control-caption">Fullscreen</span>:null}</button>;
  return <>
    <div className="subtitle-overlay" role="group" aria-label="Subtitles">{cues.filter(cue => time>=cue.start && time<cue.end).map((cue,index) => <span key={index}>{cue.text}</span>)}</div>
    {active && <button className="skip-segment" onClick={() => seek(active.end)}>{active.label}<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 2.5v11L11 8zM12 2.5h2v11h-2z"/></svg></button>}
    {countdown!==null && <div className="next-countdown" role="status">Next episode in {countdown}<button onClick={() => {setCountdown(null);next?.();}}>Play now</button><button onClick={() => setCountdown(null)}>Cancel</button></div>}
    <div className={'cinema-bottom'+(hidden?' is-idle':'')+(renderedPanel?' has-panel':'')} inert={hidden} aria-hidden={hidden}>
      {note && <p className="cinema-note" role="status">{note}</p>}
      {renderedPanel && <section key={renderedPanel} ref={panelRef} inert={!panel} aria-hidden={!panel} className={"cinema-panel"+(renderedPanel==='subtitles'?' subtitle-panel':'')+(!panel?' is-closing':'')} aria-label={renderedPanel==='settings'?'Playback settings':'Subtitle settings'} onKeyDown={event => {if(event.key==='Escape'){setPanel('');document.getElementById(panel==='settings'?'player-settings':'player-captions')?.focus();}}}>
        {renderedPanel==='settings'? <>{children}<div className="player-options"><label className="autonext-option"><input type="checkbox" checked={autoNext} disabled={local} onChange={event=>{setAutoNext(event.target.checked);setCountdown(null);try{localStorage.setItem('moewatch-autonext',String(event.target.checked));}catch{/* Playback remains usable without storage. */}}}/>Autonext</label></div></>: <>
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
      <button type="button" className="player-time" title={remaining?'Show elapsed and total time':'Show time remaining'} aria-label={remaining?`-${clock(Math.max(0,duration-time))} remaining. Show elapsed and total time`:`${clock(time)} / ${clock(duration)}. Show time remaining`} onClick={()=>setRemaining(value=>!value)}>{remaining?`-${clock(Math.max(0,duration-time))} remaining`: <>{clock(time)} <span>/ {clock(duration)}</span></>}</button>
      <div className="timeline" style={{'--played':`${duration?time/duration*100:0}%`,'--buffered':`${duration?buffered/duration*100:0}%`} as React.CSSProperties}><input aria-label="Playback position" aria-valuetext={`${clock(time)} of ${clock(duration)}`} type="range" min={0} max={duration||1} step={0.1} value={time} disabled={!duration} onChange={event=>seek(Number(event.target.value))}/></div>
      <div className="cinema-toolbar">
        <div className="transport">{icon(paused?'Play':'Pause',toggle,paused?<Play fill="currentColor"/>:<Pause fill="currentColor"/>,!sourceUrl)}<div className="volume-control">{icon(muted||!volume?'Unmute':'Mute',()=>{if(videoRef.current)videoRef.current.muted=!muted;},muted||!volume?<VolumeX/>:<Volume2/>)}<div className="volume-slider"><input style={{'--volume':`${(muted?0:volume)*100}%`} as React.CSSProperties} type="range" aria-label="Volume" aria-valuetext={`${Math.round((muted?0:volume)*100)}%`} min={0} max={1} step={0.05} value={muted?0:volume} onChange={event=>{if(videoRef.current){videoRef.current.volume=Number(event.target.value);videoRef.current.muted=false;}}}/><span className="volume-tooltip" aria-hidden="true" style={{left:`calc(${(muted?0:volume)*100}% + ${6-(muted?0:volume)*12}px)`}}>{Math.round((muted?0:volume)*100)}%</span></div></div></div>
        <div className="view-controls"><div className="next-control">{icon('Next episode',()=>next?.(),<SkipForward/>,!next)}{next && nextEpisode && <div className="next-preview" role="tooltip"><img src={nextEpisode.image} alt=""/><div><span className="next-preview-eyebrow">Up next &middot; Episode {nextEpisode.number}</span><strong>{nextEpisode.title || nextEpisode.series}</strong>{nextEpisode.title && <span>{nextEpisode.series}</span>}</div></div>}</div><button id="player-captions" className="cinema-icon" aria-label="Subtitles" aria-pressed={track>=0} aria-expanded={panel==='subtitles'} onClick={()=>setPanel(panel==='subtitles'?'':'subtitles')}><Captions/><span className="control-caption">Subtitles</span></button><button id="player-settings" className="cinema-icon" aria-label="Playback settings" aria-expanded={panel==='settings'} onClick={()=>setPanel(panel==='settings'?'':'settings')}><Settings2/><span className="control-caption">Settings</span></button>{icon(full?'Exit fullscreen':'Fullscreen',()=>void fullscreen(),full?<Minimize/>:<Maximize/>)}</div>
      </div>
    </div>
  </>;
}
