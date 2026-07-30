import { describe, expect, it } from 'vitest';
import { ModelSelector } from '../ModelSelector';
import type {
  ModelInstallInfo,
  ModelManifestEntry,
  QualityTier,
  RuntimeCapabilities,
  SelectionContext,
} from '../types';

function makeEntry(overrides: Partial<ModelManifestEntry> & { id: string }): ModelManifestEntry {
  const base: ModelManifestEntry = {
    id: overrides.id,
    name: `Model ${overrides.id}`,
    description: '',
    sizeBytes: 1_000_000,
    remoteUrl: '',
    checksum: '',
    bundled: true,
    inputSpec: null,
    quality: 3,
    speed: 3,
    peakMemoryBytes: 10_000_000,
    gpuRecommended: false,
    maxSessions: 2,
    precision: 'fp32',
    category: 'segmentation',
  };
  return { ...base, ...overrides };
}

function makeCaps(overrides?: Partial<RuntimeCapabilities>): RuntimeCapabilities {
  return {
    crossOriginIsolated: true,
    isWebKitGTK: false,
    isTauri: false,
    hasWorker: true,
    hasWebGL: true,
    hasWebGPU: false,
    sharedMemoryAvailable: true,
    wasmSafeModelBytes: 400_000_000,
    wasmSafePeakBytes: 600_000_000,
    preferredOnnxProviders: ['wasm', 'webgl'],
    label: 'Test',
    logicalProcessors: 8,
    approximateMemoryMB: 4096,
    hasAvx2: true,
    hasAvx512: false,
    hasVnni: false,
    hasNeon: false,
    hasDotProduct: false,
    batteryPowered: false,
    networkType: '4g',
    ...overrides,
  };
}

function makeContext(overrides?: Partial<SelectionContext>): SelectionContext {
  return {
    task: overrides?.task ?? 'segmentation',
    qualityMode: overrides?.qualityMode ?? 'auto',
    inputWidth: overrides?.inputWidth ?? 800,
    inputHeight: overrides?.inputHeight ?? 600,
    hasAlpha: overrides?.hasAlpha ?? false,
    runtimeCapabilities: overrides?.runtimeCapabilities ?? makeCaps(),
    availableModels: overrides?.availableModels ?? [],
  };
}

describe('ModelSelector', () => {
  it('selects best quality model available', () => {
    const manifest = new Map<string, ModelManifestEntry>();
    manifest.set('u2netp', makeEntry({ id: 'u2netp', quality: 3, bundled: true }));
    manifest.set('isnet', makeEntry({ id: 'isnet', quality: 4, bundled: false }));

    const selector = new ModelSelector({
      manifestEntries: manifest,
      installStates: new Map(),
      runtimeCapabilities: makeCaps(),
    });

    const decision = selector.select(makeContext({ qualityMode: 'balanced' }));
    expect(decision.modelId).toBe('isnet');
    expect(decision.requireDownload).toBe(true);
  });

  it('prefers higher quality in high-quality mode', () => {
    const manifest = new Map<string, ModelManifestEntry>();
    manifest.set('u2netp', makeEntry({ id: 'u2netp', quality: 3, bundled: true }));
    manifest.set('birefnet', makeEntry({ id: 'birefnet', quality: 5, bundled: false }));
    manifest.set('isnet', makeEntry({ id: 'isnet', quality: 4, bundled: false }));

    const selector = new ModelSelector({
      manifestEntries: manifest,
      installStates: new Map(),
      runtimeCapabilities: makeCaps(),
    });

    const decision = selector.select(makeContext({ qualityMode: 'high-quality' }));
    expect(decision.modelId).toBe('birefnet');
    expect(decision.quality).toBe(5);
  });

  it('prefers highest quality model in auto mode regardless of bundled status', () => {
    const manifest = new Map<string, ModelManifestEntry>();
    manifest.set('u2netp', makeEntry({ id: 'u2netp', quality: 3, bundled: true }));
    manifest.set('birefnet', makeEntry({ id: 'birefnet', quality: 5, bundled: false }));

    const selector = new ModelSelector({
      manifestEntries: manifest,
      installStates: new Map(),
      runtimeCapabilities: makeCaps(),
    });

    const decision = selector.select(makeContext({ qualityMode: 'auto' }));
    expect(decision.modelId).toBe('birefnet');
    expect(decision.quality).toBe(5);
  });

  it('returns fallback when no models for task', () => {
    const manifest = new Map<string, ModelManifestEntry>();
    manifest.set('depth', makeEntry({ id: 'depth', category: 'depth', bundled: true }));

    const selector = new ModelSelector({
      manifestEntries: manifest,
      installStates: new Map(),
      runtimeCapabilities: makeCaps(),
    });

    const decision = selector.select(makeContext({ task: 'ocr' }));
    expect(decision.modelId).toBe('');
    expect(decision.reason).toContain('No model');
  });

  it('selects INT8 in fast mode when VNNI is available', () => {
    const manifest = new Map<string, ModelManifestEntry>();
    manifest.set(
      'u2netp',
      makeEntry({ id: 'u2netp', quality: 3, bundled: true, precision: 'fp32' }),
    );
    manifest.set(
      'u2netp-int8',
      makeEntry({
        id: 'u2netp-int8',
        quality: 2 as QualityTier,
        bundled: true,
        precision: 'int8',
        sourceModelId: 'u2netp',
      }),
    );

    const selector = new ModelSelector({
      manifestEntries: manifest,
      installStates: new Map(),
      runtimeCapabilities: makeCaps({ hasVnni: true }),
    });

    const decision = selector.select(makeContext({ qualityMode: 'fast' }));
    expect(decision.precision).toBe('int8');
  });

  it('does not select INT8 without VNNI in auto mode', () => {
    const manifest = new Map<string, ModelManifestEntry>();
    manifest.set(
      'u2netp',
      makeEntry({ id: 'u2netp', quality: 3, bundled: true, precision: 'fp32' }),
    );
    manifest.set(
      'u2netp-int8',
      makeEntry({
        id: 'u2netp-int8',
        quality: 2 as QualityTier,
        bundled: true,
        precision: 'int8',
        sourceModelId: 'u2netp',
      }),
    );

    const selector = new ModelSelector({
      manifestEntries: manifest,
      installStates: new Map(),
      runtimeCapabilities: makeCaps({ hasVnni: false, hasAvx2: true }),
    });

    const decision = selector.select(makeContext({ qualityMode: 'auto' }));
    expect(decision.precision).toBe('fp32');
  });

  it('indicates downscale when input exceeds model dimensions', () => {
    const manifest = new Map<string, ModelManifestEntry>();
    manifest.set(
      'u2netp',
      makeEntry({
        id: 'u2netp',
        bundled: true,
        tensorContract: {
          version: 1,
          inputs: [{ name: 'input', dims: [1, 3, 320, 320], dtype: 'float32' }],
          outputs: [{ name: 'output', dims: [1, 1, 320, 320], dtype: 'float32' }],
          outputActivation: 'none',
        },
      }),
    );

    const selector = new ModelSelector({
      manifestEntries: manifest,
      installStates: new Map(),
      runtimeCapabilities: makeCaps(),
    });

    const decision = selector.select(makeContext({ inputWidth: 1920, inputHeight: 1080 }));
    expect(decision.downscale).toBe(true);
  });

  it('indicates tiling when input greatly exceeds model dimensions', () => {
    const manifest = new Map<string, ModelManifestEntry>();
    manifest.set(
      'u2netp',
      makeEntry({
        id: 'u2netp',
        bundled: true,
        tensorContract: {
          version: 1,
          inputs: [{ name: 'input', dims: [1, 3, 320, 320], dtype: 'float32' }],
          outputs: [{ name: 'output', dims: [1, 1, 320, 320], dtype: 'float32' }],
          outputActivation: 'none',
        },
      }),
    );

    const selector = new ModelSelector({
      manifestEntries: manifest,
      installStates: new Map(),
      runtimeCapabilities: makeCaps(),
    });

    const decision = selector.select(makeContext({ inputWidth: 4000, inputHeight: 3000 }));
    expect(decision.tiling).toBe(true);
  });

  it('explains rejections', () => {
    const manifest = new Map<string, ModelManifestEntry>();
    manifest.set(
      'big-model',
      makeEntry({
        id: 'big-model',
        bundled: false,
        peakMemoryBytes: 900_000_000,
      }),
    );

    const selector = new ModelSelector({
      manifestEntries: manifest,
      installStates: new Map(),
      runtimeCapabilities: makeCaps({ wasmSafeModelBytes: 100_000_000 }),
    });

    const decision = selector.select(makeContext({ qualityMode: 'balanced' }));
    const explanations = selector.explain(decision.rejections);
    if (explanations.length > 0) {
      expect(explanations[0]).toContain('Rejected');
      expect(explanations[0]).toContain('budget');
    }
  });

  it('prefers best available in fast mode with VNNI', () => {
    const manifest = new Map<string, ModelManifestEntry>();
    manifest.set(
      'u2netp',
      makeEntry({ id: 'u2netp', quality: 3, bundled: true, precision: 'fp32' }),
    );
    manifest.set(
      'isnet',
      makeEntry({
        id: 'isnet',
        quality: 4,
        bundled: false,
        precision: 'fp32',
      }),
    );

    const installStates = new Map<string, ModelInstallInfo>();
    installStates.set('isnet', {
      id: 'isnet',
      name: 'IS-Net',
      sizeBytes: 178_000_000,
      installed: true,
      source: 'downloaded',
      state: 'ready',
    });

    const selector = new ModelSelector({
      manifestEntries: manifest,
      installStates,
      runtimeCapabilities: makeCaps({ hasVnni: true }),
    });

    const decision = selector.select(makeContext({ qualityMode: 'fast' }));
    expect(decision.modelId).toBe('isnet');
    expect(decision.requireDownload).toBe(false);
  });
});
