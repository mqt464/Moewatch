import { useEffect, useRef, type CSSProperties } from 'react';
import type Hls from 'hls.js';
import type { PlaybackSource } from '../../shared/api';
import { clock } from './subtitles';

export function ScrubPreview({ source, time, position, visible }: { source: PlaybackSource; time: number; position: number; visible: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const target = useRef(time);
  target.current = time;
  const media = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const video = document.createElement('video');
    media.current = video;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.crossOrigin = 'anonymous';
    let disposed = false;
    let hls: Hls | undefined;
    const seek = () => {
      if (video.readyState >= 1 && !video.seeking) video.currentTime = Math.min(target.current, Math.max(0, video.duration - 0.05));
    };
    const draw = () => {
      if (Math.abs(video.currentTime - target.current) > 0.25) { seek(); return; }
      try {
        canvas.current?.getContext('2d')?.drawImage(video, 0, 0, 192, 108);
      } catch { /* Keep the timestamp if the source cannot supply a frame. */ }
    };
    video.addEventListener('loadedmetadata', seek);
    video.addEventListener('loadeddata', draw);
    video.addEventListener('seeked', draw);
    async function attach() {
      if (source.type === 'hls' && !video.canPlayType('application/vnd.apple.mpegurl')) {
        const { default: Hls } = await import('hls.js');
        if (disposed || !Hls.isSupported()) return;
        hls = new Hls({ startLevel: 0, maxBufferLength: 2, maxMaxBufferLength: 4, backBufferLength: 0 });
        hls.loadSource(source.url);
        hls.attachMedia(video);
      } else video.src = source.url;
    }
    void attach().catch(() => {});
    return () => {
      disposed = true;
      media.current = null;
      video.removeEventListener('loadedmetadata', seek);
      video.removeEventListener('loadeddata', draw);
      video.removeEventListener('seeked', draw);
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [source.url, source.type]);
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      const video = media.current;
      if (video && video.readyState >= 1 && !video.seeking) video.currentTime = Math.min(time, Math.max(0, video.duration - 0.05));
    }, 80);
    return () => clearTimeout(timer);
  }, [time, visible]);
  return <div className="scrub-preview" aria-hidden="true" hidden={!visible} style={{ '--scrub-position': `${position * 100}%` } as CSSProperties}><canvas ref={canvas} width={192} height={108}/><span>{clock(time)}</span></div>;
}
