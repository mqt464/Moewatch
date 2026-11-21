import { partySeekTarget, type PartyAction, type PartyUpdate } from '../../shared/watchparty';

export const partyControlEvent = 'moewatch-playback-action';
export function notifyPartyControl(video: HTMLVideoElement, action: PartyAction) {
  video.dispatchEvent(new CustomEvent(partyControlEvent, { detail: action }));
}

export async function applyPartyPlayback(video: HTMLVideoElement, update: PartyUpdate, force = false) {
  const target = partySeekTarget(update, video.currentTime, video.duration, force);
  if (target !== null) video.currentTime = target;
  video.playbackRate = update.rate;
  if (update.paused) video.pause();
  else if (video.paused) await video.play();
}
