import { describe, expect, it } from 'vitest';
import { getAllModels, getModelInfo, isModelAvailable, loadModel } from './mlModelRegistry';

describe('mlModelRegistry', () => {
  it('loads a model and resolves to true', async () => {
    const result = await loadModel('layout-classifier');
    expect(result).toBe(true);
  });

  it('marks model as available after loading', async () => {
    expect(isModelAvailable('color-harmony')).toBe(false);
    await loadModel('color-harmony');
    expect(isModelAvailable('color-harmony')).toBe(true);
  });

  it('returns model info with correct metadata and loaded state', async () => {
    const before = getModelInfo('component-embedder');
    expect(before.name).toBe('Component Embedder');
    expect(before.sizeBytes).toBe(1_800_000);
    expect(before.loaded).toBe(false);

    await loadModel('component-embedder');
    const after = getModelInfo('component-embedder');
    expect(after.loaded).toBe(true);
  });

  it('returns all registered models via getAllModels', () => {
    const all = getAllModels();
    expect(all.length).toBe(3);
    const ids = all.map((m) => m.id);
    expect(ids).toContain('layout-classifier');
    expect(ids).toContain('component-embedder');
    expect(ids).toContain('color-harmony');
  });

  it('handles double load idempotently', async () => {
    await loadModel('color-harmony');
    await loadModel('color-harmony');
    expect(isModelAvailable('color-harmony')).toBe(true);
  });

  it('is deterministic — repeated calls return same info shape', () => {
    const a = getModelInfo('layout-classifier');
    const b = getModelInfo('layout-classifier');
    expect(a).toEqual(b);
  });
});
