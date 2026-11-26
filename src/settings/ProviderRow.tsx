import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { GripVertical } from 'lucide-react';
import type { ProviderId } from '../../shared/api';
import { providerIcons, providerNames } from '../api';
import { SettingRow } from './controls';

export function ProviderRow({ id, order, status, note, onChange }: { id: ProviderId; order: ProviderId[]; status: 'checking' | 'unknown' | 'configured' | 'unavailable'; note?: string; onChange: (order: ProviderId[]) => void }) {
  const row = useRef<HTMLDivElement>(null);
  const drag = useRef<{ start: number; top: number; height: number; order: ProviderId[] } | null>(null);
  const [announcement, announce] = useState('');
  const statusLabel = status === 'configured' ? 'Configured' : status === 'checking' ? 'Checking configuration' : status === 'unknown' ? 'Configuration unknown' : 'Unavailable';
  function move(target: ProviderId) {
    const next = order.filter(other => other !== id);
    next.splice(order.indexOf(target), 0, id);
    onChange(next);
    announce(`${providerNames[id]} moved to position ${next.indexOf(id) + 1} of ${next.length}`);
  }
  function reset() {
    row.current?.parentElement?.querySelectorAll<HTMLElement>('[data-provider-id]').forEach(element => { element.style.order = ''; element.getAnimations().forEach(animation => animation.cancel()); });
    drag.current = null;
    if (row.current) { row.current.style.transform = ''; row.current.removeAttribute('data-dragging'); }
  }
  return <div ref={row} className="provider-priority-row" data-provider-id={id}>
    <SettingRow description={note} title={<span className="settings-provider-name">
      <button className="provider-drag-handle" aria-label={`Reorder ${providerNames[id]}, position ${order.indexOf(id) + 1} of ${order.length}`}
        onKeyDown={event => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          const target = order[order.indexOf(id) + (event.key === 'ArrowUp' ? -1 : 1)];
          if (target) move(target);
        }}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          const rect = row.current?.getBoundingClientRect();
          if (!rect) return;
          drag.current = { start: event.clientY, top: rect.top, height: rect.height, order };
          row.current?.setAttribute('data-dragging', 'true');
        }}
        onPointerMove={event => {
          if (!drag.current || !row.current) return;
          const active = drag.current;
          const elements = [...(row.current.parentElement?.querySelectorAll<HTMLElement>('[data-provider-id]') ?? [])];
          const center = active.top + event.clientY - active.start + active.height / 2;
          const others = active.order.filter(other => other !== id);
          const index = others.filter(other => {
            const element = elements.find(entry => entry.dataset.providerId === other);
            if (!element) return false;
            const rect = element.getBoundingClientRect();
            const animatedOffset = new DOMMatrixReadOnly(getComputedStyle(element).transform).m42;
            return center >= rect.top - animatedOffset + rect.height / 2;
          }).length;
          const next = [...others];
          next.splice(index, 0, id);
          if (next.some((other, position) => active.order[position] !== other)) {
            const positions = new Map(elements.map(element => [element, element.getBoundingClientRect().top]));
            elements.forEach(element => {
              element.getAnimations().forEach(animation => animation.cancel());
              element.style.order = String(next.findIndex(other => other === element.dataset.providerId));
            });
            active.order = next;
            if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && document.documentElement.dataset.reduceMotion !== 'true') {
              elements.filter(element => element !== row.current).forEach(element => {
                const offset = (positions.get(element) ?? element.offsetTop) - element.getBoundingClientRect().top;
                element.animate([{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }], { duration: 180, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
              });
            }
          }
          const currentOffset = new DOMMatrixReadOnly(getComputedStyle(row.current).transform).m42;
          const layoutTop = row.current.getBoundingClientRect().top - currentOffset;
          row.current.style.transform = `translateY(${active.top + event.clientY - active.start - layoutTop}px)`;
        }}
        onPointerUp={() => {
          if (!drag.current) return;
          const next = drag.current.order;
          flushSync(() => onChange(next));
          reset();
          announce(`${providerNames[id]} moved to position ${next.indexOf(id) + 1} of ${next.length}`);
        }} onPointerCancel={reset} onLostPointerCapture={reset}>
        <img draggable={false} src={providerIcons[id]} alt="" width={20} height={20} /><GripVertical size={20} aria-hidden="true" />
      </button>{providerNames[id]}</span>}>
      <span className={`provider-status-bars provider-status-${status}`} role="img" aria-label={statusLabel} title={statusLabel}>
        {Array.from({ length: 12 }, (_, index) => <i key={index} />)}
      </span>
    </SettingRow>
    <span className="provider-announcement" role="status">{announcement}</span>
  </div>;
}

