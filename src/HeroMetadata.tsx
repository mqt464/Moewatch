import { Heart, Star } from 'lucide-react';
import type { Anime } from './catalog';

const compactCount = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const fullCount = new Intl.NumberFormat('en');
const statusLabels: Record<string, string> = { RELEASING: 'Airing', FINISHED: 'Finished', NOT_YET_RELEASED: 'Upcoming', CANCELLED: 'Cancelled', HIATUS: 'On hiatus' };

export function HeroMetadata({ anime, detailed = false }: { anime: Anime; detailed?: boolean }) {
  const score = Number.isFinite(anime.score) ? Math.max(0, Math.min(100, anime.score)) : 0;
  const popularity = Number.isSafeInteger(anime.popularity) && anime.popularity! > 0 ? anime.popularity : undefined;
  const year = anime.year > 0 && <span className="metadata-chip metadata-year">{anime.year}</span>;
  const facts = <div className="metadata-facts">
    {!detailed && year}
    {anime.format !== 'UNKNOWN' && <span className="metadata-chip metadata-format">{anime.format.replaceAll('_', ' ')}</span>}
    {anime.episodes && <span className="metadata-chip metadata-episodes">{anime.episodes} {anime.episodes === 1 ? 'episode' : 'episodes'}</span>}
    {detailed && year}
    </div>;
  const audience = <div className="metadata-audience">
    {detailed && statusLabels[anime.status] && <span className="metadata-chip metadata-status">{statusLabels[anime.status]}</span>}
    {score > 0 && <span className="metadata-chip metadata-rating" role="img" aria-label={`Community rating: ${(score / 20).toFixed(1)} out of 5 stars`} title="AniList community rating">
      <span className="rating-stars" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <span className="rating-star" key={index}>
        <Star size={13} />
        <span className="rating-star-fill" style={{ width: `${Math.max(0, Math.min(1, score / 20 - index)) * 100}%` }}><Star size={13} fill="currentColor" /></span>
      </span>)}</span><span aria-hidden="true">{(score / 20).toFixed(1)}</span>
    </span>}
    {popularity && <span className="metadata-chip metadata-popularity" title={`${fullCount.format(popularity)} AniList users have this anime on their lists`}><Heart size={13} fill="currentColor" aria-hidden="true" /><span aria-hidden="true">{compactCount.format(popularity)}</span><span className="sr-only">Popularity: {fullCount.format(popularity)} AniList users</span></span>}
    </div>;
  return <div className="metadata" role="group" aria-label="Anime metadata">
    {detailed ? <>{audience}{facts}</> : <>{facts}{audience}</>}
  </div>;
}
