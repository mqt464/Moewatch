import { useLayoutEffect, useState } from 'react';

export function DocumentScrollbar() {
  const [metrics, setMetrics] = useState({ top: 0, height: 0, max: 0, viewport: 0 });
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.overlayScrollbar = '';
    const sync = () => setMetrics({ top: window.scrollY, height: root.scrollHeight, max: Math.max(0, root.scrollHeight - innerHeight), viewport: innerHeight });
    const resize = new ResizeObserver(sync);
    resize.observe(root);
    resize.observe(document.body);
    window.addEventListener('resize', sync);
    document.addEventListener('scroll', sync, { passive: true });
    sync();
    return () => {
      delete root.dataset.overlayScrollbar;
      resize.disconnect();
      window.removeEventListener('resize', sync);
      document.removeEventListener('scroll', sync);
    };
  }, []);
  if (!metrics.max) return null;
  const height = Math.min(metrics.viewport, Math.max(32, metrics.viewport ** 2 / metrics.height));
  const travel = metrics.viewport - height;
  return <div className="document-scrollbar" role="scrollbar" aria-label="Page scroll" aria-controls="root" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={metrics.max} aria-valuenow={Math.round(Math.max(0, Math.min(metrics.top, metrics.max)))} tabIndex={0}
    style={{ height, top: travel * metrics.top / metrics.max }}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.dataset.dragY = String(event.clientY);
      event.currentTarget.dataset.dragScroll = String(window.scrollY);
    }}
    onPointerMove={event => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId) || !travel) return;
      window.scrollTo({ top: Number(event.currentTarget.dataset.dragScroll) + (event.clientY - Number(event.currentTarget.dataset.dragY)) * metrics.max / travel, behavior: 'instant' });
    }}
    onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onKeyDown={event => {
      const positions: Record<string, number> = { ArrowDown: metrics.top + 40, ArrowUp: metrics.top - 40, PageDown: metrics.top + metrics.viewport, PageUp: metrics.top - metrics.viewport, Home: 0, End: metrics.max };
      if (positions[event.key] === undefined) return;
      event.preventDefault();
      window.scrollTo({ top: positions[event.key], behavior: 'instant' });
    }} />;
}

