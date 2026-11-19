import type { AnimeProvider } from './types';
import { anikoto } from './anikoto';
import { reanime } from './reanime';
import { miruro } from './miruro';
import { anipm } from './anipm';
import { gotaku } from './gotaku';
import { mkissa } from './mkissa';

export const providers: AnimeProvider[] = [anikoto, reanime, gotaku, miruro, mkissa, anipm];
