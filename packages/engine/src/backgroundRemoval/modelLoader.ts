import { deleteModelBlob, saveModelBlob } from './modelStore';
import type { ModelState } from './types';
import { AVAILABLE_MODELS } from './types';

const STATE_KEY = 'strata-bg-model-state';

type StateListener = (state: ModelState, modelId: string) => void;

function isBrowserEnv(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

class ModelLoader {
  private state: ModelState = 'unavailable';
  private currentModelId = '';
  private listeners: StateListener[] = [];

  private loadState() {
    try {
      const stored = localStorage.getItem(STATE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.state = parsed.state as ModelState;
        this.currentModelId = parsed.modelId ?? '';
      }
    } catch {
      // ignore
    }
  }

  private saveState() {
    try {
      localStorage.setItem(
        STATE_KEY,
        JSON.stringify({ state: this.state, modelId: this.currentModelId }),
      );
    } catch {
      // ignore
    }
  }

  constructor() {
    this.loadState();
  }

  getState(): ModelState {
    return this.state;
  }

  getCurrentModelId(): string {
    return this.currentModelId;
  }

  subscribe(fn: StateListener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private notify() {
    for (const fn of this.listeners) {
      fn(this.state, this.currentModelId);
    }
  }

  async getModelPath(modelId: string): Promise<string | null> {
    if (this.state !== 'ready' || this.currentModelId !== modelId) {
      return null;
    }
    return `/${modelId}.onnx`;
  }

  async downloadModel(
    modelId: string,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    const model = AVAILABLE_MODELS.find((m) => m.id === modelId);
    if (!model) {
      throw new Error(`Unknown model: ${modelId}`);
    }

    this.state = 'downloading';
    this.currentModelId = modelId;
    this.notify();
    this.saveState();

    try {
      const response = await fetch(model.remoteUrl);

      if (!response.ok) {
        throw new Error(`Failed to download model: ${response.statusText}`);
      }

      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : model.size;
      let loaded = 0;

      const reader = response.body!.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        onProgress?.(loaded, total);
      }

      const blob = new Blob(chunks as unknown as BlobPart[], { type: 'application/octet-stream' });

      if (isBrowserEnv()) {
        await saveModelBlob(modelId, blob);
      } else {
        try {
          localStorage.setItem(`strata-model-${modelId}`, await blob.text());
        } catch {
          throw new Error(
            'Could not store model. Try clearing browser storage or use the desktop version.',
          );
        }
      }

      this.state = 'ready';
      this.notify();
      this.saveState();
    } catch (error) {
      this.state = 'error';
      this.currentModelId = '';
      this.notify();
      this.saveState();
      throw error;
    }
  }

  isModelDownloaded(modelId: string): boolean {
    return this.state === 'ready' && this.currentModelId === modelId;
  }

  async clearModel() {
    if (this.currentModelId) {
      try {
        if (isBrowserEnv()) {
          await deleteModelBlob(this.currentModelId);
        } else {
          localStorage.removeItem(`strata-model-${this.currentModelId}`);
        }
      } catch {
        // ignore
      }
    }
    this.state = 'unavailable';
    this.currentModelId = '';
    this.saveState();
    this.notify();
  }
}

let instance: ModelLoader | null = null;

export function getModelLoader(): ModelLoader {
  if (!instance) {
    instance = new ModelLoader();
  }
  return instance;
}

export function resetModelLoader(): void {
  instance = null;
}
