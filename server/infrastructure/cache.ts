export class TtlCache<T> {
  private entries = new Map<string, { value: T; expires: number }>();
  constructor(private limit: number, private ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= Date.now()) { this.entries.delete(key); return undefined; }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs = this.ttlMs): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expires: Date.now() + Math.max(1, Math.min(ttlMs, this.ttlMs)) });
    for (const [key, entry] of this.entries) if (entry.expires <= Date.now()) this.entries.delete(key);
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
  }
}
