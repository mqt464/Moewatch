import { useEffect, useState } from 'react';
let keyboard = true;
document.addEventListener('keydown', () => { keyboard = true; document.documentElement.dataset.input = "keyboard"; }, true);
document.addEventListener('pointerdown', () => { keyboard = false; document.documentElement.dataset.input = "pointer"; }, true);
export const keyboardInput = () => keyboard;
export function usePresence(open: boolean, immediate = keyboardInput()) {
 const [retained, setRetained] = useState(open);
 useEffect(() => {
  if (open) { setRetained(true); return; }
  if (immediate) { setRetained(false); return; }
  const timer = setTimeout(() => setRetained(false), 120);
  return () => clearTimeout(timer);
 }, [open, immediate]);
 return { mounted: open || retained, 'data-open': open, 'data-instant': immediate, inert: !open, 'aria-hidden': !open };
}
