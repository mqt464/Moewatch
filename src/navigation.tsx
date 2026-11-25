import { Link as RouterLink, useViewTransitionState, type LinkProps } from 'react-router-dom';
import { useKeyboardInput } from './motion';

export const useMotionAllowed = () => !useKeyboardInput() && !window.matchMedia('(pointer: coarse)').matches && typeof document.startViewTransition === 'function' && document.documentElement.dataset.reduceMotion !== 'true' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Link(props: LinkProps) {
  const transitioning = useViewTransitionState(props.to);
  const playbackLink = (typeof props.to === 'string' ? props.to : props.to.pathname)?.startsWith('/watch/');
  return <RouterLink {...props} state={playbackLink ? { ...props.state, autoplay: true } : props.state} data-player-transition={transitioning && playbackLink || undefined} viewTransition={useMotionAllowed()} />;
}

