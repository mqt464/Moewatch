export function discussionUrl(value: string): string | null {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href.replace(/^http:/, 'https:') : null; } catch { return null; }
}
