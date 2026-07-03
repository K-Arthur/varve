/**
 * Timeline playback engine using requestAnimationFrame.
 *
 * Manages playback state (idle/playing/paused/finished), speed control,
 * direction (forward/reverse), iteration counting, and frame callbacks.
 *
 * Research basis: Web Animations API Animation interface (§4.4),
 * GSAP Timeline play/pause/seek/reverse contract.
 */

export type EngineState = 'idle' | 'playing' | 'paused' | 'finished';

export interface PlaybackOptions {
  onFrame: (time: number, iteration: number) => void;
  onFinish?: () => void;
  onIteration?: (iteration: number) => void;
  direction?: 'forward' | 'reverse';
}

export interface EngineConfig {
  duration: number;
  iterations?: number;
}

export class TimelineEngine {
  private _state: EngineState = 'idle';
  private _currentTime = 0;
  private _currentIteration = 0;
  private _lastIteration = 0;
  private _speed = 1;
  private _direction: 'forward' | 'reverse' = 'forward';
  private _config: EngineConfig;
  private _rafId: number | null = null;
  private _lastTimestamp: number | null = null;
  private _onFrame: ((time: number, iteration: number) => void) | null = null;
  private _onFinish: (() => void) | null = null;
  private _onIteration: ((iteration: number) => void) | null = null;

  constructor(config: EngineConfig) {
    this._config = { iterations: 1, ...config };
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
    this._lastTimestamp = null;
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
    this._state = 'idle';
    this._onFrame = null;
    this._onFinish = null;
    this._onIteration = null;
  }

  seek(time: number): void {
    const clamped = Math.max(0, Math.min(time, this._config.duration));
    this._currentTime = clamped;
    this._currentIteration = Math.floor(clamped / Math.max(1, this._config.duration));
    if (this._onFrame) {
      this._onFrame(this._currentTime, this._currentIteration);
    }
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
    this._rafId = requestAnimationFrame((timestamp) => {
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
    if (this._rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  /** Check if the engine should transition to finished state. Returns true if finished. */
  private _checkFinish(): boolean {
    if (this._currentTime >= this._config.duration) {
      const maxIter = this._config.iterations ?? 1;
      const isLastIter = this._currentIteration >= maxIter - 1;
      if (isLastIter && maxIter !== Infinity) {
        this._state = 'finished';
        if (this._onFinish) this._onFinish();
        return true;
      }
    }
    return false;
  }

  private _advanceTime(deltaMs: number): void {
    const dir = this._direction === 'forward' ? 1 : -1;
    this._currentTime += deltaMs * dir;
    this._currentTime = Math.max(0, Math.min(this._currentTime, this._config.duration));

    const newIter = Math.floor(this._currentTime / Math.max(1, this._config.duration));
    if (newIter !== this._lastIteration) {
      this._lastIteration = newIter;
      this._currentIteration = newIter;
      if (this._onIteration && newIter > 0) {
        this._onIteration(newIter);
      }
    }

    if (this._onFrame) {
      this._onFrame(this._currentTime, this._currentIteration);
    }
  }
}
