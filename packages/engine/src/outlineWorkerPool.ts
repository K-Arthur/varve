import type {
  OutlineWorkerError,
  OutlineWorkerProgress,
  OutlineWorkerRequest,
  OutlineWorkerResult,
  WorkerGlyphOutline,
} from './outlineWorker';

export type WorkerStatus = 'idle' | 'processing' | 'cancelling' | 'error';

export interface OutlineJob {
  id: string;
  text: string;
  fontData: ArrayBuffer;
  fontSize: number;
  fontWeight?: number;
  fontStyle?: string;
  letterSpacing?: number;
  variableAxes?: Record<string, number>;
  status: WorkerStatus;
  progress: number;
  warnings: string[];
  abortController?: AbortController;
}

export interface OutlineJobResult {
  id: string;
  glyphs: WorkerGlyphOutline[];
  bounds: { x: number; y: number; w: number; h: number };
  hasColorGlyphs: boolean;
  warnings: string[];
}

export interface OutlinePoolConfig {
  maxWorkers?: number;
  chunkSize?: number;
}

const DEFAULT_CONFIG: Required<OutlinePoolConfig> = {
  maxWorkers: 2,
  chunkSize: 5000,
};

type PoolListener = (event: PoolEvent) => void;

export type PoolEvent =
  | { type: 'jobProgress'; jobId: string; progress: number; total: number }
  | { type: 'jobComplete'; jobId: string; result: OutlineJobResult }
  | { type: 'jobError'; jobId: string; error: string }
  | { type: 'jobCancelled'; jobId: string }
  | { type: 'allComplete' };

export class OutlineWorkerPool {
  private config: Required<OutlinePoolConfig>;
  private workers: Worker[] = [];
  private jobs: Map<string, OutlineJob> = new Map();
  private queue: string[] = [];
  private activeCount = 0;
  private listeners: Set<PoolListener> = new Set();
  private workerIndex = 0;

  constructor(config?: OutlinePoolConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  subscribe(listener: PoolListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(event: PoolEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch {
        // ignore
      }
    }
  }

  private getWorker(): Worker | null {
    if (this.workers.length === 0) {
      try {
        const worker = new Worker(new URL('./outlineWorker.ts', import.meta.url), {
          type: 'module',
        });
        this.workers.push(worker);
      } catch {
        return null;
      }
    }
    const worker = this.workers[this.workerIndex % this.workers.length]!;
    this.workerIndex++;
    return worker;
  }

  submit(job: Omit<OutlineJob, 'id' | 'status' | 'progress' | 'warnings'>): string {
    const id = `outline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fullJob: OutlineJob = {
      ...job,
      id,
      status: 'idle',
      progress: 0,
      warnings: [],
    };
    this.jobs.set(id, fullJob);
    this.queue.push(id);
    this.processQueue();
    return id;
  }

  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.status === 'idle' || job.status === 'processing') {
      job.status = 'cancelling';
      job.abortController?.abort();
      this.notify({ type: 'jobCancelled', jobId });
      return true;
    }
    return false;
  }

  cancelAll(): void {
    for (const [id, job] of this.jobs) {
      if (job.status === 'idle' || job.status === 'processing') {
        job.status = 'cancelling';
        job.abortController?.abort();
        this.notify({ type: 'jobCancelled', jobId: id });
      }
    }
    this.queue.length = 0;
  }

  getJob(jobId: string): OutlineJob | undefined {
    return this.jobs.get(jobId);
  }

  getAllJobs(): OutlineJob[] {
    return Array.from(this.jobs.values());
  }

  cleanJobs(): void {
    for (const [id, job] of this.jobs) {
      if (job.status !== 'idle' && job.status !== 'processing') {
        this.jobs.delete(id);
      }
    }
  }

  destroy(): void {
    this.cancelAll();
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers.length = 0;
    this.jobs.clear();
    this.queue.length = 0;
    this.listeners.clear();
  }

  private async processQueue(): Promise<void> {
    if (this.activeCount >= this.config.maxWorkers) return;
    if (this.queue.length === 0) return;

    const jobId = this.queue.shift()!;
    const job = this.jobs.get(jobId);
    if (!job || job.status === 'cancelling') {
      this.processQueue();
      return;
    }

    this.activeCount++;
    job.status = 'processing';
    job.abortController = new AbortController();

    const worker = this.getWorker();
    if (!worker) {
      this.notify({ type: 'jobError', jobId, error: 'No worker available' });
      this.activeCount--;
      this.processQueue();
      return;
    }

    try {
      const text = job.text;
      const chunkSize = this.config.chunkSize;
      const totalChunks = Math.ceil(text.length / chunkSize);

      if (totalChunks <= 1) {
        const result = await this.processChunk(worker, job, text);
        if (result) {
          job.status = 'idle';
          job.progress = 1;
          this.notify({ type: 'jobComplete', jobId, result });
        }
      } else {
        const allGlyphs: WorkerGlyphOutline[] = [];
        const allWarnings: string[] = [];
        let bounds: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 0, h: 0 };
        let hasColorGlyphs = false;

        const shouldContinue = (): boolean =>
          (job.status as WorkerStatus) !== 'cancelling' && (job.status as WorkerStatus) !== 'error';

        for (let chunkIdx = 0; chunkIdx < totalChunks && shouldContinue(); chunkIdx++) {
          const start = chunkIdx * chunkSize;
          const end = Math.min(start + chunkSize, text.length);
          const chunkText = text.slice(start, end);

          const chunkResult = await this.processChunk(
            worker,
            { ...job, text: chunkText },
            chunkText,
          );

          if (chunkResult) {
            allGlyphs.push(...chunkResult.glyphs);
            allWarnings.push(...chunkResult.warnings);
            hasColorGlyphs = hasColorGlyphs || chunkResult.hasColorGlyphs;
            if (chunkIdx === 0) {
              bounds = chunkResult.bounds;
            } else {
              bounds = {
                x: Math.min(bounds.x, chunkResult.bounds.x),
                y: Math.min(bounds.y, chunkResult.bounds.y),
                w:
                  Math.max(bounds.x + bounds.w, chunkResult.bounds.x + chunkResult.bounds.w) -
                  Math.min(bounds.x, chunkResult.bounds.x),
                h:
                  Math.max(bounds.y + bounds.h, chunkResult.bounds.y + chunkResult.bounds.h) -
                  Math.min(bounds.y, chunkResult.bounds.y),
              };
            }
          }

          job.progress = (chunkIdx + 1) / totalChunks;
          this.notify({ type: 'jobProgress', jobId, progress: job.progress, total: totalChunks });
        }

        if (shouldContinue()) {
          const finalResult: OutlineJobResult = {
            id: jobId,
            glyphs: allGlyphs,
            bounds,
            hasColorGlyphs,
            warnings: allWarnings,
          };
          job.status = 'idle';
          this.notify({ type: 'jobComplete', jobId, result: finalResult });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Worker error';
      job.status = 'error';
      this.notify({ type: 'jobError', jobId, error: msg });
    }

    this.activeCount--;
    this.processQueue();

    if (this.activeCount === 0 && this.queue.length === 0) {
      this.notify({ type: 'allComplete' });
    }
  }

  private processChunk(
    worker: Worker,
    job: OutlineJob,
    text: string,
  ): Promise<OutlineJobResult | null> {
    return new Promise((resolve) => {
      const onMessage = (e: MessageEvent) => {
        const msg = e.data as OutlineWorkerProgress | OutlineWorkerResult | OutlineWorkerError;
        if (msg.id !== job.id) return;

        switch (msg.type) {
          case 'progress':
            this.notify({
              type: 'jobProgress',
              jobId: job.id,
              progress: msg.glyphsCompleted / msg.totalGlyphs,
              total: msg.totalGlyphs,
            });
            break;
          case 'result':
            worker.removeEventListener('message', onMessage);
            resolve({
              id: job.id,
              glyphs: msg.glyphs,
              bounds: msg.bounds,
              hasColorGlyphs: msg.hasColorGlyphs,
              warnings: msg.warnings,
            });
            break;
          case 'error':
            worker.removeEventListener('message', onMessage);
            resolve(null);
            break;
        }
      };

      worker.addEventListener('message', onMessage);

      const request: OutlineWorkerRequest = {
        id: job.id,
        text,
        fontData: job.fontData,
        fontSize: job.fontSize,
        fontWeight: job.fontWeight,
        fontStyle: job.fontStyle,
        letterSpacing: job.letterSpacing,
        variableAxes: job.variableAxes,
        chunkIndex: 0,
        totalChunks: 1,
      };

      worker.postMessage(request, [job.fontData]);
    });
  }
}

let globalPool: OutlineWorkerPool | null = null;

export function getOutlineWorkerPool(config?: OutlinePoolConfig): OutlineWorkerPool {
  if (!globalPool) {
    globalPool = new OutlineWorkerPool(config);
  }
  return globalPool;
}

export function destroyOutlineWorkerPool(): void {
  if (globalPool) {
    globalPool.destroy();
    globalPool = null;
  }
}
