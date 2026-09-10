import {
  assertVisionOutput,
  type VisionBackend,
  type VisionCapability,
  type VisionOutputMap,
  type VisionPriority,
  type VisionRequest,
  visionSourceKey,
} from './types';

const PRIORITY_ORDER: Record<VisionPriority, number> = {
  INTERACTIVE: 0,
  VISIBLE_UI: 1,
  BACKGROUND: 2,
  PREFETCH: 3,
};

export type VisionErrorCode =
  | 'VISION_UNSUPPORTED'
  | 'VISION_OUT_OF_MEMORY'
  | 'VISION_CANCELLED'
  | 'VISION_INVALID_RESULT';

export class VisionServiceError extends Error {
  constructor(
    readonly code: VisionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'VisionServiceError';
  }
}

interface QueueEntry<T> {
  priority: number;
  sequence: number;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export interface VisionServiceOptions {
  backends: readonly VisionBackend[];
  maxConcurrent?: number;
  residentMemoryBudgetBytes?: number;
}

export interface VisionServiceStats {
  cacheEntries: number;
  inFlightRequests: number;
  queuedRequests: number;
  activeRequests: number;
  residentBytes: number;
}

/**
 * Demand-driven capability router with request coalescing and a small FIFO
 * priority scheduler. The service caches each capability independently, so a
 * later landmark request can reuse face bounds without rerunning the detector.
 */
export class VisionService {
  private readonly backends: readonly VisionBackend[];
  private readonly maxConcurrent: number;
  private readonly residentMemoryBudgetBytes: number;
  private readonly cache = new Map<string, VisionOutputMap>();
  private readonly inFlight = new Map<string, Promise<VisionOutputMap>>();
  private readonly queue: QueueEntry<VisionOutputMap>[] = [];
  private activeRequests = 0;
  private residentBytes = 0;
  private sequence = 0;

  constructor(options: VisionServiceOptions) {
    this.backends = [...options.backends];
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 1);
    this.residentMemoryBudgetBytes = Math.max(
      1,
      options.residentMemoryBudgetBytes ?? 512 * 1024 * 1024,
    );
  }

  async request(request: VisionRequest): Promise<VisionOutputMap> {
    const capabilities = [...new Set(request.capabilities)];
    if (capabilities.length === 0) return {};
    if (request.signal?.aborted)
      throw new VisionServiceError('VISION_CANCELLED', 'Vision request cancelled.');

    const plans = this.plan(capabilities);
    const outputs: VisionOutputMap = {};
    await Promise.all(
      plans.map(async ({ backend, capabilities: plannedCapabilities }) => {
        const result = await this.requestPlan(request, backend, plannedCapabilities);
        Object.assign(outputs, result);
      }),
    );
    return outputs;
  }

  clearCache(sourceKey?: string): void {
    if (!sourceKey) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${sourceKey}|`)) this.cache.delete(key);
    }
  }

  async dispose(): Promise<void> {
    this.clearCache();
    await Promise.all(this.backends.map((backend) => backend.dispose?.()));
  }

  stats(): VisionServiceStats {
    return {
      cacheEntries: this.cache.size,
      inFlightRequests: this.inFlight.size,
      queuedRequests: this.queue.length,
      activeRequests: this.activeRequests,
      residentBytes: this.residentBytes,
    };
  }

  private plan(capabilities: readonly VisionCapability[]): Array<{
    backend: VisionBackend;
    capabilities: readonly VisionCapability[];
  }> {
    const combined = this.backends
      .filter((backend) => backend.supports(capabilities))
      .sort((a, b) => a.estimatedResidentBytes - b.estimatedResidentBytes)[0];
    if (combined) return [{ backend: combined, capabilities }];

    return capabilities.map((capability) => {
      const backend = this.backends
        .filter((candidate) => candidate.supports([capability]))
        .sort((a, b) => a.estimatedResidentBytes - b.estimatedResidentBytes)[0];
      if (!backend) {
        throw new VisionServiceError(
          'VISION_UNSUPPORTED',
          `No installed vision backend provides ${capability}.`,
        );
      }
      return { backend, capabilities: [capability] };
    });
  }

  private async requestPlan(
    request: VisionRequest,
    backend: VisionBackend,
    capabilities: readonly VisionCapability[],
  ): Promise<VisionOutputMap> {
    const sourceKey = visionSourceKey(request.source);
    const cacheKey = `${sourceKey}|${backend.id}@${backend.version}|${request.quality}|${capabilities.join(',')}`;
    const cached: VisionOutputMap = {};
    const missing: VisionCapability[] = [];
    for (const capability of capabilities) {
      const individualKey = `${sourceKey}|${backend.id}@${backend.version}|${request.quality}|${capability}`;
      const output = this.cache.get(individualKey)?.[capability];
      if (output) cached[capability] = output;
      else missing.push(capability);
    }
    if (missing.length === 0) return cached;

    const existing = this.inFlight.get(cacheKey);
    if (existing) {
      const result = await existing;
      return { ...cached, ...result };
    }

    const job = this.enqueue(request, backend, missing);
    this.inFlight.set(cacheKey, job);
    try {
      const result = await job;
      for (const capability of missing) {
        const output = result[capability];
        if (!output) {
          throw new VisionServiceError(
            'VISION_INVALID_RESULT',
            `Backend ${backend.id} did not return ${capability}.`,
          );
        }
        assertVisionOutput(output, capability);
        this.cache.set(
          `${sourceKey}|${backend.id}@${backend.version}|${request.quality}|${capability}`,
          { [capability]: output },
        );
      }
      return { ...cached, ...result };
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  private enqueue(
    request: VisionRequest,
    backend: VisionBackend,
    capabilities: readonly VisionCapability[],
  ): Promise<VisionOutputMap> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        priority: PRIORITY_ORDER[request.priority],
        sequence: this.sequence++,
        resolve,
        reject,
        run: async () => {
          if (request.signal?.aborted) {
            throw new VisionServiceError('VISION_CANCELLED', 'Vision request cancelled.');
          }
          const nextResidentBytes = this.residentBytes + backend.estimatedResidentBytes;
          if (nextResidentBytes > this.residentMemoryBudgetBytes) {
            throw new VisionServiceError(
              'VISION_OUT_OF_MEMORY',
              `Vision backend ${backend.id} exceeds the resident memory budget.`,
            );
          }
          this.residentBytes = nextResidentBytes;
          try {
            const result = await backend.run({ ...request, capabilities });
            if (request.signal?.aborted) {
              throw new VisionServiceError('VISION_CANCELLED', 'Vision request cancelled.');
            }
            return result;
          } finally {
            this.residentBytes -= backend.estimatedResidentBytes;
          }
        },
      });
      this.pump();
    });
  }

  private pump(): void {
    while (this.activeRequests < this.maxConcurrent && this.queue.length > 0) {
      this.queue.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence);
      const entry = this.queue.shift();
      if (!entry) return;
      this.activeRequests += 1;
      entry
        .run()
        .then(entry.resolve, entry.reject)
        .finally(() => {
          this.activeRequests -= 1;
          this.pump();
        });
    }
  }
}
