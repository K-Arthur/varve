import { describe, expect, it } from 'vitest';
import { getAllModels, getModelInfo, isModelAvailable, loadModel } from './mlModelRegistry';

describe('mlModelRegistry', () => {
  it('returns false when the model file does not exist', async () => {
    const result = await loadModel('layout-classifier');
    expect(result).toBe(false);
  });

  it('reports model as unavailable when not loaded', () => {
    expect(isModelAvailable('color-harmony')).toBe(false);
  });

  it('returns model info with correct metadata and unloaded state', () => {
    const info = getModelInfo('component-embedder');
    expect(info.name).toBe('Component Embedder');
    expect(info.sizeBytes).toBe(1_800_000);
    expect(info.loaded).toBe(false);
  });

  it('returns all registered models via getAllModels', () => {
    const all = getAllModels();
    expect(all.length).toBe(3);
    const ids = all.map((m) => m.id);
    expect(ids).toContain('layout-classifier');
    expect(ids).toContain('component-embedder');
    expect(ids).toContain('color-harmony');
  });

  it('is deterministic — repeated calls return same info shape', () => {
    const a = getModelInfo('layout-classifier');
    const b = getModelInfo('layout-classifier');
    expect(a).toEqual(b);
  });
});
