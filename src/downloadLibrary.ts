import type { DownloadSeries } from '../shared/downloads';
import type { Anime } from './catalog';

export function downloadedTitles(downloads: DownloadSeries[]): Anime[] {
  const titles = new Map<number, Anime>();
  for (const job of downloads) {
    if (job.episodes.some(episode => episode.status === 'complete')) titles.set(job.anime.id, job.anime);
  }
  return [...titles.values()];
}
