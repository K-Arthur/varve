export class FrameCache<K, V> {
  private store = new Map<K, { value: V; lastFrame: number }>();
  private frame = 0;

  nextFrame(): void {
    this.frame++;
  }

  get(k: K): V | undefined {
    const entry = this.store.get(k);
    if (!entry) return undefined;
    entry.lastFrame = this.frame;
    return entry.value;
  }

  set(k: K, v: V): void {
    this.store.set(k, { value: v, lastFrame: this.frame });
  }

  sweep(): void {
    for (const [k, v] of this.store) {
      if (this.frame - v.lastFrame > 3) this.store.delete(k);
    }
  }

  size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}
