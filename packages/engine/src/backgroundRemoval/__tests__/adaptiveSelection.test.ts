/**
 * Tests for adaptive model selection — device-aware Automatic mode.
 *
 * Verifies that model selection considers device capabilities, installed
 * models, and memory constraints to pick the best safe model.
 */

import { describe, expect, it } from 'vitest';
import { selectAdaptiveModel } from '../adaptiveSelection';
import type { EnvironmentCapabilities } from '../environmentCapabilities';

function makeCaps(overrides: Partial<EnvironmentCapabilities> = {}): EnvironmentCapabilities {
  return {
    crossOriginIsolated: false,
    isWebKitGTK: false,
    isTauri: false,
    hasWorker: true,
    hasWebGL: false,
    hasWebGPU: false,
    sharedMemoryAvailable: false,
    wasmSafeModelBytes: 50_000_000,
    wasmSafePeakBytes: 600_000_000,
    preferredOnnxProviders: ['wasm'],
    label: 'Browser',
    ...overrides,
  };
}

async function fakeGetPath(modelId: string): Promise<string | null> {
  return `/models/${modelId}.onnx`;
}

describe('selectAdaptiveModel — automatic mode', () => {
  it('selects fast (u2netp) on bare WASM with no installed models', async () => {
    const result = await selectAdaptiveModel({
      tier: 'automatic',
      caps: makeCaps(),
      nativeReady: false,
      sourceWidth: 640,
      sourceHeight: 480,
      isPreview: false,
      getModelPath: async (id) => (id === 'u2netp' ? `/models/${id}.onnx` : null),
      isInstalled: async (id) => id === 'u2netp',
    });
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('fast');
    expect(result!.modelId).toBe('u2netp');
    expect(result!.fellBack).toBe(false);
  });

  it('selects maximum (BiRefNet Full) only when native runtime ready', async () => {
    // BiRefNet Full (928MB) is native-only — it cannot run on WebGPU alone.
    const result = await selectAdaptiveModel({
      tier: 'automatic',
      caps: makeCaps({ hasWebGPU: true }),
      nativeReady: true,
      sourceWidth: 640,
      sourceHeight: 480,
      isPreview: false,
      getModelPath: fakeGetPath,
      isInstalled: async () => true,
    });
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('maximum');
    expect(result!.modelId).toBe('birefnet-general');
  });

  it('skips maximum on WebGPU (native-only), selects quality instead', async () => {
    // Without native runtime, BiRefNet Full is skipped even if "installed".
    const result = await selectAdaptiveModel({
      tier: 'automatic',
      caps: makeCaps({ hasWebGPU: true }),
      nativeReady: false,
      sourceWidth: 640,
      sourceHeight: 480,
      isPreview: false,
      getModelPath: fakeGetPath,
      isInstalled: async () => true,
    });
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('quality');
    expect(result!.modelId).toBe('birefnet-general-lite');
  });

  it('falls back from maximum to quality when BiRefNet Full not installed', async () => {
    const result = await selectAdaptiveModel({
      tier: 'automatic',
      caps: makeCaps({ hasWebGPU: true }),
      nativeReady: true,
      sourceWidth: 640,
      sourceHeight: 480,
      isPreview: false,
      getModelPath: async (id) => (id === 'birefnet-general' ? null : `/models/${id}.onnx`),
      isInstalled: async (id) => id !== 'birefnet-general',
    });
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('quality');
    expect(result!.modelId).toBe('birefnet-general-lite');
  });

  it('falls back to fast when no accelerated models are installed', async () => {
    const result = await selectAdaptiveModel({
      tier: 'automatic',
      caps: makeCaps(),
      nativeReady: false,
      sourceWidth: 640,
      sourceHeight: 480,
      isPreview: false,
      getModelPath: async (id) => (id === 'u2netp' ? `/models/${id}.onnx` : null),
      isInstalled: async (id) => id === 'u2netp',
    });
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('fast');
  });
});

describe('selectAdaptiveModel — explicit tier', () => {
  it('selects the requested tier when available', async () => {
    const result = await selectAdaptiveModel({
      tier: 'fast',
      caps: makeCaps(),
      nativeReady: false,
      sourceWidth: 640,
      sourceHeight: 480,
      isPreview: false,
      getModelPath: fakeGetPath,
      isInstalled: async (id) => id === 'u2netp',
    });
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('fast');
    expect(result!.modelId).toBe('u2netp');
    expect(result!.fellBack).toBe(false);
  });

  it('falls back from quality to balanced when BiRefNet Lite not installed', async () => {
    const result = await selectAdaptiveModel({
      tier: 'quality',
      caps: makeCaps({ hasWebGPU: true }),
      nativeReady: true,
      sourceWidth: 640,
      sourceHeight: 480,
      isPreview: false,
      getModelPath: async (id) => (id !== 'birefnet-general-lite' ? `/models/${id}.onnx` : null),
      isInstalled: async (id) => id !== 'birefnet-general-lite',
    });
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('balanced');
    expect(result!.modelId).toBe('isnet-general-use');
    expect(result!.fellBack).toBe(true);
    expect(result!.requestedTier).toBe('quality');
  });

  it('falls back from maximum to fast when only u2netp available', async () => {
    const result = await selectAdaptiveModel({
      tier: 'maximum',
      caps: makeCaps(),
      nativeReady: false,
      sourceWidth: 640,
      sourceHeight: 480,
      isPreview: false,
      getModelPath: async (id) => (id === 'u2netp' ? `/models/${id}.onnx` : null),
      isInstalled: async (id) => id === 'u2netp',
    });
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('fast');
    expect(result!.modelId).toBe('u2netp');
    expect(result!.fellBack).toBe(true);
    expect(result!.requestedTier).toBe('maximum');
  });
});

describe('selectAdaptiveModel — memory safety', () => {
  it('never selects BiRefNet Full on bare WASM (928MB > 50MB limit)', async () => {
    const result = await selectAdaptiveModel({
      tier: 'maximum',
      caps: makeCaps({ wasmSafeModelBytes: 50_000_000 }),
      nativeReady: false,
      sourceWidth: 640,
      sourceHeight: 480,
      isPreview: false,
      getModelPath: fakeGetPath,
      isInstalled: async () => true,
    });
    expect(result).not.toBeNull();
    expect(result!.modelId).not.toBe('birefnet-general');
  });

  it('never selects BiRefNet Lite on bare WASM (224MB > 50MB limit)', async () => {
    const result = await selectAdaptiveModel({
      tier: 'quality',
      caps: makeCaps({ wasmSafeModelBytes: 50_000_000 }),
      nativeReady: false,
      sourceWidth: 640,
      sourceHeight: 480,
      isPreview: false,
      getModelPath: fakeGetPath,
      isInstalled: async () => true,
    });
    expect(result).not.toBeNull();
    expect(result!.modelId).not.toBe('birefnet-general-lite');
    expect(result!.modelId).not.toBe('isnet-general-use');
    expect(result!.modelId).toBe('u2netp');
  });

  it('selects larger models when native runtime is ready', async () => {
    const result = await selectAdaptiveModel({
      tier: 'maximum',
      caps: makeCaps(),
      nativeReady: true,
      sourceWidth: 640,
      sourceHeight: 480,
      isPreview: false,
      getModelPath: fakeGetPath,
      isInstalled: async () => true,
    });
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('maximum');
    expect(result!.modelId).toBe('birefnet-general');
  });
});

describe('selectAdaptiveModel — edge cases', () => {
  it('returns null when no models are installed', async () => {
    const result = await selectAdaptiveModel({
      tier: 'automatic',
      caps: makeCaps(),
      nativeReady: false,
      sourceWidth: 640,
      sourceHeight: 480,
      isPreview: false,
      getModelPath: async () => null,
      isInstalled: async () => false,
    });
    expect(result).toBeNull();
  });

  it('includes estimated peak bytes in result', async () => {
    const result = await selectAdaptiveModel({
      tier: 'fast',
      caps: makeCaps(),
      nativeReady: false,
      sourceWidth: 640,
      sourceHeight: 480,
      isPreview: false,
      getModelPath: fakeGetPath,
      isInstalled: async (id) => id === 'u2netp',
    });
    expect(result).not.toBeNull();
    expect(result!.estimatedPeakBytes).toBeGreaterThan(0);
  });

  it('reason string includes tier and provider info', async () => {
    const result = await selectAdaptiveModel({
      tier: 'fast',
      caps: makeCaps({ hasWebGPU: true }),
      nativeReady: false,
      sourceWidth: 640,
      sourceHeight: 480,
      isPreview: false,
      getModelPath: fakeGetPath,
      isInstalled: async (id) => id === 'u2netp',
    });
    expect(result).not.toBeNull();
    expect(result!.reason).toContain('fast');
  });
});
