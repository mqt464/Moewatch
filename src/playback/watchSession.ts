export function createWatchSession() {
  return { unattendedMs: 0, episodes: 0, lastEpisode: '', sleepUntil: 0 };
}

export function recordActivity(session: ReturnType<typeof createWatchSession>) {
  session.unattendedMs = 0;
  session.episodes = 0;
}

export function needsWatchCheck(session: ReturnType<typeof createWatchSession>, episode: string) {
  if (session.lastEpisode !== episode) {
    session.lastEpisode = episode;
    session.episodes += 1;
  }
  return session.episodes >= 3 || session.unattendedMs >= 90 * 60_000;
}

// Keep the session when episode navigation remounts the player.
export const watchSession = createWatchSession();
