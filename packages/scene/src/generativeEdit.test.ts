import { describe, expect, it } from 'vitest';
import {
  type GenerativeEditRecord,
  normalizeGenerativeEdits,
  validateGenerativeEdit,
} from './generativeEdit';

function fixture(): GenerativeEditRecord {
  return {
    schemaVersion: 2,
    id: 'gen-1',
    mode: 'fill',
    sourceNodeId: 'image-1',
    sourceAssetId: 'asset-source',
    sourceLocator: 'asset-source',
    sourceRevision: 4,
    placementRevision: 'placement-4',
    masks: {
      userMaskAssetId: 'mask-1',
      inferenceMaskAssetId: 'mask-inference-1',
      compositeMaskAssetId: 'mask-composite-1',
      width: 640,
      height: 480,
      offsetX: 0,
      offsetY: 0,
      coordinateSpace: 'source-image-pixels',
    },
    outputFrame: {
      x: 0,
      y: 0,
      width: 640,
      height: 480,
      sourceWidth: 640,
      sourceHeight: 480,
      coordinateSpace: 'source-image-pixels',
    },
    maskAssetId: 'mask-1',
    maskWidth: 640,
    maskHeight: 480,
    maskCoordinateSpace: 'source-image-pixels',
    settings: {
      quality: 'balanced',
      contextPadding: 32,
      maskExpansion: 4,
      feather: 2,
      seed: 7,
      prompt: 'a red ceramic mug',
    },
    provider: {
      kind: 'local',
      id: 'varve-local',
      modelId: 'lama-inpainting',
      runtime: 'patchmatch',
    },
    variations: [
      {
        id: 'variation-1',
        assetId: 'asset-output',
        width: 640,
        height: 480,
        createdAt: 10,
        seed: 7,
        settings: {
          quality: 'balanced',
          contextPadding: 32,
          maskExpansion: 4,
          feather: 2,
          seed: 7,
          prompt: 'a red ceramic mug',
        },
        outputFrame: {
          x: 0,
          y: 0,
          width: 640,
          height: 480,
          sourceWidth: 640,
          sourceHeight: 480,
          coordinateSpace: 'source-image-pixels',
        },
      },
    ],
    activeVariationId: 'variation-1',
    acceptedVariationId: 'variation-1',
    createdAt: 10,
    updatedAt: 11,
  };
}

describe('generative edit document contract', () => {
  it('accepts a complete source-pixel edit record', () => {
    expect(validateGenerativeEdit(fixture())).toBeNull();
  });

  it('rejects an active variation that is not persisted', () => {
    expect(validateGenerativeEdit({ ...fixture(), activeVariationId: 'missing' })).toContain(
      'active variation',
    );
  });

  it('normalizes malformed records without blocking document load', () => {
    const result = normalizeGenerativeEdits({ good: fixture(), bad: { schemaVersion: 1 } });
    expect(result).toEqual({ good: fixture() });
  });

  it('requires image-space mask polarity to be explicit', () => {
    expect(validateGenerativeEdit({ ...fixture(), maskCoordinateSpace: 'document' })).toContain(
      'source-image-pixels',
    );
  });

  it('accepts signed mask refinement and rejects values outside the editor range', () => {
    const shrink = fixture();
    shrink.settings.maskExpansion = -64;
    shrink.variations[0]!.settings!.maskExpansion = -64;
    expect(validateGenerativeEdit(shrink)).toBeNull();

    const invalid = fixture();
    invalid.settings.maskExpansion = -65;
    expect(validateGenerativeEdit(invalid)).toContain('settings');
  });
});
