import { useEffect, useState, type RefObject } from 'react';
import { recordActivity, watchSession } from './watchSession';

export function useWatchSession(videoRef: RefObject<HTMLVideoElement | null>, sourceUrl: string | undefined, onSleep: () => void) {
  const [sleepUntil, setSleepUntil] = useState(watchSession.sleepUntil);
  const [minutesLeft, setMinutesLeft] = useState(0);
  useEffect(() => {
    const video = videoRef.current;
    const root = video?.closest('.watch-content');
    const activity = (event: Event) => { if (event.isTrusted) recordActivity(watchSession); };
    root?.addEventListener('pointerdown', activity);
    root?.addEventListener('keydown', activity);
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      if (video && !video.paused && !video.ended && video.readyState >= 3) watchSession.unattendedMs += now - last;
      last = now;
      setMinutesLeft(Math.max(0, Math.ceil((watchSession.sleepUntil - Date.now()) / 60_000)));
      if (watchSession.sleepUntil && Date.now() >= watchSession.sleepUntil) {
        watchSession.sleepUntil = 0;
        setSleepUntil(0);
        video?.pause();
        onSleep();
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => {
      clearInterval(interval);
      root?.removeEventListener('pointerdown', activity);
      root?.removeEventListener('keydown', activity);
    };
  }, [videoRef, sourceUrl, onSleep]);
  function setSleepTimer(minutes: number) {
    watchSession.sleepUntil = minutes ? Date.now() + minutes * 60_000 : 0;
    setSleepUntil(watchSession.sleepUntil);
    setMinutesLeft(minutes);
  }
  return { sleepUntil, minutesLeft, setSleepTimer };
}
