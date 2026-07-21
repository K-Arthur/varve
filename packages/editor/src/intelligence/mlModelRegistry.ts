import { getModelLoader } from '@strata/engine';

export type ModelId = 'layout-classifier' | 'component-embedder' | 'color-harmony';

export interface MlModel {
  id: ModelId;
  name: string;
  sizeBytes: number;
  loaded: boolean;
}

interface ModelMeta {
  name: string;
  sizeBytes: number;
  remoteUrl: string;
  bundled: boolean;
  sha256?: string;
}

const MODEL_MANIFEST: Record<ModelId, ModelMeta> = {
  'layout-classifier': {
    name: 'Layout Classifier',
    sizeBytes: 2_500_000,
    remoteUrl: '',
    bundled: false,
  },
  'component-embedder': {
    name: 'Component Embedder',
    sizeBytes: 1_800_000,
    remoteUrl: '',
    bundled: false,
  },
  'color-harmony': {
    name: 'Color Harmony',
    sizeBytes: 700_000,
    remoteUrl: '',
    bundled: false,
  },
};

const loadedModels = new Set<ModelId>();
const sessions = new Map<ModelId, unknown>();

export async function loadModel(modelId: ModelId): Promise<boolean> {
  if (loadedModels.has(modelId)) return true;

  const meta = MODEL_MANIFEST[modelId];
  if (!meta) return false;

  try {
    const loader = getModelLoader();
    const path = await loader.getModelPath(modelId);
    if (!path) return false;

    const ort = await import('onnxruntime-web');
    const session = await ort.InferenceSession.create(path);
    sessions.set(modelId, session);
    loadedModels.add(modelId);
    return true;
  } catch {
    return false;
  }
}

export function isModelAvailable(modelId: ModelId): boolean {
  if (loadedModels.has(modelId)) return true;
  return sessions.has(modelId);
}

export function getSession(modelId: ModelId): unknown {
  return sessions.get(modelId) ?? null;
}

export function getModelInfo(modelId: ModelId): {
  name: string;
  sizeBytes: number;
  loaded: boolean;
} {
  const entry = MODEL_MANIFEST[modelId];
  return {
    name: entry.name,
    sizeBytes: entry.sizeBytes,
    loaded: loadedModels.has(modelId),
  };
}

export function getAllModels(): MlModel[] {
  return (Object.keys(MODEL_MANIFEST) as ModelId[]).map((id) => ({
    id,
    name: MODEL_MANIFEST[id].name,
    sizeBytes: MODEL_MANIFEST[id].sizeBytes,
    loaded: loadedModels.has(id),
  }));
}
