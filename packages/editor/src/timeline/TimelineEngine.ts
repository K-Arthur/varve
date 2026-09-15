/**
 * Timeline playback engine using the coordinated editor frame scheduler.
 *
 * Manages playback state (idle/playing/paused/finished), speed control,
 * direction (forward/reverse), iteration counting, and frame callbacks.
 *
 * Research basis: Web Animations API Animation interface (§4.4),
 * GSAP Timeline play/pause/seek/reverse contract.
 */

import {
  cancelEditorFrame,
  createEditorFrameKey,
  requestEditorFrame,
} from '../performance/editorFrameRuntime';

export type EngineState = 'idle' | 'playing' | 'paused' | 'finished';

export interface PlaybackOptions {
  onFrame: (time: number, iteration: number) => void;
  onFinish?: () => void;
  onIteration?: (iteration: number) => void;
  direction?: 'forward' | 'reverse';
  /** When true, skip animation and jump to end state for reduced motion. */
  reducedMotion?: boolean;
}

export interface EngineConfig {
  duration: number;
  iterations?: number;
  loop?: boolean;
  autoReverse?: boolean;
  /** When true, skip animation and jump to end state for reduced motion. */
  reducedMotion?: boolean;
}

export class TimelineEngine {
  private _state: EngineState = 'idle';
  private _currentTime = 0;
  private _currentIteration = 0;
  private _lastIteration = 0;
  private _speed = 1;
  private _direction: 'forward' | 'reverse' = 'forward';
  private _config: EngineConfig;
  private readonly _frameKey = createEditorFrameKey('timeline');
  private _lastTimestamp: number | null = null;
  private _onFrame: ((time: number, iteration: number) => void) | null = null;
  private _onFinish: (() => void) | null = null;
  private _onIteration: ((iteration: number) => void) | null = null;
  /** Current effective play direction including autoReverse alternation. */
  private _effectiveDirection: 'forward' | 'reverse' = 'forward';

  constructor(config: EngineConfig) {
    this._config = { iterations: 1, loop: false, autoReverse: false, ...config };
  }

  get state(): EngineState {
    return this._state;
  }
  get currentTime(): number {
    return this._currentTime;
  }
  get currentIteration(): number {
    return this._currentIteration;
  }
  get speed(): number {
    return this._speed;
  }
  get duration(): number {
    return this._config.duration;
  }
  get iterations(): number {
    return this._config.iterations ?? 1;
  }

  play(opts: PlaybackOptions): void {
    this._onFrame = opts.onFrame;
    this._onFinish = opts.onFinish ?? null;
    this._onIteration = opts.onIteration ?? null;
    this._direction = opts.direction ?? 'forward';
    this._effectiveDirection = this._direction;
    this._lastTimestamp = null;

    if (this._config.reducedMotion || opts.reducedMotion) {
      this._state = 'finished';
      this._currentTime = this._resolveEndTime();
      this._currentIteration = Math.max(0, (this._config.iterations ?? 1) - 1);
      this._effectiveDirection = this._resolveEffectiveDirection(this._currentIteration);
      if (this._onFrame) this._onFrame(this._currentTime, this._currentIteration);
      if (this._onFinish) this._onFinish();
      return;
    }

    this._state = 'playing';
    this._scheduleFrame();
  }

  pause(): void {
    if (this._state !== 'playing') return;
    this._cancelFrame();
    this._state = 'paused';
  }

  stop(): void {
    this._cancelFrame();
    this._currentTime = 0;
    this._currentIteration = 0;
    this._lastIteration = 0;
    this._effectiveDirection = this._direction;
    this._state = 'idle';
    this._onFrame = null;
    this._onFinish = null;
    this._onIteration = null;
  }

  seek(time: number): void {
    const clamped = Math.max(0, Math.min(time, this._config.duration));
    this._currentTime = clamped;
    this._currentIteration = Math.floor(clamped / Math.max(1, this._config.duration));
    this._lastIteration = this._currentIteration;
    this._effectiveDirection = this._resolveEffectiveDirection(this._currentIteration);
    if (this._onFrame) {
      this._onFrame(this._currentTime, this._currentIteration);
    }
  }

  private _resolveEffectiveDirection(iteration: number): 'forward' | 'reverse' {
    if (!this._config.autoReverse) return this._direction;
    const baseIsForward = this._direction === 'forward';
    const even = iteration % 2 === 0;
    return baseIsForward === even ? 'forward' : 'reverse';
  }

  private _resolveEndTime(): number {
    const maxIter = this._config.iterations ?? 1;
    if (maxIter === Infinity) return this._config.duration;
    const lastIteration = Math.max(0, maxIter - 1);
    const finalDirection = this._resolveEffectiveDirection(lastIteration);
    return finalDirection === 'forward' ? this._config.duration : 0;
  }

  setSpeed(speed: number): void {
    this._speed = Math.max(0.01, speed);
  }

  /** Exposed for testing: directly process a tick with a delta time in ms. */
  processDelta(deltaMs: number): void {
    if (this._state !== 'playing') return;
    this._advanceTime(deltaMs * this._speed);
    this._checkFinish();
  }

  /** Exposed for testing: process mock RAF callbacks. */
  processMockRafCallbacks(callbacks: Map<number, (ts: number) => void>): void {
    const entries = Array.from(callbacks.entries());
    callbacks.clear();
    for (const [, cb] of entries) {
      // Don't process if engine is no longer playing
      if (this._state !== 'playing') return;
      cb(performance.now());
    }
  }

  private _scheduleFrame(): void {
    if (typeof requestAnimationFrame === 'undefined') return;
    requestEditorFrame(this._frameKey, 'canvas', (timestamp) => {
      if (this._state !== 'playing') return;

      if (this._lastTimestamp === null) {
        this._lastTimestamp = timestamp;
        this._scheduleFrame();
        return;
      }

      const rawDelta = timestamp - this._lastTimestamp;
      const delta = Math.min(rawDelta, 100) * this._speed;
      this._lastTimestamp = timestamp;

      this._advanceTime(delta);
      const finished = this._checkFinish();
      if (finished) return;
      this._scheduleFrame();
    });
  }

  private _cancelFrame(): void {
    cancelEditorFrame(this._frameKey);
  }

  /** Check if the engine should transition to finished state. Returns true if finished. */
  private _checkFinish(): boolean {
    if (this._state === 'finished') return true;
    const maxIter = this._config.iterations ?? 1;
    const loop = this._config.loop ?? false;

    if (maxIter === Infinity || loop) {
      return false;
    }

    const lastIter = Math.max(0, maxIter - 1);
    if (this._currentIteration < lastIter) return false;

    const atEnd = this._currentTime >= this._config.duration;
    const atStart = this._currentTime <= 0;
    if (this._effectiveDirection === 'forward' ? atEnd : atStart) {
      this._currentTime = this._effectiveDirection === 'forward' ? this._config.duration : 0;
      this._state = 'finished';
      if (this._onFinish) this._onFinish();
      return true;
    }
    return false;
  }

  private _finish(): void {
    if (this._state === 'finished') return;
    this._currentTime = this._effectiveDirection === 'forward' ? this._config.duration : 0;
    this._state = 'finished';
    if (this._onFinish) this._onFinish();
  }

  private _advanceTime(deltaMs: number): void {
    const duration = this._config.duration;
    if (duration <= 0) {
      this._finish();
      return;
    }
    const maxIter = this._config.iterations ?? 1;
    const loop = this._config.loop ?? false;
    const infinite = maxIter === Infinity || loop;
    let remaining = deltaMs;

    while (remaining > 0) {
      const dir = this._effectiveDirection === 'forward' ? 1 : -1;
      const nextTime = this._currentTime + remaining * dir;
      const boundary = this._effectiveDirection === 'forward' ? duration : 0;
      const wouldCross =
        this._effectiveDirection === 'forward' ? nextTime >= duration : nextTime <= 0;

      if (!wouldCross) {
        this._currentTime = nextTime;
        remaining = 0;
        break;
      }

      const used = Math.abs(this._currentTime - boundary);
      remaining -= used;
      this._currentTime = boundary;

      if (!infinite && this._currentIteration >= Math.max(0, maxIter - 1)) {
        this._finish();
        return;
      }

      this._currentIteration += 1;
      this._effectiveDirection = this._resolveEffectiveDirection(this._currentIteration);
      this._currentTime = this._effectiveDirection === 'forward' ? 0 : duration;
      if (this._onIteration) this._onIteration(this._currentIteration);
    }

    if (this._currentIteration !== this._lastIteration) {
      this._lastIteration = this._currentIteration;
    }

    if (this._onFrame) {
      this._onFrame(this._currentTime, this._currentIteration);
    }
  }
}
