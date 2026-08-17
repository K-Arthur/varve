import type { BrushDab, BrushPreset, StrokePoint } from '@varve/scene';
import { generateDabs, seedJitter, smoothStrokePoints, strokeBounds } from '@varve/scene';
import type { BrushWorkerCommand, BrushWorkerResponse } from './brushWorker';

export interface DabResult {
  dabs: BrushDab[];
  bounds: { x: number; y: number; w: number; h: number };
}

type DabCallback = (result: DabResult) => void;

interface PendingRequest {
  strokeId: string;
  requestId: number;
  resolve: DabCallback;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class BrushWorkerHost {
  private worker: Worker | null = null;
  private fallback = false;
  private pendingRequests = new Map<number, PendingRequest>();
  private nextRequestId = 1;

  constructor() {
    if (typeof Worker === 'undefined') {
      this.fallback = true;
      return;
    }
    try {
      this.worker = new Worker(new URL('./brushWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<BrushWorkerResponse>) => {
        this.handleResponse(e.data);
      };
      this.worker.onerror = () => {
        this.fallback = true;
        this.worker?.terminate();
        this.worker = null;
        this.rejectAll(new Error('Brush worker error, falling back to main thread'));
      };
    } catch {
      this.fallback = true;
    }
  }

  private handleResponse(msg: BrushWorkerResponse): void {
    const pending = this.pendingRequests.get(msg.requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(msg.requestId);
    pending.resolve({ dabs: msg.dabs, bounds: msg.bounds });
  }

  private rejectAll(err: Error): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(err);
    }
    this.pendingRequests.clear();
  }

  generateDabs(
    strokeId: string,
    points: StrokePoint[],
    preset: BrushPreset,
    jitterSeed: number,
  ): Promise<DabResult> {
    return new Promise<DabResult>((resolve, reject) => {
      if (this.fallback || !this.worker) {
        seedJitter(jitterSeed);
        const smoothed = smoothStrokePoints(points, preset.smoothing);
        const dabs = generateDabs(smoothed, preset);
        const bounds = strokeBounds(dabs);
        resolve({ dabs, bounds });
        return;
      }

      const requestId = this.nextRequestId++;
      // Generous timeout — long strokes with many points and complex
      // dynamics evaluation can take several seconds.
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        this.fallback = true;
        this.worker?.terminate();
        this.worker = null;
        reject(new Error('Brush worker timeout — falling back to main thread'));
      }, 5000);

      this.pendingRequests.set(requestId, { strokeId, requestId, resolve, reject, timeout });

      const cmd: BrushWorkerCommand = {
        type: 'generateDabs',
        strokeId,
        points,
        preset,
        jitterSeed,
        requestId,
      };

      try {
        this.worker.postMessage(cmd);
      } catch {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        this.fallback = true;
        this.worker?.terminate();
        this.worker = null;
        reject(new Error('Brush worker postMessage failed'));
      }
    });
  }

  cancelStroke(strokeId: string): void {
    for (const [requestId, pending] of this.pendingRequests) {
      if (pending.strokeId !== strokeId) continue;
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(requestId);
      pending.reject(new Error('Brush stroke cancelled'));
    }
  }

  destroy(): void {
    this.rejectAll(new Error('Brush worker destroyed'));
    this.worker?.terminate();
    this.worker = null;
    this.fallback = true;
  }

  get isUsingWorker(): boolean {
    return !this.fallback && this.worker !== null;
  }
}
