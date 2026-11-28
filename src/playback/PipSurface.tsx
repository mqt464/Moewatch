import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface DocumentPip {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
}
declare global {
  interface Window { documentPictureInPicture?: DocumentPip }
}

const PipContext = createContext<{ active: boolean; toggle: () => Promise<void> } | null>(null);
export const useDocumentPip = () => useContext(PipContext);

// A stable portal container keeps React's events and the playing video intact
// when the browser adopts the player into another document.
export function PipSurface({ children }: { children: ReactNode }) {
  const [container] = useState(() => document.createElement('div'));
  const home = useRef<HTMLDivElement>(null);
  const floating = useRef<Window | null>(null);
  const [active, setActive] = useState(false);
  const pending = useRef(false);
  useEffect(() => () => { floating.current?.close(); }, []);

  async function toggle() {
    if (floating.current) { floating.current.close(); return; }
    if (!window.documentPictureInPicture || pending.current) return;
    pending.current = true;
    try {
      const pip = await window.documentPictureInPicture.requestWindow({ width: 560, height: 315 });
      if (!home.current) { pip.close(); return; }
      floating.current = pip;
      const restore = () => {
        home.current?.append(container);
        floating.current = null;
        setActive(false);
      };
      pip.addEventListener('pagehide', restore, { once: true });
      try {
        pip.document.title = 'Moewatch';
        pip.document.documentElement.className = document.documentElement.className;
        pip.document.documentElement.classList.add('document-pip');
        for (const sheet of document.querySelectorAll('style, link[rel="stylesheet"]')) {
          pip.document.head.append(sheet.cloneNode(true));
        }
        pip.document.body.append(container);
        setActive(true);
      } catch (error) { restore(); pip.close(); throw error; }
    } finally { pending.current = false; }
  }

  return <PipContext.Provider value={{ active, toggle }}>
    <div ref={node => { home.current = node; if (node && !floating.current) node.append(container); }} />
    {active && <div className="pip-placeholder"><p>Playing in picture-in-picture</p><button type="button" onClick={() => floating.current?.close()}>Return to player</button></div>}
    {createPortal(children, container)}
  </PipContext.Provider>;
}
