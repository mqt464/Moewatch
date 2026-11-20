import { curated, type Anime } from './catalog';

const historyKey = 'moewatch.hero-history';

export function heroCandidates(items: Anime[]): Anime[] {
  return items.filter(anime => anime.banner && anime.hasBanner !== false && anime.banner !== anime.cover
    && anime.description.trim() && !anime.isAdult
    && ['FINISHED', 'RELEASING'].includes(anime.status)
    && ['TV', 'TV_SHORT', 'MOVIE', 'ONA', 'OVA'].includes(anime.format));
}

export function createHeroSelection(storage: () => Pick<Storage, 'getItem' | 'setItem'>, random = Math.random) {
  let current: Anime | null = null;
  return {
    current: () => current,
    select(items: Anime[]): Anime {
      if (current) return current;
      const live = heroCandidates(items);
      const pool = live.length ? live : heroCandidates(curated);
      let history: number[] = [];
      try {
        const saved: unknown = JSON.parse(storage().getItem(historyKey) || '[]');
        if (Array.isArray(saved)) history = saved.filter(id => Number.isSafeInteger(id) && id > 0);
      } catch { /* Rotation still works when local storage is unavailable. */ }
      let candidates = pool.filter(anime => !history.includes(anime.id));
      if (!candidates.length) {
        candidates = pool.filter(anime => anime.id !== history.at(-1));
        if (!candidates.length) candidates = pool;
        history = history.slice(-1);
      }
      current = candidates[Math.floor(random() * candidates.length)];
      try { storage().setItem(historyKey, JSON.stringify([...history, current.id].slice(-100))); }
      catch { /* Keep the selected hero even if history cannot be saved. */ }
      return current;
    },
  };
}

export const featuredHero = createHeroSelection(() => localStorage);
