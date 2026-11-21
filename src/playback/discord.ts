import { useEffect, type RefObject } from 'react';
import type { Anime } from '../catalog';
import type { DiscordPlayback } from '../../shared/discord';

export function useDiscordPresence(videoRef: RefObject<HTMLVideoElement | null>, anime: Anime, episode: number, sourceUrl?: string) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !sourceUrl) return;
    const session = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    let queue = Promise.resolve();
    const send = (body: object) => {
      queue = queue.then(async () => {
        await fetch('/api/v1/discord/presence', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body), keepalive: true, signal: AbortSignal.timeout(5000),
        });
      }).catch(() => {});
    };
    const clear = () => send({ session, clear: true });
    const update = () => {
      if (video.ended || video.error) { clear(); return; }
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      const body: DiscordPlayback = { session, animeId: anime.id, episode, time: video.currentTime, duration: video.duration, paused: video.paused, rate: video.playbackRate };
      send(body);
    };
    const events = ['loadedmetadata', 'playing', 'pause', 'seeked', 'ratechange', 'ended', 'error'];
    events.forEach(event => video.addEventListener(event, update));
    window.addEventListener('pagehide', clear);
    const timer = window.setInterval(update, 15000);
    return () => {
      clearInterval(timer);
      events.forEach(event => video.removeEventListener(event, update));
      window.removeEventListener('pagehide', clear);
      clear();
    };
  }, [videoRef, anime.id, episode, sourceUrl]);
}
