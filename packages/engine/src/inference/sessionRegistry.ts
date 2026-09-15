/**
 * Refcounted inference-session registry (G3).
 *
 * The registry owns the only production session cache. It enforces three
 * contracts the earlier inline cache did not:
 *
 * 1. **Single-flight creation** — concurrent requests for the same key await
 *    one `InferenceSession.create`, so a second caller cannot leak a session.
 * 2. **Release-before-remove** — a cache entry survives until its underlying
 *    `release()` resolves. A failed release is recorded as unresolved
 *    residency instead of being equated with reclaimed memory.
 * 3. **No release of in-use sessions** — refcounted runs make eviction refuse
 *    a session that is currently executing rather than pulling the runtime
 *    out from under a job.
 *
 * Removing a session from this map never implies the browser returned memory
 * to the OS: ORT Web's WASM heap cannot shrink. `unresolvedBytes` tracks the
 * bytes whose release could not be confirmed, and `retainedCapacityBytes` is
 * the live+unresolved working set the next stage must assume is reusable.
 */

export interface RegistrySessionHandle {
  release?: () => Promise<void>;
}

export interface RegistrySession {
  key: string;
  session: RegistrySessionHandle;
  executionProvider: string;
  modelType: string;
  loadedAt: number;
  /** Conservative working-set estimate recorded by the caller. */
  estimateBytes: number;
  /** Running inferences holding this session. */
  inFlight: number;
  /** True when release() failed and the session may still be resident. */
  releaseFailed: boolean;
}

export interface SessionReleaseReport {
  released: string[];
  failed: Array<{ key: string; message: string }>;
  inUse: string[];
  /** Bytes whose release could not be confirmed (failed releases only). */
  possiblyResidentBytes: number;
  /** Sessions still cached after this request. */
  remaining: number;
}

export interface SessionRegistrySnapshot {
  cached: number;
  inUse: number;
  /** Entries that failed to release and remain conservatively accounted. */
  unresolvedKeys: string[];
  unresolvedBytes: number;
  /**
   * Working-set bytes the next stage must assume may still be allocated in
   * this worker: live session estimates plus unresolved failed releases. The
   * allocator can reuse live-session capacity after release, so this is not a
   * sum over historical peaks.
   */
  retainedCapacityBytes: number;
  /** Highest retained capacity observed, for diagnostics only. */
  highWaterBytes: number;
}

export interface SessionCreationResult {
  entry: RegistrySession;
  created: boolean;
  /** Wall time spent creating the session; 0 when awaited from a peer. */
  sessionMs: number;
}

export class InferenceSessionRegistry {
  private sessions = new Map<string, RegistrySession>();
  private creations = new Map<string, Promise<RegistrySession>>();
  private highWaterBytes = 0;

  constructor(private readonly maxSessions = 3) {
    if (!Number.isSafeInteger(maxSessions) || maxSessions <= 0) {
      throw new RangeError('Session registry capacity must be a positive safe integer.');
    }
  }

  get size(): number {
    return this.sessions.size;
  }

  has(key: string): boolean {
    return this.sessions.has(key);
  }

  get(key: string): RegistrySession | undefined {
    return this.sessions.get(key);
  }

  keys(): string[] {
    return [...this.sessions.keys()];
  }

  /**
   * Return the cached session for `key` or create it through `factory`.
   * Concurrent callers share one creation; a rejected creation is not cached.
   */
  async getOrCreate(
    key: string,
    factory: () => Promise<{
      session: RegistrySessionHandle;
      executionProvider: string;
      modelType: string;
      estimateBytes: number;
    }>,
  ): Promise<SessionCreationResult> {
    const existing = this.sessions.get(key);
    if (existing) return { entry: existing, created: false, sessionMs: 0 };

    const pending = this.creations.get(key);
    if (pending) {
      const entry = await pending;
      return { entry, created: false, sessionMs: 0 };
    }

    const started = Date.now();
    const creation = (async () => {
      const created = await factory();
      const entry: RegistrySession = {
        key,
        session: created.session,
        executionProvider: created.executionProvider,
        modelType: created.modelType,
        loadedAt: Date.now(),
        estimateBytes:
          Number.isFinite(created.estimateBytes) && created.estimateBytes > 0
            ? Math.ceil(created.estimateBytes)
            : 0,
        inFlight: 0,
        releaseFailed: false,
      };
      this.sessions.set(key, entry);
      this.observeHighWater();
      return entry;
    })();
    this.creations.set(key, creation);
    try {
      const entry = await creation;
      return { entry, created: true, sessionMs: Date.now() - started };
    } finally {
      if (this.creations.get(key) === creation) this.creations.delete(key);
    }
  }

  /** Mark a run as using the session so eviction cannot release it. */
  beginRun(key: string): void {
    const entry = this.sessions.get(key);
    if (entry) entry.inFlight += 1;
  }

  endRun(key: string): void {
    const entry = this.sessions.get(key);
    if (entry && entry.inFlight > 0) entry.inFlight -= 1;
  }

  /**
   * Release the named keys (or every idle session when `keys` is omitted).
   * Entries stay in the cache until their release resolves; a failure records
   * unresolved residency. In-use sessions are reported, never released.
   */
  async release(
    keys?: readonly string[],
    _options: { idleOnly?: boolean } = {},
  ): Promise<SessionReleaseReport> {
    const targets = keys ?? this.keys();
    const report: SessionReleaseReport = {
      released: [],
      failed: [],
      inUse: [],
      possiblyResidentBytes: 0,
      remaining: this.sessions.size,
    };
    for (const key of targets) {
      const entry = this.sessions.get(key);
      if (!entry) continue;
      if (entry.inFlight > 0) {
        // In-use sessions are refused on every path: pulling the runtime out
        // from under a running job corrupts results and dangles its tensors.
        report.inUse.push(key);
        continue;
      }
      try {
        if (typeof entry.session.release === 'function') {
          await entry.session.release();
        }
      } catch (error) {
        entry.releaseFailed = true;
        report.failed.push({
          key,
          message: error instanceof Error ? error.message : String(error),
        });
        report.possiblyResidentBytes += entry.estimateBytes;
        continue;
      }
      this.sessions.delete(key);
      report.released.push(key);
    }
    report.remaining = this.sessions.size;
    return report;
  }

  /** Release idle sessions until the cache is at or below capacity. */
  async evictIdleToCapacity(): Promise<SessionReleaseReport> {
    const idleKeys = [...this.sessions.entries()]
      .filter(([, entry]) => entry.inFlight === 0)
      .sort((left, right) => left[1].loadedAt - right[1].loadedAt)
      .map(([key]) => key);
    const overflow = Math.max(0, this.sessions.size - this.maxSessions);
    if (overflow === 0) {
      return {
        released: [],
        failed: [],
        inUse: [],
        possiblyResidentBytes: 0,
        remaining: this.sessions.size,
      };
    }
    return this.release(idleKeys.slice(0, overflow));
  }

  snapshot(): SessionRegistrySnapshot {
    let unresolvedBytes = 0;
    let liveBytes = 0;
    let inUse = 0;
    const unresolvedKeys: string[] = [];
    for (const entry of this.sessions.values()) {
      liveBytes += entry.estimateBytes;
      if (entry.inFlight > 0) inUse += entry.inFlight;
      if (entry.releaseFailed) {
        unresolvedBytes += entry.estimateBytes;
        unresolvedKeys.push(entry.key);
      }
    }
    return {
      cached: this.sessions.size,
      inUse,
      unresolvedKeys,
      unresolvedBytes,
      retainedCapacityBytes: liveBytes,
      highWaterBytes: this.highWaterBytes,
    };
  }

  clear(): void {
    this.sessions.clear();
    this.creations.clear();
    this.highWaterBytes = 0;
  }

  private observeHighWater(): void {
    let live = 0;
    for (const entry of this.sessions.values()) live += entry.estimateBytes;
    this.highWaterBytes = Math.max(this.highWaterBytes, live);
  }
}
