import { createHash } from 'node:crypto';

type Entry = { response: Response; expires: number; staleUntil: number; scope: string };
type RequestOptions = { signal: AbortSignal; token?: string; ttlMs?: number; fresh?: boolean };

// One upstream budget is shared by public metadata and signed-in account requests.
export class AniListClient {
  private cache = new Map<string, Entry>();
  private pending = new Map<string, Promise<Response>>();
  private blockedUntil = 0;

  constructor(private now = Date.now) {}

  expire(token: string): void {
    const scope = this.scope(token);
    for (const entry of this.cache.values()) if (entry.scope === scope) entry.expires = 0;
  }

  invalidate(token: string): void {
    const scope = this.scope(token);
    for (const [key, entry] of this.cache) if (entry.scope === scope) this.cache.delete(key);
    // Old in-flight reads may complete for their callers, but cannot repopulate the cache.
    for (const key of this.pending.keys()) if (key.startsWith(scope + ':')) this.pending.delete(key);
  }

  private scope(token = ''): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async request(query: string, variables: Record<string, unknown>, options: RequestOptions): Promise<Response> {
    options.signal.throwIfAborted();
    const mutation = /^\s*mutation\b/.test(query);
    const scope = this.scope(options.token);
    const body = JSON.stringify({ query, variables });
    const key = scope + ':' + createHash('sha256').update(body).digest('hex');
    const stored = !mutation && !options.fresh ? this.cache.get(key) : undefined;
    const usable = stored && stored.staleUntil > this.now() ? stored : undefined;
    if (usable && usable.expires > this.now()) return usable.response.clone();
    if (this.blockedUntil > this.now()) {
      return usable?.response.clone() ?? Response.json({ errors: [{ message: 'AniList rate limit reached' }] }, { status: 429, headers: { 'Retry-After': String(Math.ceil((this.blockedUntil - this.now()) / 1000)) } });
    }
    const existing = !mutation ? this.pending.get(key) : undefined;
    if (existing) {
      const response = await existing;
      options.signal.throwIfAborted();
      return response.clone();
    }
    const run = async () => {
      try {
        const response = await fetch('https://graphql.anilist.co', {
          method: 'POST', redirect: 'error', body,
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
          // A disconnected reader must not cancel a request shared by other readers.
          signal: mutation ? AbortSignal.any([options.signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
        });
        if (response.status === 429) {
          const retry = response.headers.get('Retry-After');
          const delay = retry && /^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - this.now() : 60000;
          this.blockedUntil = Math.max(this.blockedUntil, this.now() + (Number.isFinite(delay) && delay > 0 ? delay : 60000));
        }
        if (response.ok) {
          const data: unknown = await response.clone().json();
          const success = data && typeof data === 'object' && 'data' in data && data.data && (!('errors' in data) || !Array.isArray(data.errors) || data.errors.length === 0);
          if (success && mutation && options.token) this.invalidate(options.token);
          if (success && !mutation && this.pending.get(key) === task) {
            const ttl = options.ttlMs ?? 180000;
            this.cache.delete(key);
            this.cache.set(key, { response: response.clone(), expires: this.now() + ttl, staleUntil: this.now() + Math.max(ttl, 24 * 60 * 60_000), scope });
            for (const [oldKey, entry] of this.cache) if (entry.staleUntil <= this.now()) this.cache.delete(oldKey);
            while (this.cache.size > 256) {
              const oldest = this.cache.keys().next();
              if (!oldest.done) this.cache.delete(oldest.value);
            }
          }
        }
        if (!mutation && usable && (response.status === 429 || response.status >= 500)) return usable.response.clone();
        return response;
      } catch (error) {
        if (!mutation && usable) return usable.response.clone();
        throw error;
      }
    };
    const task = run();
    if (!mutation) this.pending.set(key, task);
    try {
      const response = await task;
      options.signal.throwIfAborted();
      return response.clone();
    } finally {
      if (this.pending.get(key) === task) this.pending.delete(key);
    }
  }
}

export const anilist = new AniListClient();
