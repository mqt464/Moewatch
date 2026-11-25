import { Link } from './navigation';
import type { Anime } from './catalog';

export function SeriesMetadata({ anime }: { anime: Anime }) {
  return <div className="series-metadata">
    {anime.genres.length > 0 && <nav className="series-genres" aria-label="Genres">{anime.genres.map(genre => <Link key={genre} to={`/browse?${new URLSearchParams({ genre })}`}>{genre}</Link>)}</nav>}
  </div>;
}
