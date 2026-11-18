import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type HTMLAttributes, type RefObject } from 'react';
import './scrollbars';

export function ScrollFades({ viewport }: { viewport?: RefObject<HTMLElement | null> }) {
  const fades = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const area = viewport?.current ?? document.scrollingElement;
    const overlay = fades.current;
    if (!area || !overlay) return;
    const syncEdges = () => {
      overlay.dataset.top = String(area.scrollTop > 1);
      overlay.dataset.bottom = String(area.scrollTop + area.clientHeight < area.scrollHeight - 1);
      overlay.dataset.left = String(area.scrollLeft > 1);
      overlay.dataset.right = String(area.scrollLeft + area.clientWidth < area.scrollWidth - 1);
    };
    const resize = new ResizeObserver(syncEdges);
    const observeSize = () => {
      resize.disconnect();
      resize.observe(area);
      for (const child of area.children) resize.observe(child);
      syncEdges();
    };
    const mutations = new MutationObserver(observeSize);
    mutations.observe(area, { childList: true, characterData: true, subtree: true });
    const scrollTarget = viewport ? area : document;
    scrollTarget.addEventListener('scroll', syncEdges, { passive: true });
    window.addEventListener('resize', syncEdges);
    observeSize();
    return () => {
      resize.disconnect();
      mutations.disconnect();
      scrollTarget.removeEventListener('scroll', syncEdges);
      window.removeEventListener('resize', syncEdges);
    };
  }, [viewport]);

  return <div ref={fades} className={`scroll-fades${viewport ? '' : ' document-scroll-fades'}`} aria-hidden="true">
    <span className="scroll-fade-top" />
    <span className="scroll-fade-bottom" />
    <span className="scroll-fade-left" />
    <span className="scroll-fade-right" />
  </div>;
}

export const ScrollArea = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function ScrollArea({ children, className = '', ...props }, ref) {
  const viewport = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => viewport.current!);
  return <div className="scroll-frame">
    <div {...props} ref={viewport} className={`scroll-area ${className}`}>{children}</div>
    <ScrollFades viewport={viewport} />
  </div>;
});
