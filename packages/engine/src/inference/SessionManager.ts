/**
 * Generic ONNX Runtime session manager with caching, lifecycle, and
 * memory-safety preflight gating.
 *
 * Extracted from the session-creation logic in `worker.ts` and
 * `directOnnxProvider.ts` so that any model — not just bg-removal —
 * reuses the same session-caching and provider-selection code.
 */
/** Lightweight abstraction over a loaded ONNX session. */
export interface ManagedSession {
  modelId: string;
  session: unknown;
  executionProvider: string;
  loadedAt: number;
}

type OrtInferenceSession = {
  run: (feeds: Record<string, unknown>) => Promise<Record<string, unknown>>;
  release: () => Promise<void>;
  inputNames: readonly string[];
  outputNames: readonly string[];
};

type OrtModule = {
  InferenceSession: {
    create: (
      path: string,
      opts?: { executionProviders?: string[] },
    ) => Promise<OrtInferenceSession>;
  };
  Tensor: new (type: string, data: ArrayLike<number>, dims: number[]) => unknown;
};

/**
 * Manages ONNX Runtime session lifecycle.
 *
 * Handles:
 * - Lazy loading of onnxruntime-web
 * - Provider-order resolution via environment capabilities
 * - Session caching (reuse across inference calls for same model)
 * - Release on cache eviction or explicit dispose
 * - WASM memory-safety preflight before creating WASM-only sessions
 */
export class SessionManager {
  private sessions = new Map<string, ManagedSession>();
  private ortModule: OrtModule | null = null;
  private ortPromise: Promise<OrtModule> | null = null;
  private maxSessions: number;

  /** Default: one session per model, for up to 3 distinct models. */
  constructor(maxSessions = 3) {
    this.maxSessions = maxSessions;
  }

  /** Lazily import and cache the ONNX Runtime Web module. */
  private async getOrt(): Promise<OrtModule> {
    if (this.ortModule) return this.ortModule;
    if (this.ortPromise) return this.ortPromise;
    this.ortPromise = this.loadOrt();
    return this.ortPromise;
  }

  private async loadOrt(): Promise<OrtModule> {
    const ort = (await import('onnxruntime-web')) as unknown as OrtModule;
    this.ortModule = ort;
    return ort;
  }

  /** Resolve the preferred ONNX execution providers for the environment. */
  private async getProviders(): Promise<string[]> {
    try {
      const { getBestOnnxProviders } = await import('../backgroundRemoval/environmentCapabilities');
      return await getBestOnnxProviders();
    } catch {
      return ['wasm'];
    }
  }

  /**
   * Create a new session for the given model path.
   * Tries accelerated providers first; gates bare WASM behind memory-safety check.
   */
  async createSession(
    modelPath: string,
    modelId: string,
  ): Promise<{ session: OrtInferenceSession; executionProvider: string }> {
    const ort = await this.getOrt();
    const providers = await this.getProviders();

    let lastError: Error | null = null;
    for (const provider of providers) {
      if (provider === 'wasm') continue;
      try {
        const session = await ort.InferenceSession.create(modelPath, {
          executionProviders: [provider],
        });
        return { session, executionProvider: provider };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    const { isWasmModelSafe } = await import('../backgroundRemoval/environmentCapabilities');
    if (!(await isWasmModelSafe(modelId))) {
      throw new Error(
        `This model exceeds the safe WASM memory limit in this environment (no GPU acceleration available). ${
          lastError ? `Accelerated backend also failed: ${lastError.message}` : ''
        }`.trim(),
      );
    }

    const session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['wasm'],
    });
    return { session, executionProvider: 'wasm' };
  }

  /** Get or create a cached session for the given model path. */
  async getSession(modelPath: string, modelId: string): Promise<ManagedSession> {
    const cached = this.sessions.get(modelPath);
    if (cached) return cached;

    // Evict oldest if at capacity
    if (this.sessions.size >= this.maxSessions) {
      const oldest = this.sessions.entries().next().value;
      if (oldest) {
        await this.release(oldest[0]);
      }
    }

    const { session, executionProvider } = await this.createSession(modelPath, modelId);
    const managed: ManagedSession = {
      modelId,
      session,
      executionProvider,
      loadedAt: Date.now(),
    };
    this.sessions.set(modelPath, managed);
    return managed;
  }

  /** Release a cached session. */
  async release(modelPath: string): Promise<void> {
    const managed = this.sessions.get(modelPath);
    if (!managed) return;
    this.sessions.delete(modelPath);
    try {
      const s = managed.session as OrtInferenceSession;
      if (typeof s.release === 'function') {
        await s.release();
      }
    } catch {
      // best-effort release
    }
  }

  /** Release all cached sessions. */
  async releaseAll(): Promise<void> {
    const paths = Array.from(this.sessions.keys());
    await Promise.all(paths.map((p) => this.release(p)));
  }

  /** Number of currently cached sessions. */
  get size(): number {
    return this.sessions.size;
  }

  /** Check if a model's session is cached. */
  hasSession(modelPath: string): boolean {
    return this.sessions.has(modelPath);
  }

  /** Check whether onnxruntime-web is available in this environment. */
  async isRuntimeAvailable(): Promise<boolean> {
    try {
      await this.getOrt();
      return true;
    } catch {
      return false;
    }
  }
}
