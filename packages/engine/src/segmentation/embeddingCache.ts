/** Bounded LRU cache for image embeddings used during a selection session. */

export interface EmbeddingCacheOptions<T> {
  maxEntries: number;
  estimateBytes: (value: T) => number;
  maxBytes?: number;
}

interface CacheEntry<T> {
  value: T;
  bytes: number;
}

export class EmbeddingCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private bytes = 0;

  constructor(private readonly options: EmbeddingCacheOptions<T>) {
    if (options.maxEntries < 1) throw new Error('Embedding cache requires at least one entry');
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    const bytes = Math.max(0, Math.floor(this.options.estimateBytes(value)));
    const previous = this.entries.get(key);
    if (previous) this.bytes -= previous.bytes;
    this.entries.delete(key);
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
    this.evict();
  }

  delete(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.bytes -= entry.bytes;
    this.entries.delete(key);
    return true;
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  get size(): number {
    return this.entries.size;
  }

  get byteSize(): number {
    return this.bytes;
  }

  private evict(): void {
    while (
      this.entries.size > this.options.maxEntries ||
      (this.options.maxBytes !== undefined && this.bytes > this.options.maxBytes)
    ) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
  }
}
