import { describe, expect, it } from 'vitest';
import {
  normalizeGenerativeEdits,
  validateGenerativeEdit,
  type GenerativeEditRecord,
} from './generativeEdit';

function fixture(): GenerativeEditRecord {
  return {
    schemaVersion: 1,
    id: 'gen-1',
    mode: 'fill',
    sourceNodeId: 'image-1',
    sourceAssetId: 'asset-source',
    sourceLocator: 'asset-source',
    sourceRevision: 4,
    placementRevision: 'placement-4',
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
    provider: { kind: 'local', id: 'varve-local', modelId: 'lama-inpainting', runtime: 'patchmatch' },
    variations: [
      { id: 'variation-1', assetId: 'asset-output', width: 640, height: 480, createdAt: 10 },
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
    expect(
      validateGenerativeEdit({ ...fixture(), maskCoordinateSpace: 'document' }),
    ).toContain('source-image-pixels');
  });
});
