import type { AnimeProvider } from './types';
import { anikoto } from './anikoto';
import { reanime } from './reanime';
import { miruro } from './miruro';

export const providers: AnimeProvider[] = [anikoto, reanime, miruro];
