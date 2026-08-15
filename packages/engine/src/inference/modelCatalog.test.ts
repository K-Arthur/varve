import { beforeEach, describe, expect, it } from 'vitest';
import { resetManifestCache } from './manifest';
import {
  estimateModelMemory,
  getModelById,
  getRecommendedProvider,
  isModelReady,
  listAllModels,
  listModelsByCategory,
  resetModelCatalog,
  resolveBestModel,
  setModelState,
} from './modelCatalog';

describe('modelCatalog', () => {
  beforeEach(() => {
    resetModelCatalog();
    resetManifestCache();
  });

  describe('listAllModels', () => {
    it('returns fallback entries when manifest is unavailable', () => {
      const all = listAllModels();
      expect(all.length).toBeGreaterThanOrEqual(7);
    });

    it('includes segmentation models', () => {
      const all = listAllModels();
      const ids = all.map((m) => m.id);
      expect(ids).toContain('u2netp');
      expect(ids).toContain('birefnet-general-lite');
    });

    it('includes upscaling models', () => {
      const all = listAllModels();
      const ids = all.map((m) => m.id);
      expect(ids).toContain('upscale-realesr-general');
    });

    it('includes the verified DINOv2 image embedding model', () => {
      const entry = getModelById('dinov2-small');
      expect(entry).toMatchObject({
        id: 'dinov2-small',
        category: 'embedding',
        precision: 'fp32',
        sizeBytes: 88_459_888,
        checksum: '83141175ec78b4ff9a2bb58a4c7c264ba0054d1c2e122e5a8114b79a8d4179ea',
      });
      expect(entry?.remoteUrl).toContain('Xenova/dinov2-small');
    });

    it('includes INT8 variants', () => {
      const all = listAllModels();
      const ids = all.map((m) => m.id);
      expect(ids).toContain('u2netp-int8');
      expect(ids).toContain('upscale-realesr-general-int8');
    });
  });

  describe('getModelById', () => {
    it('finds a known model', () => {
      const entry = getModelById('u2netp');
      expect(entry).not.toBeUndefined();
      expect(entry!.id).toBe('u2netp');
    });

    it('returns undefined for unknown model', () => {
      const entry = getModelById('nonexistent');
      expect(entry).toBeUndefined();
    });

    it('returns model with precision metadata', () => {
      const entry = getModelById('u2netp-int8');
      expect(entry!.precision).toBe('int8');
      expect(entry!.sourceModelId).toBe('u2netp');
    });
  });

  describe('listModelsByCategory', () => {
    it('returns segmentation models', () => {
      const segModels = listModelsByCategory('segmentation');
      expect(segModels.length).toBeGreaterThan(0);
      expect(segModels.every((m) => m.category === 'segmentation')).toBe(true);
    });

    it('returns upscaling models', () => {
      const upscaleModels = listModelsByCategory('upscaling');
      expect(upscaleModels.length).toBeGreaterThan(0);
      expect(upscaleModels.every((m) => m.category === 'upscaling')).toBe(true);
    });
  });

  describe('resolveBestModel', () => {
    it('returns source model when performance not preferred', async () => {
      const result = await resolveBestModel('u2netp', false);
      expect(result.modelId).toBe('u2netp');
      expect(result.isInt8).toBe(false);
    });

    it('returns INT8 variant when performance preferred and available', async () => {
      // Set the INT8 model as ready
      setModelState('u2netp-int8', 'ready');
      const result = await resolveBestModel('u2netp', true);
      expect(result.modelId).toBe('u2netp-int8');
      expect(result.isInt8).toBe(true);
    });
  });

  describe('estimateModelMemory', () => {
    it('returns non-zero for known models', () => {
      const memory = estimateModelMemory('u2netp');
      expect(memory).toBeGreaterThan(0);
    });

    it('returns zero for unknown models', () => {
      const memory = estimateModelMemory('nonexistent');
      expect(memory).toBe(0);
    });

    it('scales with batch size', () => {
      const single = estimateModelMemory('u2netp', 1);
      const double = estimateModelMemory('u2netp', 2);
      expect(double).toBe(single * 2);
    });
  });

  describe('getRecommendedProvider', () => {
    it('recommends GPU for quality models', () => {
      const rec = getRecommendedProvider('birefnet-general-lite');
      expect(rec).toBe('gpu');
    });

    it('recommends CPU for INT8 models', () => {
      const rec = getRecommendedProvider('u2netp-int8');
      expect(rec).toBe('cpu');
    });

    it('recommends CPU for bundled FP32 upscale models', () => {
      const rec = getRecommendedProvider('upscale-realesr-general');
      expect(rec).toBe('any');
    });
  });

  describe('model state management', () => {
    it('tracks model ready state', () => {
      expect(isModelReady('u2netp')).toBe(false);
      setModelState('u2netp', 'ready');
      expect(isModelReady('u2netp')).toBe(true);
    });

    it('tracks model error state', () => {
      setModelState('u2netp', 'error');
      expect(isModelReady('u2netp')).toBe(false);
    });
  });

  describe('INT8 quality validation', () => {
    it('bundled INT8 variants have quality validation with real metrics from validation report', () => {
      const entry = getModelById('u2netp-int8');
      expect(entry!.qualityValidation).toBeDefined();
      expect(entry!.qualityValidation!.passed).toBe(false);
      expect(entry!.qualityValidation!.meanMae).toBeGreaterThan(0);
      expect(entry!.qualityValidation!.meanPsnrDb).toBeGreaterThan(0);
      expect(entry!.qualityValidation!.failureReasons).toBeDefined();
      expect(entry!.qualityValidation!.failureReasons!.length).toBeGreaterThan(0);
    });

    it('FP32 models do not have quality validation', () => {
      const entry = getModelById('u2netp');
      expect(entry!.qualityValidation).toBeUndefined();
    });

    it('INT8 variant references its FP32 source', () => {
      const entry = getModelById('u2netp-int8');
      expect(entry!.sourceModelId).toBe('u2netp');
      expect(entry!.sourceSha256).toBe(
        '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
      );
    });
  });
});
