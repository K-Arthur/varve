/**
 * AutoSaveService — periodic and idle-driven document auto-save.
 *
 * Monitors edit activity and triggers saves via a provided save function.
 * Supports retry, concurrency guard, and configurable intervals.
 */

import type { Document } from '@strata/scene';

export interface AutoSaveConfig {
  intervalMs: number;
  idleThresholdMs: number;
  maxSaveRetries: number;
}

export type AutoSaveState = 'idle' | 'saving' | 'error';

const DEFAULTS: AutoSaveConfig = {
  intervalMs: 300000,
  idleThresholdMs: 2000,
  maxSaveRetries: 3,
};

export class AutoSaveService {
  private cfg: AutoSaveConfig;
  private dirty = false;
  private lastEditAt = 0;
  private _lastSavedAt: number | null = null;
  private _state: AutoSaveState = 'idle';
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    private getDocument: () => { document: Document; meta: { fileId?: string; name: string } },
    private saveFn: (json: string) => Promise<boolean>,
    config?: Partial<AutoSaveConfig>,
  ) {
    this.cfg = { ...DEFAULTS, ...config };
  }

  get lastSavedAt(): number | null {
    return this._lastSavedAt;
  }

  get state(): AutoSaveState {
    return this._state;
  }

  start(): void {
    if (this.intervalId !== null) return;
    this.intervalId = setInterval(() => this.check(), 1000);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  updateConfig(cfg: Partial<AutoSaveConfig>): void {
    this.cfg = { ...this.cfg, ...cfg };
  }

  notifyEdit(): void {
    this.dirty = true;
    this.lastEditAt = Date.now();
  }

  async saveNow(): Promise<boolean> {
    if (this._state === 'saving') return false;
    this._state = 'saving';
    let attempts = 0;
    const maxAttempts = Math.max(1, this.cfg.maxSaveRetries);
    while (attempts < maxAttempts) {
      attempts++;
      try {
        const { document } = this.getDocument();
        const json = JSON.stringify({ ...document, formatVersion: '1.0' });
        const ok = await this.saveFn(json);
        if (ok) {
          this._lastSavedAt = Date.now();
          this.dirty = false;
          this._state = 'idle';
          return true;
        }
      } catch {
        // will retry
      }
    }
    this._state = 'error';
    return false;
  }

  private check(): void {
    if (!this.dirty) return;
    if (this._state === 'saving') return;
    const now = Date.now();
    const idleMs = now - this.lastEditAt;
    if (idleMs < this.cfg.idleThresholdMs) return;
    const sinceLastSave =
      this._lastSavedAt !== null ? now - this._lastSavedAt : this.cfg.intervalMs;
    if (sinceLastSave < this.cfg.intervalMs) return;
    this.saveNow();
  }
}
