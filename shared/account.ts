import type { Anime } from '../src/catalog';

export const accountStatuses = ['CURRENT', 'PLANNING', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING'] as const;
export type AccountStatus = typeof accountStatuses[number];
export type AccountEntry = { id: number; mediaId: number; status: AccountStatus; progress: number; updatedAt: number; anime: Anime };
