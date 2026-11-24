import type Hls from 'hls.js';
import { usePreferences } from '../PreferencesContext';
import { useEffect, useRef, type RefObject } from 'react';
import type { PlaybackSource } from '../../shared/api';
import { notifyPartyControl } from './partyPlayback';

export function canResume(time: number, previousDuration: number, duration: number): boolean {
  return Number.isFinite(duration) && duration > 0 && time > 0 && time < duration * 0.95 && Math.abs(previousDuration - duration) <= Math.max(2, duration * 0.02);
}

export function togglePlayback(videoRef: RefObject<HTMLVideoElement | null>, onError: (message: string) => void) {
  const video = videoRef.current;
  if (!video) return;
  if (video.paused) void video.play().then(() => notifyPartyControl(video, 'play')).catch(failure => {
    if (videoRef.current === video && failure?.name !== 'AbortError') onError('Playback could not start. Try another server.');
  });
  else { video.pause(); notifyPartyControl(video, 'pause'); }
}

export function Player({ source, videoRef, label, onSave, onReady, onBuffering, onFirstFrame, onError, onClick }: {
  source: PlaybackSource;
  videoRef: RefObject<HTMLVideoElement | null>;
  label: string;
  onSave: (force?: boolean, element?: HTMLVideoElement) => void;
  onReady: () => void;
  onFirstFrame: () => void;
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
  const callbacks = useRef({ onError, onSave, onFirstFrame });
  callbacks.current = { onError, onSave, onFirstFrame };
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let hls: Hls | undefined;
    let disposed = false;
    let frame: number | undefined;
    let paint = 0;
    let nextPaint = 0;
    // A decoded source is not necessarily on screen yet.
    if (typeof video.requestVideoFrameCallback === 'function') {
      frame = video.requestVideoFrameCallback(() => { if (!disposed) callbacks.current.onFirstFrame(); });
    }
    const loadedFrame = () => {
      if (frame !== undefined) return;
      paint = requestAnimationFrame(() => {
        nextPaint = requestAnimationFrame(() => { if (!disposed) callbacks.current.onFirstFrame(); });
      });
    };
    video.addEventListener('loadeddata', loadedFrame, { once: true });
    async function attach(element: HTMLVideoElement) {
      if (source.type === 'hls') {
        const { default: Hls } = await import('hls.js');
        if (disposed) return;
        // Chromium can report native HLS support but fail on separate audio/video streams.
        if (!Hls.isSupported()) {
          if (element.canPlayType('application/vnd.apple.mpegurl')) element.src = source.url;
          else callbacks.current.onError('This browser does not support this stream.');
          return;
        }
        hls = new Hls({ manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 1, fragLoadingMaxRetry: 1 });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) callbacks.current.onError('This stream cannot be played. Try another server.');
        });
        hls.loadSource(source.url);
        hls.attachMedia(element);
      } else element.src = source.url;
    }
    void attach(video).catch(() => { if (!disposed) callbacks.current.onError('The player could not load. Reload the page.'); });
    return () => {
      disposed = true;
      if (frame !== undefined) video.cancelVideoFrameCallback(frame);
      cancelAnimationFrame(paint);
      cancelAnimationFrame(nextPaint);
      video.removeEventListener('loadeddata', loadedFrame);
      callbacks.current.onSave(true, video);
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [source.url, source.type, videoRef]);
  return <video ref={videoRef} onClick={event => { if (!event.currentTarget.controls) onClick?.(); }} playsInline aria-label={label}
    onVolumeChange={event => {
      const { volume, muted } = event.currentTarget;
      if (volume !== preferences.volume || muted !== preferences.muted) update({ volume, muted });
    }}
    onSeeked={() => onSave(true)} onTimeUpdate={() => onSave()} onPause={() => onSave(true)} onEnded={() => onSave(true)}
    onLoadStart={() => onBuffering(true)} onWaiting={() => onBuffering(true)}
    onCanPlay={() => onBuffering(false)} onPlaying={() => onBuffering(false)}
    onLoadedMetadata={onReady} onError={() => onError('This source cannot be played. Try another server.')}>

  </video>;
}
