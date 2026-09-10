/**
 * A display-frame queue for direct-manipulation input.
 *
 * Pointer devices may produce several samples before the next paint. Keeping
 * only the newest value prevents obsolete interaction states from building a
 * visible backlog behind the pointer.
 */
export class LatestPointerQueue<T> {
  private latest: T | null = null;
  private frame: number | null = null;

  constructor(
    private readonly schedule: (callback: () => void) => number,
    private readonly cancel: (frame: number) => void,
    private readonly consume: (sample: T) => void,
  ) {}

  push(sample: T): void {
    this.latest = sample;
    if (this.frame === null) this.frame = this.schedule(() => this.flush());
  }

  cancelPending(): void {
    if (this.frame !== null) this.cancel(this.frame);
    this.frame = null;
    this.latest = null;
  }

  flushPending(): void {
    if (this.frame !== null) this.cancel(this.frame);
    this.frame = null;
    this.flush();
  }

  private flush(): void {
    this.frame = null;
    const sample = this.latest;
    this.latest = null;
    if (sample !== null) this.consume(sample);
  }
}
