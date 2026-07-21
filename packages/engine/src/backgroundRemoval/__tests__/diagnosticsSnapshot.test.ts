/**
 * Tests for pipeline diagnostics snapshot.
 */

import { describe, expect, it } from 'vitest';
import { buildDiagnostics, classifyMemory } from '../diagnostics/diagnosticsSnapshot';
import type { EnvironmentCapabilities } from '../environmentCapabilities';

function makeCaps(label = 'Browser'): EnvironmentCapabilities {
  return {
    crossOriginIsolated: false,
    isWebKitGTK: false,
    isTauri: false,
    hasWorker: true,
    hasWebGL: false,
    hasWebGPU: false,
    sharedMemoryAvailable: false,
    wasmSafeModelBytes: 50_000_000,
    preferredOnnxProviders: ['wasm'],
    label,
  };
}

describe('classifyMemory', () => {
  it('classifies < 50MB as low', () => {
    expect(classifyMemory(14_000_000)).toBe('low');
  });

  it('classifies 50-500MB as medium', () => {
    expect(classifyMemory(200_000_000)).toBe('medium');
  });

  it('classifies 500MB-1GB as high', () => {
    expect(classifyMemory(800_000_000)).toBe('high');
  });

  it('classifies > 1GB as ultra', () => {
    expect(classifyMemory(3_000_000_000)).toBe('ultra');
  });
});

describe('buildDiagnostics', () => {
  it('builds a complete snapshot for u2netp on WASM', () => {
    const diag = buildDiagnostics({
      resolvedModel: 'u2netp',
      executionProvider: 'wasm',
      caps: makeCaps(),
      fellBack: false,
      fallbackReason: 'Default selection',
    });
    expect(diag.resolvedModel).toBe('u2netp');
    expect(diag.resolvedModelName).toBe('U^2-Net Light');
    expect(diag.precision).toBe('fp32');
    expect(diag.executionProvider).toBe('wasm');
    expect(diag.memoryClass).toBe('low');
    expect(diag.fellBack).toBe(false);
    expect(diag.environment).toBe('Browser');
    expect(diag.qualityValidated).toBe(true);
  });

  it('marks INT8 model precision correctly', () => {
    const diag = buildDiagnostics({
      resolvedModel: 'u2netp-int8',
      executionProvider: 'wasm',
      caps: makeCaps(),
      fellBack: false,
      fallbackReason: 'INT8 selection',
    });
    expect(diag.precision).toBe('int8');
  });

  it('classifies BiRefNet Full as ultra memory', () => {
    const diag = buildDiagnostics({
      resolvedModel: 'birefnet-general',
      executionProvider: 'native',
      caps: makeCaps('Tauri/Chromium'),
      fellBack: false,
      fallbackReason: 'Native maximum quality',
    });
    expect(diag.memoryClass).toBe('ultra');
    expect(diag.executionProvider).toBe('native');
  });

  it('marks fallback state correctly', () => {
    const diag = buildDiagnostics({
      resolvedModel: 'u2netp',
      executionProvider: 'wasm',
      caps: makeCaps(),
      fellBack: true,
      requestedTier: 'quality',
      fallbackReason: 'BiRefNet Lite not available, fell back to u2netp',
      wasmSafetyBlocked: true,
    });
    expect(diag.fellBack).toBe(true);
    expect(diag.requestedTier).toBe('quality');
    expect(diag.wasmSafetyBlocked).toBe(true);
  });

  it('handles unknown execution provider', () => {
    const diag = buildDiagnostics({
      resolvedModel: 'u2netp',
      executionProvider: 'directml',
      caps: makeCaps(),
      fellBack: false,
      fallbackReason: 'test',
    });
    expect(diag.executionProvider).toBe('unknown');
  });

  it('handles null resolved model', () => {
    const diag = buildDiagnostics({
      resolvedModel: null,
      executionProvider: 'wasm',
      caps: makeCaps(),
      fellBack: false,
      fallbackReason: 'No model available',
    });
    expect(diag.resolvedModelName).toBe('none');
    expect(diag.memoryClass).toBe('low');
  });
});
