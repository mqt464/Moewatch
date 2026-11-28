import type { Anime } from './catalog';
import { usePreferences } from './PreferencesContext';

export function AnimeTitle({ anime }: { anime: Pick<Anime, 'title'> & Partial<Pick<Anime, 'romaji'>> }) {
  const { preferences } = usePreferences();
  return <>{preferences.titleLanguage === 'romaji' ? anime.romaji || anime.title : anime.title}</>;
}
