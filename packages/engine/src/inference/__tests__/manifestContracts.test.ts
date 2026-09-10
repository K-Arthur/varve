/**
 * Tests for model contract integrity against the manifest.
 *
 * These tests verify that:
 * 1. Every model with a tensorContract has structurally valid declarations
 * 2. BiRefNet contracts match the known rembg export structure
 * 3. Models without SHA-256 are correctly flagged as unverified
 * 4. Validation status is consistent with declared contracts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ModelManifestEntry } from '../../inference/types';

const manifestPath = resolve(__dirname, '../../../../../apps/desktop/public/models/manifest.json');

function loadManifest(): { version: number; models: ModelManifestEntry[] } {
  const raw = readFileSync(manifestPath, 'utf-8');
  return JSON.parse(raw);
}

describe('Manifest tensor contract integrity', () => {
  const manifest = loadManifest();

  it('manifest is version 3', () => {
    expect(manifest.version).toBe(3);
  });

  for (const model of manifest.models) {
    if (!model.tensorContract) continue;

    describe(`model: ${model.id}`, () => {
      const tc = model.tensorContract!;

      it('has at least one input and one output', () => {
        expect(tc.inputs.length).toBeGreaterThan(0);
        expect(tc.outputs.length).toBeGreaterThan(0);
      });

      it('inputs have name, dtype, and dims', () => {
        for (const input of tc.inputs) {
          expect(input.name).toBeTruthy();
          expect(input.dtype).toBeTruthy();
          expect(Array.isArray(input.dims)).toBe(true);
        }
      });

      it('outputs have name, dtype, and dims', () => {
        for (const output of tc.outputs) {
          expect(output.name).toBeTruthy();
          expect(output.dtype).toBeTruthy();
          expect(Array.isArray(output.dims)).toBe(true);
        }
      });

      it('has a valid outputActivation', () => {
        expect(['sigmoid', 'softmax', 'none', 'linear']).toContain(tc.outputActivation);
      });

      it('has a positive contract version', () => {
        expect(tc.version).toBeGreaterThan(0);
      });

      it('has normalization with 3-element mean and std', () => {
        if (tc.normalization) {
          expect(tc.normalization.mean).toHaveLength(3);
          expect(tc.normalization.std).toHaveLength(3);
          expect(['rgb', 'bgr']).toContain(tc.normalization.channelOrder);
        }
      });
    });
  }
});

describe('BiRefNet tensor contracts (DECLARED — not yet verified against ONNX graph)', () => {
  const manifest = loadManifest();
  const birefnetLite = manifest.models.find((m) => m.id === 'birefnet-general-lite');
  const birefnetFull = manifest.models.find((m) => m.id === 'birefnet-general');

  it('BiRefNet Lite has a tensor contract', () => {
    expect(birefnetLite?.tensorContract).toBeDefined();
  });

  it('BiRefNet Full has a tensor contract', () => {
    expect(birefnetFull?.tensorContract).toBeDefined();
  });

  if (birefnetLite?.tensorContract) {
    const tc = birefnetLite.tensorContract;

    it('BiRefNet Lite input is "input.1" with [1,3,1024,1024] float32', () => {
      expect(tc.inputs[0]!.name).toBe('input.1');
      expect(tc.inputs[0]!.dims).toEqual([1, 3, 1024, 1024]);
      expect(tc.inputs[0]!.dtype).toBe('float32');
    });

    it('BiRefNet Lite output is "output.1" with [1,1,1024,1024] float32', () => {
      expect(tc.outputs[0]!.name).toBe('output.1');
      expect(tc.outputs[0]!.dims).toEqual([1, 1, 1024, 1024]);
      expect(tc.outputs[0]!.dtype).toBe('float32');
    });

    it('BiRefNet Lite uses sigmoid output activation', () => {
      expect(tc.outputActivation).toBe('sigmoid');
    });

    it('BiRefNet Lite uses ImageNet normalization', () => {
      expect(tc.normalization?.mean).toEqual([0.485, 0.456, 0.406]);
      expect(tc.normalization?.std).toEqual([0.229, 0.224, 0.225]);
      expect(tc.normalization?.channelOrder).toBe('rgb');
    });
  }

  if (birefnetFull?.tensorContract) {
    const tc = birefnetFull.tensorContract;

    it('BiRefNet Full input is "input.1" with [1,3,1024,1024] float32', () => {
      expect(tc.inputs[0]!.name).toBe('input.1');
      expect(tc.inputs[0]!.dims).toEqual([1, 3, 1024, 1024]);
      expect(tc.inputs[0]!.dtype).toBe('float32');
    });

    it('BiRefNet Full output is "output.1" with [1,1,1024,1024] float32', () => {
      expect(tc.outputs[0]!.name).toBe('output.1');
      expect(tc.outputs[0]!.dims).toEqual([1, 1, 1024, 1024]);
      expect(tc.outputs[0]!.dtype).toBe('float32');
    });

    it('BiRefNet Full uses sigmoid output activation', () => {
      expect(tc.outputActivation).toBe('sigmoid');
    });
  }
});

describe('Semantic similarity model contract', () => {
  const manifest = loadManifest();
  const dino = manifest.models.find((m) => m.id === 'dinov2-small');

  it('declares the verified DINOv2-small artifact and tensor contract', () => {
    expect(dino).toMatchObject({
      filename: 'dinov2-small.onnx',
      bundled: false,
      sha256: '83141175ec78b4ff9a2bb58a4c7c264ba0054d1c2e122e5a8114b79a8d4179ea',
      precision: 'fp32',
      sourceLicense: 'Apache-2.0',
    });
    expect(dino?.tensorContract).toMatchObject({
      inputs: [{ name: 'pixel_values', dims: [1, 3, 224, 224], dtype: 'float32' }],
      outputs: [{ name: 'last_hidden_state', dims: [1, 197, 384], dtype: 'float32' }],
    });
  });
});

describe('Model validation consistency', () => {
  const manifest = loadManifest();

  for (const model of manifest.models) {
    if (!model.validation) continue;

    describe(`model: ${model.id}`, () => {
      const v = model.validation!;

      it('has consistent validation fields', () => {
        // If contract is verified, there must be a contract version
        if (v.contractVerified) {
          expect(v.contractVersion).toBeGreaterThan(0);
          expect(v.contractVerifiedAt).toBeTruthy();
        }

        // If integrity is verified, there must be a timestamp
        if (v.integrityVerified) {
          expect(v.integrityVerifiedAt).toBeTruthy();
        }

        // If inference is verified, there must be a timestamp
        if (v.inferenceVerified) {
          expect(v.inferenceVerifiedAt).toBeTruthy();
        }
      });

      it('has valid provenance status', () => {
        expect(['unverified', 'signed', 'verified', 'revoked', 'expired']).toContain(
          v.provenanceStatus,
        );
      });

      it('has a validation summary', () => {
        expect(v.validationSummary).toBeTruthy();
      });
    });
  }
});

describe('Models missing SHA-256 are flagged as unverified', () => {
  const manifest = loadManifest();

  const modelsWithoutSha256 = manifest.models.filter(
    (m) => m.sha256 === null || m.sha256 === undefined,
  );

  it('models without SHA-256 have unverified integrity', () => {
    for (const model of modelsWithoutSha256) {
      if (model.validation) {
        expect(model.validation.integrityVerified).toBe(false);
      }
    }
  });

  it('BiRefNet Full now has SHA-256 and is integrity-verified', () => {
    const full = manifest.models.find((m) => m.id === 'birefnet-general');
    expect(full?.sha256).toBe('58f621f00f5d756097615970a88a791584600dcf7c45b18a0a6267535a1ebd3c');
    expect(full?.validation?.integrityVerified).toBe(true);
    expect(full?.validation?.contractVerified).toBe(true);
    expect(full?.validation?.inferenceVerified).toBe(false);
  });
});
