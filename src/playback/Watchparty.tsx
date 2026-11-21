import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { apiRequest } from '../api';
import { emptyParty, type PartyAction, type PartyPlayback, type PartyStatus } from '../../shared/watchparty';
import { applyPartyPlayback, partyControlEvent } from './partyPlayback';

const post = (path: string, value: unknown) => apiRequest(`/discord/party/${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
});
type PartyContext = {
  status: PartyStatus;
  advertise: (playback: PartyPlayback | null) => void;
  action: (action: PartyAction, playback: PartyPlayback) => void;
  leave: () => void;
};
const Context = createContext<PartyContext>({ status: emptyParty, advertise() {}, action() {}, leave() {} });
export const useWatchparty = () => useContext(Context);

export function WatchpartyProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<PartyStatus>(emptyParty);
  const current = useRef(status); current.current = status;
  const navigate = useNavigate();
  const location = useLocation();
  const path = useRef(location.pathname); path.current = location.pathname;
  const navigation = useRef(navigate); navigation.current = navigate;
  const left = useRef(false);
  const previousPath = useRef(location.pathname);
  const fail = () => setStatus(previous => previous.room ? { ...previous, playback: null,
    error: 'Watchparty sync disconnected. Leave the party to continue watching on your own.' } : previous);
  useEffect(() => {
    const controller = new AbortController();
    let events: EventSource | undefined;
    const receive = (value: PartyStatus) => {
      if (left.current) return;
      setStatus(value);
      const update = value.playback;
      if (value.destination && !value.error) {
        const destination = `/watch/${value.destination.animeId}/${value.destination.episode}`;
        if (path.current !== destination) navigation.current(destination);
        return;
      }
      if (update && !value.error && update.sender !== value.self) {
        const destination = `/watch/${update.animeId}/${update.episode}`;
        if (path.current !== destination) navigation.current(destination);
      }
    };
    apiRequest<PartyStatus>('/discord/party', { signal: controller.signal }).then(value => {
      if (controller.signal.aborted || !value.enabled) return;
      receive(value);
      events = new EventSource('/api/v1/discord/party/events');
      events.onmessage = event => { try { receive(JSON.parse(event.data)); } catch { fail(); } };
      // Reconnecting locally never resends playback commands to Discord.
      events.onerror = () => fail();
    }).catch(() => {});
    return () => { controller.abort(); events?.close(); };
  }, []);
  useEffect(() => {
    const wasWatching = previousPath.current.startsWith('/watch/');
    previousPath.current = location.pathname;
    if (status.enabled && wasWatching && !location.pathname.startsWith('/watch/')) {
      void post('playback', null).catch(() => {});
      if (status.room && !left.current) {
        left.current = true;
        void post('leave', {}).then(() => { setStatus({ ...emptyParty, enabled: true }); }).catch(fail).finally(() => { left.current = false; });
      }
    }
  }, [location.pathname, status.enabled, status.room]);
  const value: PartyContext = {
    status,
    advertise(playback) { if (current.current.enabled && !left.current) void post('playback', playback).catch(fail); },
    action(action, playback) {
      if (current.current.room && !current.current.error && !left.current) void post('action', { ...playback, action }).catch(fail);
    },
    leave() {
      if (left.current) return;
      left.current = true;
      void post('leave', {}).then(() => setStatus({ ...emptyParty, enabled: true })).catch(() => {
        left.current = false; fail();
      }).finally(() => { left.current = false; });
    },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePartyPlayer(videoRef: RefObject<HTMLVideoElement | null>, animeId: number, episode: number, sourceUrl?: string, local = false) {
  const party = useWatchparty();
  const current = useRef(party); current.current = party;
  const [error, setError] = useState('');
  const applied = useRef('');
  const disconnected = useRef(false);
  const snapshot = (): PartyPlayback | null => {
    const video = videoRef.current;
    return video && video.readyState >= 1 && Number.isFinite(video.duration)
      ? { animeId, episode, time: video.currentTime, paused: video.paused, rate: video.playbackRate, at: Date.now() } : null;
  };
  async function apply(force = false) {
    const { status } = current.current;
    const update = status.playback;
    const video = videoRef.current;
    if (!video || video.readyState < 1 || !Number.isFinite(video.duration) || !update || status.error
      || update.animeId !== animeId || update.episode !== episode || local) return false;
    const key = `${update.clock}:${update.sender}`;
    if (!force && (applied.current === key || update.sender === status.self && update.action !== 'sync')) return true;
    applied.current = key;
    try {
      await applyPartyPlayback(video, update, force);
      const latest = current.current.status.playback;
      if (videoRef.current === video && latest?.clock === update.clock && latest.sender === update.sender) setError('');
    }
    catch { setError('Playback could not start. Press Play to join the watchparty.'); }
    return true;
  }
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !sourceUrl || local) return;
    let seekTimer: ReturnType<typeof setTimeout> | undefined;
    const advertise = () => { const p = snapshot(); if (p) current.current.advertise(p); };
    const command = (event: Event) => {
      const action = (event as CustomEvent<PartyAction>).detail;
      setError('');
      clearTimeout(seekTimer);
      const send = () => { const p = snapshot(); if (p) { current.current.advertise(p); current.current.action(action, p); } };
      if (action === 'seek') seekTimer = setTimeout(send, 250);
      else send();
    };
    video.addEventListener(partyControlEvent, command);
    const snapshotEvents = ['loadedmetadata', 'playing', 'pause', 'seeked', 'ratechange'];
    snapshotEvents.forEach(event => video.addEventListener(event, advertise));
    advertise();
    return () => { clearTimeout(seekTimer); video.removeEventListener(partyControlEvent, command); snapshotEvents.forEach(event => video.removeEventListener(event, advertise)); };
  }, [animeId, episode, sourceUrl, local, party.status.enabled]);
  useEffect(() => {
    const recovered = disconnected.current && !party.status.error;
    disconnected.current = Boolean(party.status.error);
    void apply(recovered);
  }, [party.status.playback, party.status.error, sourceUrl]);
  useEffect(() => {
    if (party.status.error || error) videoRef.current?.pause();
  }, [party.status.error, error]);
  useEffect(() => { if (!party.status.room) setError(''); }, [party.status.room]);
  return {
    ...party,
    error: party.status.error || error,
    ready: () => apply(true),
    next(nextEpisode: number) {
      const playback = { animeId, episode: nextEpisode, time: 0, paused: false, rate: videoRef.current?.playbackRate || 1, at: Date.now() };
      party.action('episode', playback);
    },
  };
}

export function PartyAvatars({ members, onLeave }: { members: PartyStatus['members']; onLeave: () => void }) {
  if (!members.length) return null;
  return <div className="watchparty" role="group" aria-label="Watchparty">
    <div className="party-avatars" role="group" aria-label={`${members.length} people watching: ${members.map(member => member.name).join(', ')}`}>
      {members.slice(0, 4).map(member => <span className="party-avatar" key={member.id} title={member.name}>
        <span aria-hidden="true">{member.name.slice(0, 1).toUpperCase()}</span>
        {member.avatar && <img src={member.avatar} alt={member.name} referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = 'none'; }} />}
      </span>)}
      {members.length > 4 && <span className="party-avatar party-overflow" title={members.slice(4).map(member => member.name).join(', ')}>+{members.length - 4}</span>}
    </div>
    <button type="button" className="party-leave" aria-label="Leave watchparty" title="Leave watchparty" onClick={onLeave}><LogOut aria-hidden="true" size={19} /></button>
  </div>;
}
