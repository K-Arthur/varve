export type ModelId = 'layout-classifier' | 'component-embedder' | 'color-harmony';

export interface MlModel {
  id: ModelId;
  name: string;
  sizeBytes: number;
  loaded: boolean;
}

const MODEL_MANIFEST: Record<ModelId, { name: string; sizeBytes: number }> = {
  'layout-classifier': { name: 'Layout Classifier', sizeBytes: 2_500_000 },
  'component-embedder': { name: 'Component Embedder', sizeBytes: 1_800_000 },
  'color-harmony': { name: 'Color Harmony', sizeBytes: 700_000 },
};

const loadedModels = new Set<ModelId>();

export async function loadModel(modelId: ModelId): Promise<boolean> {
  loadedModels.add(modelId);
  return true;
}

export function isModelAvailable(modelId: ModelId): boolean {
  return loadedModels.has(modelId);
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
