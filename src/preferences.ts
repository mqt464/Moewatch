export const preferencesKey = 'moewatch-settings-v1';
import { providerIds, type AudioPreference, type ProviderPreference } from '../shared/api';
import type { DownloadQuality } from '../shared/downloads';

export const defaultPreferences = { showYears: false, reduceMotion: false, provider: 'auto' as ProviderPreference, audio: 'sub' as AudioPreference, providerFallback: true, subtitles: false, volume: 1, muted: false, downloadQuality: 720 as DownloadQuality };
export type Preferences = typeof defaultPreferences;

export function readPreferences(raw: string | null): Preferences {
  try {
    const value = JSON.parse(raw || 'null');
    if (!value || typeof value !== 'object') return { ...defaultPreferences };
    return {
      downloadQuality: [480, 720, 1080].includes(value.downloadQuality) ? value.downloadQuality : defaultPreferences.downloadQuality,
      showYears: typeof value.showYears === 'boolean' ? value.showYears : defaultPreferences.showYears,
      reduceMotion: typeof value.reduceMotion === 'boolean' ? value.reduceMotion : defaultPreferences.reduceMotion,
      provider: value.provider === 'auto' || providerIds.includes(value.provider) ? value.provider : defaultPreferences.provider,
      audio: value.audio === 'sub' || value.audio === 'dub' ? value.audio : defaultPreferences.audio,
      volume: typeof value.volume === 'number' && Number.isFinite(value.volume) && value.volume >= 0 && value.volume <= 1 ? value.volume : defaultPreferences.volume,
      muted: typeof value.muted === 'boolean' ? value.muted : defaultPreferences.muted,
      subtitles: typeof value.subtitles === 'boolean' ? value.subtitles : defaultPreferences.subtitles,
      providerFallback: typeof value.providerFallback === 'boolean' ? value.providerFallback : defaultPreferences.providerFallback,
    };
  } catch { return { ...defaultPreferences }; }
}
