export const homeRowIds = ['watching', 'recommended', 'trending', 'Action', 'Adventure', 'Slice of Life'] as const;
export type HomeRowId = typeof homeRowIds[number];
export type HomeLayout = { order: HomeRowId[]; hidden: HomeRowId[]; hero: boolean; continueStyle: 'portrait' | 'landscape' };
export const defaultHomeLayout: HomeLayout = { order: [...homeRowIds], hidden: [], hero: true, continueStyle: 'portrait' };

function isRow(value: unknown): value is HomeRowId {
  return homeRowIds.some(id => id === value);
}

export function readHomeLayout(value: unknown): HomeLayout {
  if (!value || typeof value !== 'object') return { ...defaultHomeLayout };
  const order = 'order' in value && Array.isArray(value.order) ? [...new Set(value.order.filter(isRow))] : [];
  return {
    order: [...order, ...homeRowIds.filter(id => !order.includes(id))],
    hidden: 'hidden' in value && Array.isArray(value.hidden) ? [...new Set(value.hidden.filter(isRow))] : [],
    hero: !('hero' in value) || typeof value.hero !== 'boolean' ? true : value.hero,
    continueStyle: 'continueStyle' in value && value.continueStyle === 'landscape' ? 'landscape' : 'portrait',
  };
}

export function moveHomeRow(order: HomeRowId[], id: HomeRowId, target: HomeRowId): HomeRowId[] {
  const next = order.filter(row => row !== id);
  next.splice(order.indexOf(target), 0, id);
  return next;
}
