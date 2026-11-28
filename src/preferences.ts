import { defaultHomeLayout, readHomeLayout } from './homeLayout';
export const preferencesKey = 'moewatch-settings-v1';
import { providerIds, type AudioPreference, type ProviderId, type ProviderPreference } from '../shared/api';
import type { DownloadQuality } from '../shared/downloads';

export const defaultPreferences = { titleLanguage: 'english', autoNext: true, skipOpening: false, skipEnding: false, resumePlayback: true, subtitleLanguage: 'en', subtitleSize: 100, subtitleBackground: 50, textSize: 100, homeLayout: defaultHomeLayout, providerOrder: [...providerIds] as ProviderId[], discordRpc: true, discordWatchParty: true, showYears: false, reduceMotion: false, provider: 'auto' as ProviderPreference, audio: 'sub' as AudioPreference, providerFallback: true, subtitles: false, volume: 1, muted: false, downloadQuality: 720 as DownloadQuality };
export type Preferences = typeof defaultPreferences;

export function readPreferences(raw: string | null): Preferences {
  try {
    const value = JSON.parse(raw || 'null');
    if (!value || typeof value !== 'object') return { ...defaultPreferences };
    return {
      homeLayout: readHomeLayout(value.homeLayout),
      titleLanguage: value.titleLanguage === 'romaji' ? 'romaji' : 'english',
      autoNext: typeof value.autoNext === 'boolean' ? value.autoNext : true,
      skipOpening: value.skipOpening === true,
      skipEnding: value.skipEnding === true,
      resumePlayback: value.resumePlayback !== false,
      subtitleLanguage: ['en', 'ja', 'es', 'fr', 'de', 'pt', 'ar'].includes(value.subtitleLanguage) ? value.subtitleLanguage : 'en',
      subtitleSize: [75, 100, 125, 150].includes(value.subtitleSize) ? value.subtitleSize : 100,
      subtitleBackground: [0, 50, 75, 100].includes(value.subtitleBackground) ? value.subtitleBackground : 50,
      textSize: [100, 112, 125].includes(value.textSize) ? value.textSize : 100,
      providerOrder: [...new Set<ProviderId>([...(Array.isArray(value.providerOrder) ? value.providerOrder.filter((id: unknown): id is ProviderId => providerIds.some(known => known === id)) : []), ...providerIds])],
      discordRpc: typeof value.discordRpc === 'boolean' ? value.discordRpc : defaultPreferences.discordRpc,
      discordWatchParty: typeof value.discordWatchParty === 'boolean' ? value.discordWatchParty : defaultPreferences.discordWatchParty,
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
