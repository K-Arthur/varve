/**
 * Intelligence ML model registry — wires the three strategic models
 * (layout-classifier, component-embedder, color-harmony) through the
 * generic inference core in @strata/engine.
 *
 * A new model = a manifest entry + optional pre/post-processor only.
 */
import { ModelRegistry, SessionManager } from '@strata/engine';
import type { ModelManifestEntry } from '@strata/engine';

const MANIFEST: ModelManifestEntry[] = [
  {
    id: 'layout-classifier',
    name: 'Layout Classifier',
    description: 'Classifies frame layouts into semantic categories (nav, hero, card-grid, etc.)',
    sizeBytes: 2_500_000,
    remoteUrl: '',
    checksum: '',
    bundled: false,
    inputSpec: null,
    quality: 1,
  },
  {
    id: 'component-embedder',
    name: 'Component Embedder',
    description: 'Generates embeddings for component similarity matching',
    sizeBytes: 1_800_000,
    remoteUrl: '',
    checksum: '',
    bundled: false,
    inputSpec: null,
    quality: 1,
  },
  {
    id: 'color-harmony',
    name: 'Color Harmony',
    description: 'Suggests harmonious color palettes from a seed color',
    sizeBytes: 700_000,
    remoteUrl: '',
    checksum: '',
    bundled: false,
    inputSpec: null,
    quality: 1,
  },
];

export const registry = new ModelRegistry(MANIFEST);

export { ModelRegistry, SessionManager };
export type { ModelManifestEntry };

const sessionManager = new SessionManager(3);

export async function loadModel(modelId: string): Promise<boolean> {
  if (registry.isReady(modelId)) return true;
  if (!registry.knows(modelId)) return false;

  registry.setState(modelId, 'downloading');
  try {
    const { getModelLoader } = await import('@strata/engine');
    const loader = getModelLoader();
    const path = await loader.getModelPath(modelId);
    if (!path) {
      registry.setState(modelId, 'error');
      return false;
    }

    await sessionManager.createSession(path, modelId);
    registry.setState(modelId, 'ready');
    return true;
  } catch {
    registry.setState(modelId, 'error');
    return false;
  }
}

export function isModelAvailable(modelId: string): boolean {
  return registry.isReady(modelId);
}

export function getSession(modelId: string): unknown {
  if (!registry.isReady(modelId)) return null;
  return sessionManager;
}

export function getModelInfo(modelId: string): {
  name: string;
  sizeBytes: number;
  loaded: boolean;
} {
  const entry = registry.getEntry(modelId);
  return {
    name: entry?.name ?? 'Unknown',
    sizeBytes: entry?.sizeBytes ?? 0,
    loaded: registry.isReady(modelId),
  };
}

export function getAllModels(): Array<{
  id: string;
  name: string;
  sizeBytes: number;
  loaded: boolean;
}> {
  return registry.listInstallInfo().map((info) => ({
    id: info.id,
    name: info.name,
    sizeBytes: info.sizeBytes,
    loaded: info.installed,
  }));
}

export type ModelId = 'layout-classifier' | 'component-embedder' | 'color-harmony';
