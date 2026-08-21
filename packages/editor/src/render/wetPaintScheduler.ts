/**
 * Drives wet-paint drying — and only while something is actually wet.
 *
 * There is deliberately no permanent animation loop. A frame is requested when
 * paint is deposited and re-requested only while the manager still reports wet
 * pixels; once everything dries the scheduler stops completely, so an idle
 * document costs nothing. That is the difference between wet media being a
 * feature and being a background CPU tax for every user who never enables it.
 */
import type { WetPaintManager, WetRect } from '@varve/scene';

export interface WetPaintSchedulerOptions {
  manager: WetPaintManager;
  /** Drying rate in wetness units per second. */
  dryingRate: () => number;
  /** Called with the regions that changed, so the canvas can repaint them. */
  onDirty: (rects: WetRect[]) => void;
  requestFrame?: (cb: (t: number) => void) => number;
  cancelFrame?: (handle: number) => void;
  now?: () => number;
}

export class WetPaintScheduler {
  private handle: number | null = null;
  private readonly requestFrame: (cb: (t: number) => void) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly now: () => number;
  /** Frames run since the scheduler was created — asserted by idle tests. */
  framesRun = 0;

  constructor(private options: WetPaintSchedulerOptions) {
    this.requestFrame =
      options.requestFrame ??
      ((cb) =>
        typeof requestAnimationFrame !== 'undefined'
          ? requestAnimationFrame(cb)
          : (setTimeout(() => cb(Date.now()), 16) as unknown as number));
    this.cancelFrame =
      options.cancelFrame ??
      ((h) => {
        if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(h);
        else clearTimeout(h as unknown as ReturnType<typeof setTimeout>);
      });
    this.now =
      options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  }

  get isRunning(): boolean {
    return this.handle !== null;
  }

  /** Ask the scheduler to run. A no-op when nothing is wet or already running. */
  wake(): void {
    if (this.handle !== null) return;
    if (!this.options.manager.isActive) return;
    this.handle = this.requestFrame(() => this.step());
  }

  /** Pause without drying — for backgrounding, so no time is simulated away. */
  suspend(): void {
    this.stop();
    this.options.manager.suspend();
  }

  stop(): void {
    if (this.handle === null) return;
    this.cancelFrame(this.handle);
    this.handle = null;
  }

  private step(): void {
    this.handle = null;
    this.framesRun++;
    const result = this.options.manager.tick(this.now(), this.options.dryingRate());
    if (result.dirty.length > 0) this.options.onDirty(result.dirty);
    // Re-arm only while there is still something to simulate.
    if (result.remainingWetPixels > 0) {
      this.handle = this.requestFrame(() => this.step());
    }
  }
}
