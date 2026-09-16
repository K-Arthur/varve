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
      userWidth: 640,
      userHeight: 480,
      userBounds: { x: 120, y: 80, width: 160, height: 140 },
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
      imageGuidanceScale: 1,
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
        thumbnailAssetId: 'asset-output-thumbnail',
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
          imageGuidanceScale: 1,
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

  it('retains and validates the model input-frame provenance', () => {
    const base = fixture();
    const withFrame = {
      ...base,
      provider: {
        ...base.provider,
        modelId: 'sd15-inpainting-q4_0-v1',
        inputFrame: {
          contractId: 'sd15-inpainting-512-square-v1',
          preprocessingVersion: 'varve-diffusion-letterbox-linear-srgb-v1',
          inputKind: 'masked-inpainting',
          maskConvention: 'white-edit-black-preserve',
          maskInput: 'image-and-mask',
          width: 512,
          height: 512,
          sourceWidth: 512,
          sourceHeight: 341,
          contentX: 0,
          contentY: 85,
          contentWidth: 512,
          contentHeight: 341,
        },
      },
    };
    expect(validateGenerativeEdit(withFrame)).toBeNull();
    expect(
      validateGenerativeEdit({
        ...withFrame,
        provider: {
          ...withFrame.provider,
          inputFrame: { ...withFrame.provider.inputFrame, width: 0 },
        },
      }),
    ).toContain('provider');
  });

  it('rejects incomplete or reference-only model-frame semantics', () => {
    const base = fixture();
    const inputFrame = {
      contractId: 'sd15-inpainting-512-square-v1',
      preprocessingVersion: 'varve-diffusion-letterbox-linear-srgb-v1',
      inputKind: 'masked-inpainting' as const,
      maskConvention: 'white-edit-black-preserve' as const,
      maskInput: 'image-and-mask' as const,
      width: 512,
      height: 512,
    };
    expect(
      validateGenerativeEdit({
        ...base,
        provider: { ...base.provider, inputFrame: { ...inputFrame, maskConvention: undefined } },
      }),
    ).toContain('provider');
    expect(
      validateGenerativeEdit({
        ...base,
        provider: { ...base.provider, inputFrame: { ...inputFrame, inputKind: 'reference-edit' } },
      }),
    ).toContain('provider');
    expect(
      validateGenerativeEdit({
        ...base,
        provider: {
          ...base.provider,
          inputFrame: {
            ...inputFrame,
            inputKind: 'reference-edit',
            maskInput: 'none',
          },
        },
      }),
    ).toBeNull();
  });

  it('rejects an input-frame content rectangle that falls outside the model frame', () => {
    const base = fixture();
    expect(
      validateGenerativeEdit({
        ...base,
        provider: {
          ...base.provider,
          inputFrame: {
            contractId: 'sd15-inpainting-512-square-v1',
            preprocessingVersion: 'varve-diffusion-letterbox-linear-srgb-v1',
            width: 512,
            height: 512,
            sourceWidth: 800,
            sourceHeight: 400,
            contentX: 0,
            contentY: 400,
            contentWidth: 512,
            contentHeight: 200,
          },
        },
      }),
    ).toContain('provider');
  });

  it('accepts reviewed object-selection evidence and rejects incomplete provenance', () => {
    const evidence = {
      schemaVersion: 1 as const,
      source: 'object-selection' as const,
      verification: 'object-selection-reviewed' as const,
      maskFingerprint: 'mask-fingerprint',
      reviewedAt: 30,
      sourceFingerprint: 'sha256:source',
      mappingFingerprint: 'mapping-fingerprint',
      candidateReviewKey: 'candidate-review-key',
      candidateSetId: 'candidate-set',
      candidateIndex: 0,
      candidateCount: 2,
      rejectedCandidateCount: 1,
      candidateScore: 0.94,
      candidateScoreSource: 'predicted-iou',
      promptContainment: 1,
      promptCoordinateSpace: 'source-image-normalized' as const,
      promptPoints: [{ x: 0.5, y: 0.5, label: 1 as const }],
      candidateReviewedAt: 20,
      diagnostics: {
        hardPixels: 1200,
        hardCoverage: 0.15,
        bounds: { x: 120, y: 80, width: 160, height: 140 },
        componentCount: 1,
        anchoredComponentCount: 1,
        anchoredCoverage: 1,
        unanchoredCoverage: 0,
        ambiguous: false,
      },
    };
    expect(validateGenerativeEdit({ ...fixture(), selectionEvidence: evidence })).toBeNull();
    expect(
      validateGenerativeEdit({
        ...fixture(),
        selectionEvidence: { ...evidence, mappingFingerprint: '' },
      }),
    ).toContain('selection evidence');
  });

  it('accepts repeated-edit lineage and rejects self-parenting records', () => {
    expect(validateGenerativeEdit({ ...fixture(), parentEditId: 'gen-0' })).toBeNull();
    expect(validateGenerativeEdit({ ...fixture(), parentEditId: 'gen-1' })).toContain(
      'parentEditId',
    );
  });

  it('rejects an active variation that is not persisted', () => {
    expect(validateGenerativeEdit({ ...fixture(), activeVariationId: 'missing' })).toContain(
      'active variation',
    );
  });

  it('rejects persisted user bounds outside the source mask frame', () => {
    expect(
      validateGenerativeEdit({
        ...fixture(),
        masks: {
          ...fixture().masks,
          userBounds: { x: 600, y: 400, width: 80, height: 80 },
        },
      }),
    ).toContain('masks');
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

  it('rejects an empty retained thumbnail reference', () => {
    const invalid = fixture();
    invalid.variations[0]!.thumbnailAssetId = '';
    expect(validateGenerativeEdit(invalid)).toContain('variations');
  });

  it('rejects an out-of-range image guidance scale', () => {
    const invalid = fixture();
    invalid.settings.imageGuidanceScale = 51;
    expect(validateGenerativeEdit(invalid)).toContain('settings');
  });
});
