import { describe, expect, it } from 'vitest';
import {
  MOBILE_SAM_DECODER_ID,
  MOBILE_SAM_ENCODER_ID,
  MOBILE_SAM_PROVIDER_ID,
  type PromptedProviderFact,
  routePromptedSelection,
  SAM2_DECODER_ID,
  SAM2_ENCODER_ID,
  SAM2_PROVIDER_ID,
} from './promptedRouting';

const providers: PromptedProviderFact[] = [
  {
    id: MOBILE_SAM_PROVIDER_ID,
    label: 'Faster prompted selection',
    encoderId: MOBILE_SAM_ENCODER_ID,
    decoderId: MOBILE_SAM_DECODER_ID,
    installed: true,
    workingSetBytes: 380 * 1024 * 1024,
    speedRank: 1,
    qualityRank: 1,
    supportedExecutionProviders: ['wasm', 'webgpu'],
  },
  {
    id: SAM2_PROVIDER_ID,
    label: 'Higher-detail prompted selection',
    encoderId: SAM2_ENCODER_ID,
    decoderId: SAM2_DECODER_ID,
    installed: true,
    workingSetBytes: 700 * 1024 * 1024,
    speedRank: 2,
    qualityRank: 2,
    supportedExecutionProviders: ['wasm', 'webgpu'],
  },
];

describe('prompted selection routing', () => {
  it('routes speed-sensitive WASM work to MobileSAM and records the reason', () => {
    const decision = routePromptedSelection({
      preference: 'fast',
      sourceWidth: 1920,
      sourceHeight: 1080,
      executionProvider: 'wasm',
      safeWorkingSetBytes: 2 * 1024 * 1024 * 1024,
      providers,
    });
    expect(decision.providerId).toBe(MOBILE_SAM_PROVIDER_ID);
    expect(decision.encoderId).toBe(MOBILE_SAM_ENCODER_ID);
    expect(decision.reason).toMatch(/speed preference/);
    expect(decision.reason).toMatch(/WASM runtime/);
    expect(decision.estimatedWorkingSetBytes).toBeGreaterThan(380 * 1024 * 1024);
  });

  it('routes an explicit quality request to SAM2 when the measured budget allows it', () => {
    const decision = routePromptedSelection({
      preference: 'quality',
      sourceWidth: 1024,
      sourceHeight: 1024,
      executionProvider: 'webgpu',
      safeWorkingSetBytes: 2 * 1024 * 1024 * 1024,
      providers,
    });
    expect(decision.providerId).toBe(SAM2_PROVIDER_ID);
    expect(decision.decoderId).toBe(SAM2_DECODER_ID);
  });

  it('prefers a warm embedding even when the cold-path preference differs', () => {
    const decision = routePromptedSelection({
      preference: 'quality',
      sourceWidth: 1200,
      sourceHeight: 800,
      executionProvider: 'wasm',
      safeWorkingSetBytes: 2 * 1024 * 1024 * 1024,
      cachedEmbeddingProvider: MOBILE_SAM_PROVIDER_ID,
      providers,
    });
    expect(decision.providerId).toBe(MOBILE_SAM_PROVIDER_ID);
    expect(decision.reason).toMatch(/warm embedding available/);
  });

  it('rejects an unsafe provider without silently changing the capability', () => {
    const decision = routePromptedSelection({
      preference: 'quality',
      sourceWidth: 4000,
      sourceHeight: 3000,
      executionProvider: 'wasm',
      safeWorkingSetBytes: 256 * 1024 * 1024,
      providers,
    });
    expect(decision.providerId).toBeNull();
    expect(decision.reason).toMatch(/unavailable/);
    expect(decision.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: MOBILE_SAM_PROVIDER_ID }),
        expect.objectContaining({ providerId: SAM2_PROVIDER_ID }),
      ]),
    );
  });

  it('reports a missing prompted model as an installation issue, not a foreground fallback', () => {
    const decision = routePromptedSelection({
      preference: 'auto',
      sourceWidth: 800,
      sourceHeight: 600,
      executionProvider: 'wasm',
      providers: providers.map((provider) => ({ ...provider, installed: false })),
    });
    expect(decision.providerId).toBeNull();
    expect(decision.rejected.map((item) => item.providerId)).toEqual([
      MOBILE_SAM_PROVIDER_ID,
      SAM2_PROVIDER_ID,
    ]);
    expect(decision.reason).toMatch(/model-free selection/);
  });
});
