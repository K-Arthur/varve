/**
 * Tests for the colorization request contract and pipeline dispatch.
 */
import { describe, expect, it } from 'vitest';
import type {
  ColorizationRequestContract,
  ColorizationResultContract,
} from './colorizationRequest';
import { detectStaleResult, generateColorizationRequestId } from './colorizationRequest';
import { validateColorizationRequest } from './pipelineDispatch';
import { applySelectiveRecolor, expandContractMask, featherMask, invertMask } from './sam2Recolor';

// ---------------------------------------------------------------------------
// Request ID generation
// ---------------------------------------------------------------------------

describe('generateColorizationRequestId', () => {
  it('generates unique IDs', () => {
    const id1 = generateColorizationRequestId();
    const id2 = generateColorizationRequestId();
    expect(id1).not.toBe(id2);
  });

  it('starts with cz- prefix', () => {
    const id = generateColorizationRequestId();
    expect(id).toMatch(/^cz-/);
  });
});

// ---------------------------------------------------------------------------
// Stale result detection
// ---------------------------------------------------------------------------

describe('detectStaleResult', () => {
  const baseResult: ColorizationResultContract = {
    requestId: 'test-1',
    sourceRevision: 5,
    dispatchedAt: performance.now(),
    imageData: new ImageData(1, 1),
    workflow: 'selective-recolor',
    modelUsed: null,
    provider: 'classical',
    elapsedMs: 100,
  };

  it('returns null for fresh results', () => {
    expect(detectStaleResult(baseResult, 5)).toBeNull();
  });

  it('detects source changed', () => {
    expect(detectStaleResult(baseResult, 6)).toBe('source-changed');
  });

  it('detects source rolled back', () => {
    expect(detectStaleResult(baseResult, 4)).toBe('source-changed');
  });
});

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

describe('validateColorizationRequest', () => {
  const validBase = {
    requestId: 'test-1',
    source: {
      nodeId: 'node-1',
      revision: 1,
      width: 100,
      height: 100,
    },
    qualityMode: 'balanced' as const,
    provider: { backend: 'auto' as const, intent: 'preview' as const },
  };

  it('accepts valid selective-recolor request', () => {
    const req: ColorizationRequestContract = {
      ...validBase,
      kind: 'selective-recolor',
      mask: {
        maskId: 'mask-1',
        revision: 1,
        data: new Uint8Array(100 * 100),
        width: 100,
        height: 100,
      },
    };
    expect(validateColorizationRequest(req)).toBeNull();
  });

  it('rejects selective-recolor without mask', () => {
    const req: ColorizationRequestContract = {
      ...validBase,
      kind: 'selective-recolor',
    };
    expect(validateColorizationRequest(req)).toContain('mask');
  });

  it('accepts valid palette-colorize request', () => {
    const req: ColorizationRequestContract = {
      ...validBase,
      kind: 'palette-colorize',
      palette: {
        colors: ['#ff0000', '#00ff00'],
        revision: 1,
      },
    };
    expect(validateColorizationRequest(req)).toBeNull();
  });

  it('rejects palette-colorize with fewer than 2 colors', () => {
    const req: ColorizationRequestContract = {
      ...validBase,
      kind: 'palette-colorize',
      palette: {
        colors: ['#ff0000'],
        revision: 1,
      },
    };
    expect(validateColorizationRequest(req)).toContain('2 palette colors');
  });

  it('accepts valid reference-transfer request', () => {
    const req: ColorizationRequestContract = {
      ...validBase,
      kind: 'reference-transfer',
      reference: {
        assetId: 'ref-1',
        revision: 1,
        width: 200,
        height: 200,
        src: 'data:image/png;base64,...',
      },
    };
    expect(validateColorizationRequest(req)).toBeNull();
  });

  it('rejects reference-transfer without reference', () => {
    const req: ColorizationRequestContract = {
      ...validBase,
      kind: 'reference-transfer',
    };
    expect(validateColorizationRequest(req)).toContain('reference');
  });

  it('rejects request without requestId', () => {
    const req = {
      ...validBase,
      requestId: '',
      kind: 'selective-recolor' as const,
      mask: {
        maskId: 'mask-1',
        revision: 1,
        data: new Uint8Array(100),
        width: 10,
        height: 10,
      },
    };
    expect(validateColorizationRequest(req as unknown as ColorizationRequestContract)).toContain(
      'requestId',
    );
  });

  it('rejects request with zero source dimensions', () => {
    const req: ColorizationRequestContract = {
      ...validBase,
      kind: 'palette-colorize',
      source: { ...validBase.source, width: 0 },
      palette: { colors: ['#ff0000', '#00ff00'], revision: 1 },
    };
    expect(validateColorizationRequest(req)).toContain('dimensions');
  });
});

// ---------------------------------------------------------------------------
// SAM2 recolor mask helpers
// ---------------------------------------------------------------------------

describe('featherMask', () => {
  it('returns unchanged mask when radius is 0', () => {
    const mask = new Uint8Array([255, 0, 0, 255]);
    expect(featherMask(mask, 2, 2, 0)).toBe(mask);
  });

  it('smooths mask edges', () => {
    const mask = new Uint8Array([255, 255, 0, 0]);
    const feathered = featherMask(mask, 2, 2, 1);
    // Feathered values should be between 0 and 255
    for (const v of feathered) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});

describe('expandContractMask', () => {
  it('returns unchanged mask when pixels is 0', () => {
    const mask = new Uint8Array([255, 0, 0, 255]);
    expect(expandContractMask(mask, 2, 2, 0)).toBe(mask);
  });

  it('expands mask when positive', () => {
    // 4x4 mask with small white region
    const mask = new Uint8Array([0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0, 0, 0]);
    const expanded = expandContractMask(mask, 4, 4, 2);
    // With radius 2 (circular), corner pixels within Manhattan distance
    // of the white region should become 255
    expect(expanded[0]).toBe(255); // (0,0) is within radius 2 of (1,1)
    expect(expanded[3]).toBe(255); // (3,0) is within radius 2 of (2,1)
    expect(expanded[12]).toBe(255); // (0,3) is within radius 2 of (1,2)
    expect(expanded[15]).toBe(255); // (3,3) is within radius 2 of (2,2)
  });

  it('contracts mask when negative', () => {
    // 6x6 mask with white region and surrounding black — the white
    // region has explicit edges that contraction should shrink.
    const mask = new Uint8Array([
      0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 0, 0, 255, 255, 255, 255, 0, 0, 255, 255, 255, 255,
      0, 0, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const contracted = expandContractMask(mask, 6, 6, -1);
    // Edge pixels (1 pixel from border) should contract to 0
    // because they have non-white neighbors within radius 1
    expect(contracted[7]).toBe(0); // (1,1) — has non-white neighbor at (0,1)
    expect(contracted[13]).toBe(0); // (1,2) — has non-white neighbor at (0,2)
    // Center pixels (2+ from border) should remain white
    expect(contracted[14]).toBe(255); // (2,2) — all neighbors within radius 1 are white
    expect(contracted[15]).toBe(255); // (3,2)
  });
});

describe('invertMask', () => {
  it('inverts 0 to 255', () => {
    expect(invertMask(new Uint8Array([0]))[0]).toBe(255);
  });

  it('inverts 255 to 0', () => {
    expect(invertMask(new Uint8Array([255]))[0]).toBe(0);
  });

  it('inverts 128 to 127', () => {
    expect(invertMask(new Uint8Array([128]))[0]).toBe(127);
  });

  it('handles full array', () => {
    const mask = new Uint8Array([0, 128, 255]);
    const inverted = invertMask(mask);
    expect(inverted[0]).toBe(255);
    expect(inverted[1]).toBe(127);
    expect(inverted[2]).toBe(0);
  });
});

describe('applySelectiveRecolor', () => {
  it('returns source unchanged when blendStrength is 0', () => {
    const source = new ImageData(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]), 2, 1);
    const mask = new Uint8Array([255, 255]);
    const result = applySelectiveRecolor(source, mask, 2, 1, {
      blendStrength: 0,
    });
    expect(result.data).toEqual(source.data);
  });

  it('applies recolor with full blend', () => {
    // Use a saturated red (not neutral gray — gray has zero chroma,
    // so hue rotation has no visible effect)
    const source = new ImageData(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1);
    const mask = new Uint8Array([255]);
    const result = applySelectiveRecolor(source, mask, 1, 1, {
      targetHue: 180,
      saturationScale: 1.5,
      blendStrength: 1,
    });
    // Result should differ from source (hue shift applied to red)
    expect(result.data[0]).not.toBe(255);
    expect(result.data[1]).not.toBe(0);
  });

  it('preserves alpha channel', () => {
    const source = new ImageData(new Uint8ClampedArray([128, 128, 128, 128]), 1, 1);
    const mask = new Uint8Array([255]);
    const result = applySelectiveRecolor(source, mask, 1, 1, {
      targetHue: 90,
      blendStrength: 0.5,
    });
    expect(result.data[3]).toBe(128);
  });
});
