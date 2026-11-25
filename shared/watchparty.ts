export type PartyMember = { id: string; name: string; avatar: string };
export type PartyAction = 'play' | 'pause' | 'seek' | 'episode' | 'sync' | 'ready';
export type PartyPlayback = {
  animeId: number;
  episode: number;
  time: number;
  paused: boolean;
  rate: number;
  at: number;
};
export type PartyUpdate = PartyPlayback & { action: PartyAction; clock: number; sender: string; transition?: string };
export type PartyStatus = {
  loading?: { id: string; animeId: number; episode: number; ready: string[] };
  enabled: boolean;
  active: boolean;
  destination: { animeId: number; episode: number } | null;
  room: string;
  self: string;
  members: PartyMember[];
  playback: PartyUpdate | null;
  error: string;
};

export const emptyParty: PartyStatus = { enabled: false, active: false, destination: null, room: '', self: '', members: [], playback: null, error: '' };
export const partyDriftTolerance = 1.5;

export function isPartyPlayback(value: unknown): value is PartyPlayback {
  if (!value || typeof value !== 'object') return false;
  const p = value as PartyPlayback;
  return Number.isSafeInteger(p.animeId) && p.animeId > 0
    && Number.isSafeInteger(p.episode) && p.episode > 0 && p.episode <= 10000
    && Number.isFinite(p.time) && p.time >= 0 && p.time <= 86400
    && typeof p.paused === 'boolean' && Number.isFinite(p.rate) && p.rate >= 0.25 && p.rate <= 4
    && Number.isSafeInteger(p.at) && p.at > 0;
}

export function isPartyUpdate(value: unknown): value is PartyUpdate {
  if (!isPartyPlayback(value)) return false;
  const p = value as PartyUpdate;
  return ['play', 'pause', 'seek', 'episode', 'sync', 'ready'].includes(p.action)
    && (p.transition === undefined || typeof p.transition === 'string' && /^\d+:\d{1,20}$/.test(p.transition))
    && Number.isSafeInteger(p.clock) && p.clock > 0
    && typeof p.sender === 'string' && /^\d{1,20}$/.test(p.sender);
}

export function newerPartyUpdate(next: PartyUpdate, previous: PartyUpdate | null): boolean {
  return !previous || next.clock > previous.clock || next.clock === previous.clock && next.sender > previous.sender;
}

export function partyPosition(p: PartyPlayback, now = Date.now()): number {
  // Clock skew must not create negative elapsed time or seek beyond one day's media.
  return Math.min(86400, p.time + (p.paused ? 0 : Math.max(0, now - p.at) / 1000 * p.rate));
}

export function partySeekTarget(p: PartyUpdate, current: number, duration: number, force = false, now = Date.now()): number | null {
  const target = Math.min(partyPosition(p, now), Math.max(0, duration - 0.05));
  return force || p.action === 'seek' || p.action === 'episode' || Math.abs(target - current) > partyDriftTolerance ? target : null;
}
