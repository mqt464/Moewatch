import type Hls from 'hls.js';
import { usePreferences } from '../PreferencesContext';
import { useEffect, useRef, type RefObject } from 'react';
import type { PlaybackSource } from '../../shared/api';

export function canResume(time: number, previousDuration: number, duration: number): boolean {
  return Number.isFinite(duration) && duration > 0 && time > 0 && time < duration * 0.95 && Math.abs(previousDuration - duration) <= Math.max(2, duration * 0.02);
}

export function Player({ source, videoRef, label, onSave, onReady, onBuffering, onError, onClick }: {
  source: PlaybackSource;
  videoRef: RefObject<HTMLVideoElement | null>;
  label: string;
  onSave: (force?: boolean, element?: HTMLVideoElement) => void;
  onReady: () => void;
  onBuffering: (loading: boolean) => void;
  onError: (message: string) => void;
  onClick?: () => void;
}) {
  const { preferences, update } = usePreferences();
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = preferences.volume;
    video.muted = preferences.muted;
  }, [videoRef, source.url, preferences.volume, preferences.muted]);
  const callbacks = useRef({ onError, onSave });
  callbacks.current = { onError, onSave };
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let hls: Hls | undefined;
    let disposed = false;
    async function attach(element: HTMLVideoElement) {
      if (source.type === 'hls' && !element.canPlayType('application/vnd.apple.mpegurl')) {
        const { default: Hls } = await import('hls.js');
        if (disposed) return;
        if (!Hls.isSupported()) { callbacks.current.onError('This browser does not support HLS playback. Try another browser or a local file.'); return; }
        hls = new Hls({ manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 1, fragLoadingMaxRetry: 1 });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) callbacks.current.onError('The stream could not be played. Retry or choose another provider.');
        });
        hls.loadSource(source.url);
        hls.attachMedia(element);
      } else element.src = source.url;
    }
    void attach(video).catch(() => { if (!disposed) callbacks.current.onError('The video player could not be loaded. Retry the page.'); });
    return () => {
      disposed = true;
      callbacks.current.onSave(true, video);
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [source.url, source.type, videoRef]);
  return <video ref={videoRef} onClick={onClick} playsInline aria-label={label}
    onVolumeChange={event => {
      const { volume, muted } = event.currentTarget;
      if (volume !== preferences.volume || muted !== preferences.muted) update({ volume, muted });
    }}
    onSeeked={() => onSave(true)} onTimeUpdate={() => onSave()} onPause={() => onSave(true)} onEnded={() => onSave(true)}
    onLoadStart={() => onBuffering(true)} onWaiting={() => onBuffering(true)}
    onCanPlay={() => onBuffering(false)} onPlaying={() => onBuffering(false)}
    onLoadedMetadata={onReady} onError={() => onError('This browser cannot play this source. Retry, choose another provider, or open an MP4 or WebM file.')}>

  </video>;
}
