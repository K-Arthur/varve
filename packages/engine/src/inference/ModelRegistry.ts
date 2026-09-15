import type { ModelInstallInfo, ModelManifestEntry, ModelState } from './types';

type StateListener = (modelId: string, state: ModelState) => void;

/**
 * Generic model registry — the single source of truth for which models
 * are known, installed, and available.
 *
 * Extracted from bg-removal's `ModelLoader` + `modelManifest.ts` so that
 * future models (layout-classifier, component-embedder, color-harmony)
 * share the same install/lifecycle/state code instead of each registering
 * their own loader.
 */
export class ModelRegistry {
  private readonly manifest: Map<string, ModelManifestEntry> = new Map();
  private readonly state: Map<string, ModelState> = new Map();
  private readonly listeners: Map<string, Set<StateListener>> = new Map();

  constructor(entries: ModelManifestEntry[]) {
    for (const entry of entries) {
      this.manifest.set(entry.id, entry);
      this.state.set(entry.id, 'unavailable');
    }
  }

  /** Register a new model at runtime (e.g., loaded from a dynamic manifest). */
  register(entry: ModelManifestEntry): void {
    this.manifest.set(entry.id, entry);
    if (!this.state.has(entry.id)) {
      this.state.set(entry.id, 'unavailable');
    }
  }

  /** Get a manifest entry by model ID. */
  getEntry(modelId: string): ModelManifestEntry | undefined {
    return this.manifest.get(modelId);
  }

  /** List all registered models. */
  listEntries(): ModelManifestEntry[] {
    return Array.from(this.manifest.values());
  }

  /** Get the current state of a model. */
  getState(modelId: string): ModelState {
    return this.state.get(modelId) ?? 'unavailable';
  }

  /** Update state and notify listeners. */
  setState(modelId: string, newState: ModelState): void {
    const prev = this.state.get(modelId);
    if (prev === newState) return;
    this.state.set(modelId, newState);
    const listeners = this.listeners.get(modelId);
    if (listeners) {
      for (const fn of listeners) {
        fn(modelId, newState);
      }
    }
  }

  /** Check if a model is ready for inference. */
  isReady(modelId: string): boolean {
    return this.getState(modelId) === 'ready';
  }

  /** Check if a model is registered at all. */
  knows(modelId: string): boolean {
    return this.manifest.has(modelId);
  }

  /** Subscribe to state changes for a specific model. */
  subscribe(modelId: string, fn: StateListener): () => void {
    let set = this.listeners.get(modelId);
    if (!set) {
      set = new Set();
      this.listeners.set(modelId, set);
    }
    set.add(fn);
    return () => {
      set!.delete(fn);
      if (set!.size === 0) {
        this.listeners.delete(modelId);
      }
    };
  }

  /** Get install info for all models. */
  listInstallInfo(): ModelInstallInfo[] {
    return this.listEntries().map((entry) => ({
      id: entry.id,
      name: entry.name,
      sizeBytes: entry.sizeBytes,
      installed: this.isReady(entry.id),
      source: this.getState(entry.id) === 'ready' ? 'downloaded' : 'none',
      state: this.getState(entry.id),
    }));
  }

  /** Reset all states (for testing). */
  reset(): void {
    this.state.clear();
    this.listeners.clear();
    for (const id of this.manifest.keys()) {
      this.state.set(id, 'unavailable');
    }
  }
}
