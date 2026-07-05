/**
 * AutoSaveService — periodic and idle-driven document auto-save.
 *
 * Monitors edit activity and triggers saves via a provided save function.
 * Supports retry, concurrency guard, configurable intervals, save state
 * callbacks for UI feedback, and coordinated recovery point creation.
 *
 * Research basis: Figma autosave architecture (delta-based saves,
 * IndexedDB persistence, stale change detection), Trimble backup model
 * (periodic snapshots + backup rotation).
 */

import type { Document } from '@strata/scene';
import { serializeDocument } from '@strata/scene';

export interface AutoSaveConfig {
  intervalMs: number;
  idleThresholdMs: number;
  maxSaveRetries: number;
}

export type AutoSaveState = 'idle' | 'saving' | 'error';

export type AutoSaveStateCallback = (state: AutoSaveState, lastSavedAt: number | null) => void;

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
  private stateCallbacks: Set<AutoSaveStateCallback> = new Set();
  private onSaveRecovery:
    | ((doc: Document, meta: { fileId?: string; name: string }) => Promise<void>)
    | null = null;

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

  onStateChange(callback: AutoSaveStateCallback): () => void {
    this.stateCallbacks.add(callback);
    return () => {
      this.stateCallbacks.delete(callback);
    };
  }

  setOnSaveRecovery(
    fn: ((doc: Document, meta: { fileId?: string; name: string }) => Promise<void>) | null,
  ): void {
    this.onSaveRecovery = fn;
  }

  notifyEdit(): void {
    this.dirty = true;
    this.lastEditAt = Date.now();
  }

  async saveNow(): Promise<boolean> {
    if (this._state === 'saving') return false;
    this.setState('saving');
    let attempts = 0;
    const maxAttempts = Math.max(1, this.cfg.maxSaveRetries);
    while (attempts < maxAttempts) {
      attempts++;
      try {
        const { document, meta } = this.getDocument();
        const json = serializeDocument({ ...document });
        const ok = await this.saveFn(json);
        if (ok) {
          this._lastSavedAt = Date.now();
          this.dirty = false;
          this.setState('idle');
          // Create recovery point after successful save
          if (this.onSaveRecovery) {
            try {
              await this.onSaveRecovery(document, meta);
            } catch {
              // Recovery point failure should not block the save
            }
          }
          return true;
        }
      } catch {
        // will retry
      }
    }
    this.setState('error');
    return false;
  }

  private setState(s: AutoSaveState): void {
    this._state = s;
    for (const cb of this.stateCallbacks) {
      cb(s, this._lastSavedAt);
    }
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
