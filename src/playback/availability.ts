import { useEffect, useState } from 'react';
import { fetchAvailability } from '../api';
import type { AudioPreference, AvailabilityResponse, ProviderPreference } from '../../shared/api';

export function availableEpisodes(availability: AvailabilityResponse | null, audio: AudioPreference, provider: ProviderPreference = 'auto'): number[] {
  return [...new Set((availability?.providers ?? []).filter(entry => entry.status === 'available' && (provider === 'auto' || entry.provider === provider)).flatMap(entry => entry.episodes.filter(episode => episode.kind === 'regular' && episode.audio.includes(audio)).map(episode => episode.number)))].sort((first, second) => first - second);
}

export function useAvailability(animeId: number) {
  const [result, setResult] = useState<{ animeId: number; data: AvailabilityResponse | null; loading: boolean; error: string }>({ animeId, data: null, loading: true, error: '' });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResult({ animeId, data: null, loading: true, error: '' });
    fetchAvailability(animeId, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult({ animeId, data, loading: false, error: '' });
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ animeId, data: null, loading: false, error: error instanceof Error ? error.message : 'Provider availability could not be checked.' });
    });
    return () => controller.abort();
  }, [animeId, revision]);
  return { ...(result.animeId === animeId ? result : { data: null, loading: true, error: '' }), retry: () => setRevision(value => value + 1) };
}
