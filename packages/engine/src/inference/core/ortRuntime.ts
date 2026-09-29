export type OrtRuntimeEntrypoint = 'wasm' | 'webgpu';

export interface LoadedOrtRuntime<T> {
  readonly runtime: T;
  readonly entrypoint: OrtRuntimeEntrypoint;
  readonly providers: readonly string[];
}

export interface OrtRuntimeLoaders<T> {
  readonly loadWasm: () => Promise<T>;
  readonly loadWebGpu: () => Promise<T>;
  readonly configure: (runtime: T) => void | Promise<void>;
}

/** A single runtime module per worker, with provider-aware entrypoint selection. */
export function createOrtRuntimeLoader<T>(loaders: OrtRuntimeLoaders<T>) {
  let loaded: Promise<LoadedOrtRuntime<T>> | null = null;
  let selectedWebGpu = false;

  return {
    load(preferredProviders: readonly string[]): Promise<LoadedOrtRuntime<T>> {
      const wantsWebGpu = preferredProviders.includes('webgpu');
      if (loaded) {
        if (wantsWebGpu && !selectedWebGpu) {
          return Promise.reject(
            new Error('ONNX Runtime WASM entrypoint is already initialized in this worker.'),
          );
        }
        return loaded;
      }

      selectedWebGpu = wantsWebGpu;
      const initialization = (async (): Promise<LoadedOrtRuntime<T>> => {
        let runtime: T;
        let entrypoint: OrtRuntimeEntrypoint;
        let providers = [...preferredProviders];
        if (wantsWebGpu) {
          try {
            runtime = await loaders.loadWebGpu();
            entrypoint = 'webgpu';
          } catch (webGpuError) {
            if (!providers.includes('wasm')) throw webGpuError;
            runtime = await loaders.loadWasm();
            entrypoint = 'wasm';
            providers = providers.filter((provider) => provider === 'wasm');
          }
        } else {
          runtime = await loaders.loadWasm();
          entrypoint = 'wasm';
          providers = providers.filter((provider) => provider === 'wasm');
        }
        await loaders.configure(runtime);
        return { runtime, entrypoint, providers };
      })();
      loaded = initialization;
      void initialization.catch(() => {
        if (loaded === initialization) {
          loaded = null;
          selectedWebGpu = false;
        }
      });
      return initialization;
    },
    reset(): void {
      loaded = null;
      selectedWebGpu = false;
    },
  };
}
