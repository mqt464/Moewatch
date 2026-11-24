import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { keyboardInput } from './motion';
export function SeriesFacts({ expanded, synopsisExpanded, children }: { expanded: boolean; synopsisExpanded: boolean; children: ReactNode }) {
 const content = useRef<HTMLDivElement>(null);
 const [height, setHeight] = useState(0);
 const [mobile, setMobile] = useState(() => matchMedia('(max-width: 600px)').matches);
 useLayoutEffect(() => {
  const media = matchMedia('(max-width: 600px)');
  const resize = () => { setMobile(media.matches); setHeight(content.current?.getBoundingClientRect().height || 0); };
  const observer = new ResizeObserver(resize);
  if (content.current) observer.observe(content.current);
  media.addEventListener('change', resize); resize();
  return () => { observer.disconnect(); media.removeEventListener('change', resize); };
 }, []);
 // Text disclosure stays immediate; only the outer Series details toggle animates height.
 useLayoutEffect(() => {
  const outer = content.current?.parentElement;
  if (!outer || !mobile || !expanded) return;
  outer.style.transition = 'none';
  const measured = content.current?.getBoundingClientRect().height || 0;
  outer.style.height = measured + 'px';
  outer.getBoundingClientRect();
  outer.style.removeProperty('transition');
  setHeight(measured);
 }, [synopsisExpanded]);
 return <section id="series-facts" className="series-facts" data-open={expanded} data-instant={keyboardInput()} inert={mobile && !expanded} aria-hidden={mobile && !expanded} style={mobile ? { height: expanded ? height : 0 } : undefined}><div ref={content} className="synopsis">{children}</div></section>;
}
