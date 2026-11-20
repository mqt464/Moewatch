import type { SkipInterval } from '../../shared/api';

type SkipIntervals = { intro?: SkipInterval; outro?: SkipInterval };

export function mergeSkipIntervals(duration: number, provider: SkipIntervals, fallback: SkipIntervals = {}): SkipIntervals {
  const valid = (interval?: SkipInterval) => interval && Number.isFinite(duration) && duration > 0
    && Number.isFinite(interval.start) && Number.isFinite(interval.end)
    && interval.start >= 0 && interval.end > interval.start && interval.end <= duration ? interval : undefined;
  return {
    intro: valid(provider.intro) ?? valid(fallback.intro),
    outro: valid(provider.outro) ?? valid(fallback.outro),
  };
}
