/**
 * Fast tests for the pipeline dispatch and request validation.
 * No real ONNX models — all inference paths are mocked or skipped.
 */
import { describe, expect, it } from 'vitest';
import type { ColorizationRequestContract } from './colorizationRequest';
import { dispatchColorization } from './pipelineDispatch';

// ---------------------------------------------------------------------------
// Pipeline dispatch — classical workflows
// ---------------------------------------------------------------------------

describe('dispatchColorization (classical)', () => {
  it('dispatches palette-colorize with valid palette', async () => {
    const sourceData = new ImageData(
      new Uint8ClampedArray([128, 128, 128, 255, 64, 64, 64, 255]),
      2,
      1,
    );

    const request: ColorizationRequestContract = {
      requestId: 'test-palette-1',
      kind: 'palette-colorize',
      source: { nodeId: 'n1', revision: 1, width: 2, height: 1 },
      qualityMode: 'balanced',
      provider: { backend: 'auto', intent: 'full' },
      palette: {
        colors: ['#ff0000', '#00ff00'],
        revision: 1,
        adherence: 0.5,
      },
    };

    const result = await dispatchColorization(request, sourceData);
    expect(result.requestId).toBe('test-palette-1');
    expect(result.imageData.width).toBe(2);
    expect(result.imageData.height).toBe(1);
    expect(result.modelUsed).toBeNull();
    expect(result.provider).toBe('classical');
  });

  it('dispatches selective-recolor with mask', async () => {
    const sourceData = new ImageData(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]), 2, 1);

    const request: ColorizationRequestContract = {
      requestId: 'test-recolor-1',
      kind: 'selective-recolor',
      source: { nodeId: 'n1', revision: 1, width: 2, height: 1 },
      qualityMode: 'balanced',
      provider: { backend: 'auto', intent: 'full' },
      mask: {
        maskId: 'mask-1',
        revision: 1,
        data: new Uint8Array([255, 0]),
        width: 2,
        height: 1,
      },
      params: {
        targetHue: 90,
        saturationScale: 1.2,
        luminancePreservation: 0.8,
      },
    };

    const result = await dispatchColorization(request, sourceData);
    expect(result.requestId).toBe('test-recolor-1');
    expect(result.workflow).toBe('selective-recolor');
    expect(result.imageData.width).toBe(2);
  });

  it('rejects request with validation error', async () => {
    const sourceData = new ImageData(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1);

    const request: ColorizationRequestContract = {
      requestId: '',
      kind: 'selective-recolor',
      source: { nodeId: 'n1', revision: 1, width: 1, height: 1 },
      qualityMode: 'balanced',
      provider: { backend: 'auto', intent: 'full' },
    };

    await expect(dispatchColorization(request, sourceData)).rejects.toThrow('requestId');
  });

  it('rejects palette-colorize with fewer than 2 colors', async () => {
    const sourceData = new ImageData(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1);

    const request: ColorizationRequestContract = {
      requestId: 'test-1',
      kind: 'palette-colorize',
      source: { nodeId: 'n1', revision: 1, width: 1, height: 1 },
      qualityMode: 'balanced',
      provider: { backend: 'auto', intent: 'full' },
      palette: { colors: ['#ff0000'], revision: 1 },
    };

    await expect(dispatchColorization(request, sourceData)).rejects.toThrow('2 palette colors');
  });

  it('rejects cancelled requests', async () => {
    const sourceData = new ImageData(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1);
    const controller = new AbortController();
    controller.abort();

    const request: ColorizationRequestContract = {
      requestId: 'test-cancelled',
      kind: 'palette-colorize',
      source: { nodeId: 'n1', revision: 1, width: 1, height: 1 },
      qualityMode: 'balanced',
      provider: { backend: 'auto', intent: 'full' },
      palette: { colors: ['#ff0000', '#00ff00'], revision: 1 },
      signal: controller.signal,
    };

    await expect(dispatchColorization(request, sourceData)).rejects.toThrow('cancelled');
  });

  it('dispatches reference-transfer with reference data', async () => {
    const sourceData = new ImageData(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1);
    const referenceData = new ImageData(new Uint8ClampedArray([0, 0, 255, 255]), 1, 1);

    const request: ColorizationRequestContract = {
      requestId: 'test-transfer-1',
      kind: 'reference-transfer',
      source: { nodeId: 'n1', revision: 1, width: 1, height: 1 },
      qualityMode: 'balanced',
      provider: { backend: 'auto', intent: 'full' },
      reference: {
        assetId: 'ref-1',
        revision: 1,
        width: 1,
        height: 1,
        src: 'data:image/png;base64,...',
      },
      params: {
        luminancePreservation: 1,
        chromaStrength: 1,
      },
    };

    const result = await dispatchColorization(request, sourceData, referenceData);
    expect(result.requestId).toBe('test-transfer-1');
    expect(result.workflow).toBe('reference-transfer');
    expect(result.modelUsed).toBeNull();
    expect(result.provider).toBe('classical');
  });
});
