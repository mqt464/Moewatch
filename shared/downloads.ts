import type { Anime } from '../src/catalog';
import type { AudioPreference, PlaybackResponse, ProviderPreference } from './api';

export type DownloadQuality = 480 | 720 | 1080;
export type DownloadEpisode = {
  number: number;
  status: 'queued' | 'downloading' | 'complete' | 'failed';
  progress: number;
  bytes: number;
  error?: string;
  playback?: PlaybackResponse;
};
export type DownloadSeries = {
  id: string;
  anime: Anime;
  audio: AudioPreference;
  quality: DownloadQuality;
  provider: ProviderPreference;
  fallback: boolean;
  episodes: DownloadEpisode[];
  created: number;
  artworkWarning?: string;
  bytesPerSecond?: number;
  remainingSeconds?: number;
};
export type DownloadStorage = { video: number; artwork: number; subtitles: number; other: number; total: number; capacity: number; free: number };
export type DownloadsResponse = { downloads: DownloadSeries[]; location: string; storage: DownloadStorage; canPickFolder: boolean };
