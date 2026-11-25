import { SettingsSelect } from './settings/controls';
import { useRef, type ReactNode } from 'react';
import { ArrowUp, ArrowDown, GripVertical } from 'lucide-react';
import { defaultHomeLayout, type HomeLayout, type HomeRowId } from './homeLayout';

export const homeRowNames: Record<HomeRowId, string> = { watching: 'Watching', recommended: 'Recommended', trending: 'Trending', Action: 'Action', Adventure: 'Adventure', 'Slice of Life': 'Slice of Life' };

export function EditableHomeRow({ id, layout, change, move, children }: { id: HomeRowId; layout: HomeLayout; change: (layout: HomeLayout) => void; move: (id: HomeRowId, target: HomeRowId) => void; children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const drag = useRef<{ start: number; y: number; scroll: number } | null>(null);
  const name = homeRowNames[id];
  const index = layout.order.indexOf(id);
  const hidden = layout.hidden.includes(id);
  function reset() {
    if (row.current) { row.current.style.transform = ''; row.current.style.zIndex = ''; }
    drag.current = null;
  }
  return <div ref={row} className="editable-home-row" data-home-row={id}>
    <div className="carousel-heading home-row-tools">
      <button className="icon-button home-drag-handle" aria-label={`Drag ${name} to reorder`} onPointerDown={event => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { start: event.clientY, y: event.clientY, scroll: window.scrollY };
      }} onPointerMove={event => {
        if (!drag.current || !row.current) return;
        drag.current.y = event.clientY;
        row.current.style.transform = `translateY(${event.clientY - drag.current.start + window.scrollY - drag.current.scroll}px)`;
        row.current.style.zIndex = '2';
        if (event.clientY < 80) window.scrollBy(0, -20);
        if (event.clientY > window.innerHeight - 100) window.scrollBy(0, 20);
      }} onPointerUp={() => {
        if (!drag.current) return;
        const y = drag.current.y;
        const candidates = layout.order.filter(other => other !== id).flatMap(other => {
          const element = document.querySelector(`[data-home-row="${other}"]`);
          if (!element) return [];
          const rect = element.getBoundingClientRect();
          return [{ id: other, distance: Math.abs(y - (rect.top + rect.height / 2)) }];
        });
        const moved = Math.abs(y - drag.current.start) > 10;
        reset();
        const target = candidates.sort((a, b) => a.distance - b.distance)[0];
        if (moved && target) move(id, target.id);
      }} onPointerCancel={reset} onLostPointerCapture={reset}><GripVertical size={18} aria-hidden="true" /></button>
      <h2>{name}</h2>
      <button className="icon-button" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => { const target = layout.order[index - 1]; if (target) move(id, target); }}><ArrowUp size={18} aria-hidden="true" /></button>
      <button className="icon-button" aria-label={`Move ${name} down`} disabled={index === layout.order.length - 1} onClick={() => { const target = layout.order[index + 1]; if (target) move(id, target); }}><ArrowDown size={18} aria-hidden="true" /></button>
      <label><input type="checkbox" checked={!hidden} onChange={() => change({ ...layout, hidden: hidden ? layout.hidden.filter(row => row !== id) : [...layout.hidden, id] })} />Show {name}</label>
      {id === 'watching' && <label>Cards <SettingsSelect aria-label="Watching card style" value={layout.continueStyle} onChange={event => change({ ...layout, continueStyle: event.target.value === 'landscape' ? 'landscape' : 'portrait' })}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></SettingsSelect></label>}
    </div>
    {!hidden && <div className="home-row-preview" inert>{children}</div>}
  </div>;
}

export function HomeEditingBar({ layout, change, save, cancel, error }: { layout: HomeLayout; change: (layout: HomeLayout) => void; save: () => void; cancel: () => void; error: string }) {
  return <div className="home-edit-bar" role="region" aria-label="Homepage editing">
    <span>Edit homepage</span>
    <label><input type="checkbox" checked={layout.hero} onChange={event => change({ ...layout, hero: event.target.checked })} />Show hero</label>
    <button className="button secondary" onClick={() => change({ ...defaultHomeLayout })}>Reset layout</button>
    <button className="button secondary" onClick={cancel}>Cancel</button>
    <button className="button primary" onClick={save}>Save</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
