import { describe, expect, it, vi } from 'vitest';
import { resolveWebModel } from '../modelSelection';

describe('resolveWebModel', () => {
  it('uses bundled U2-Net Light when enhanced Balanced is not installed', async () => {
    const loader = {
      hasDownloadedBlob: vi.fn().mockResolvedValue(false),
      getModelPath: vi.fn(async (id: string) => `/models/${id}.onnx`),
    };
    await expect(resolveWebModel('ai-balanced', loader)).resolves.toEqual({
      modelId: 'u2netp',
      modelPath: '/models/u2netp.onnx',
    });
  });

  it('prefers explicitly installed IS-Net for Balanced', async () => {
    const loader = {
      hasDownloadedBlob: vi.fn().mockResolvedValue(true),
      getModelPath: vi.fn(async (id: string) => `blob:${id}`),
    };
    await expect(resolveWebModel('ai-balanced', loader)).resolves.toEqual({
      modelId: 'isnet-general-use',
      modelPath: 'blob:isnet-general-use',
    });
  });
});
