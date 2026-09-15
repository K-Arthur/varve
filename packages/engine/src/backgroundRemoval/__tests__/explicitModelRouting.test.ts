import { describe, expect, it, vi } from 'vitest';
import { nativeModelIdForOptions, resolveWebModelForOptions } from '../modelSelection';

/**
 * An explicit model request is a contract. These tests pin the no-substitution
 * behaviour that keeps "Fast (U²-NetP)" from silently becoming an installed
 * IS-Net run (or vice versa) in the automatic subject-estimate routing.
 */
describe('explicit model routing', () => {
  it('resolves the requested model and never substitutes the method default', async () => {
    const loader = {
      hasDownloadedBlob: vi.fn().mockResolvedValue(true),
      getModelPath: vi.fn(async (id: string) => `blob:${id}`),
    };

    await expect(
      resolveWebModelForOptions({ method: 'ai-balanced', modelId: 'u2netp' }, loader),
    ).resolves.toMatchObject({
      modelId: 'u2netp',
      modelPath: 'blob:u2netp',
      selectionReason: expect.stringContaining('Explicit model request'),
    });
    // IS-Net is installed (preferred for ai-balanced), but the explicit
    // u2netp request must not be upgraded to it.
    expect(loader.getModelPath).toHaveBeenCalledWith('u2netp', undefined);
  });

  it('returns null when the requested model is unreachable instead of falling back', async () => {
    const loader = {
      hasDownloadedBlob: vi.fn().mockResolvedValue(true),
      getModelPath: vi.fn(async (id: string) => (id === 'isnet-general-use' ? 'blob:isnet' : null)),
    };
    await expect(
      resolveWebModelForOptions({ method: 'ai-balanced', modelId: 'u2netp' }, loader),
    ).resolves.toBeNull();
  });

  it('keeps the installed-preferred behaviour when no model is requested', async () => {
    const loader = {
      hasDownloadedBlob: vi.fn().mockResolvedValue(true),
      getModelPath: vi.fn(async (id: string) => `blob:${id}`),
    };
    await expect(
      resolveWebModelForOptions({ method: 'ai-balanced' }, loader),
    ).resolves.toMatchObject({ modelId: 'isnet-general-use' });
  });
});

describe('native model routing', () => {
  it('declines native execution when the requested model is not the native model', () => {
    expect(nativeModelIdForOptions({ method: 'ai-balanced', modelId: 'u2netp' })).toBeNull();
    expect(
      nativeModelIdForOptions({ method: 'ai-balanced', modelId: 'birefnet-general-lite' }),
    ).toBeNull();
  });

  it('accepts the request when it matches the native model for the method', () => {
    expect(nativeModelIdForOptions({ method: 'ai-balanced' })).toBe('isnet-general-use');
    expect(nativeModelIdForOptions({ method: 'ai-balanced', modelId: 'isnet-general-use' })).toBe(
      'isnet-general-use',
    );
    expect(nativeModelIdForOptions({ method: 'ai-quality' })).toBe('birefnet-general-lite');
    expect(
      nativeModelIdForOptions({ method: 'ai-quality', modelId: 'birefnet-general-lite' }),
    ).toBe('birefnet-general-lite');
  });
});
