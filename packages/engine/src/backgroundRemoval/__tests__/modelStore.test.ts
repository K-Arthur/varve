import { describe, expect, it } from 'vitest';

describe('modelStore', () => {
  it('exports expected functions', async () => {
    const mod = await import('../modelStore');
    expect(typeof mod.saveModelBlob).toBe('function');
    expect(typeof mod.loadModelBlob).toBe('function');
    expect(typeof mod.hasModelBlob).toBe('function');
    expect(typeof mod.deleteModelBlob).toBe('function');
    expect(typeof mod.getModelBlobSize).toBe('function');
    expect(typeof mod.clearAllModelBlobs).toBe('function');
  });

  it('modelStore functions are async', async () => {
    const mod = await import('../modelStore');
    const result = mod.saveModelBlob('test', new Blob(['test']));
    expect(result).toBeInstanceOf(Promise);
  });
});
