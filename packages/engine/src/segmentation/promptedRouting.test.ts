import { describe, expect, it } from 'vitest';
import {
  MOBILE_SAM_DECODER_ID,
  MOBILE_SAM_ENCODER_ID,
  MOBILE_SAM_PROVIDER_ID,
  PROMPTED_QUALITY_EQUIVALENCE_BAND,
  type PromptedProviderFact,
  type PromptedQualityValidation,
  routePromptedSelection,
  SAM2_DECODER_ID,
  SAM2_ENCODER_ID,
  SAM2_PROVIDER_ID,
} from './promptedRouting';

/**
 * Routing tests pin the product invariant: automatic routing selects the
 * highest-quality *validated* provider the runtime can safely afford. Speed
 * breaks near-quality ties; it never outranks measured quality, and a provider
 * without measured evidence never wins `auto`.
 */

const ALL_CAPABILITIES = {
  pointPrompts: true,
  boxPrompts: true,
  maskPrompts: true,
  multipleCandidates: true,
} as const;

function validation(overrides: Partial<PromptedQualityValidation> = {}): PromptedQualityValidation {
  return {
    validated: true,
    corpusVersion: 'test-corpus-v1',
    runtimeEnvironment: 'test',
    validatedAt: '2026-09-14T00:00:00.000Z',
    meanIoU: 0.7,
    meanBoundaryF: 0.7,
    categoryIoU: {
      'thin-geometry': 0.9,
      'tiny-object': 0.9,
      'touches-edge': 0.7,
      'hair-fur': 0.7,
    },
    criticalCategories: ['thin-geometry', 'tiny-object', 'touches-edge', 'hair-fur'],
    worstCriticalIoU: 0.7,
    worstCriticalBoundaryF: 0.7,
    ...overrides,
  };
}

function provider(overrides: Partial<PromptedProviderFact>): PromptedProviderFact {
  return {
    id: MOBILE_SAM_PROVIDER_ID,
    label: 'Faster prompted selection',
    encoderId: MOBILE_SAM_ENCODER_ID,
    decoderId: MOBILE_SAM_DECODER_ID,
    installed: true,
    workingSetBytes: 380 * 1024 * 1024,
    warmPromptP95Ms: 600,
    warmPromptP95Source: 'measured',
    capabilities: ALL_CAPABILITIES,
    validation: validation({
      meanIoU: 0.6,
      meanBoundaryF: 0.6,
      worstCriticalIoU: 0.6,
      worstCriticalBoundaryF: 0.6,
    }),
    supportedExecutionProviders: ['wasm', 'webgpu'],
    ...overrides,
  };
}

const fastWeaker = provider({});
const sam2Stronger = provider({
  id: SAM2_PROVIDER_ID,
  label: 'Higher-detail prompted selection',
  encoderId: SAM2_ENCODER_ID,
  decoderId: SAM2_DECODER_ID,
  workingSetBytes: 700 * 1024 * 1024,
  warmPromptP95Ms: 1100,
  validation: validation({
    meanIoU: 0.8,
    meanBoundaryF: 0.81,
    worstCriticalIoU: 0.72,
    worstCriticalBoundaryF: 0.7,
  }),
});

const base = {
  sourceWidth: 1024,
  sourceHeight: 768,
  executionProvider: 'wasm' as const,
  safeWorkingSetBytes: 2 * 1024 * 1024 * 1024,
};

describe('prompted selection routing — quality-first auto', () => {
  it('selects the materially better validated provider even when it is slower', () => {
    const decision = routePromptedSelection({
      ...base,
      preference: 'auto',
      providers: [fastWeaker, sam2Stronger],
    });
    expect(decision.providerId).toBe(SAM2_PROVIDER_ID);
    expect(decision.reason).toMatch(/validated/i);
    expect(decision.reason).toMatch(/0\.80|0\.8/);
    expect(
      decision.candidates.find((c) => c.providerId === SAM2_PROVIDER_ID)?.finalRankReason,
    ).toMatch(/quality/i);
  });

  it('is order-independent: reversing input facts does not change the winner', () => {
    const forward = routePromptedSelection({
      ...base,
      preference: 'auto',
      providers: [fastWeaker, sam2Stronger],
    });
    const reversed = routePromptedSelection({
      ...base,
      preference: 'auto',
      providers: [sam2Stronger, fastWeaker],
    });
    expect(forward.providerId).toBe(reversed.providerId);
    expect(forward.reason).toBe(reversed.reason);
  });

  it('prefers a warm, lower-latency provider only inside the quality-equivalence band', () => {
    const equivalentSam2 = provider({
      id: SAM2_PROVIDER_ID,
      label: 'Higher-detail prompted selection',
      encoderId: SAM2_ENCODER_ID,
      decoderId: SAM2_DECODER_ID,
      workingSetBytes: 700 * 1024 * 1024,
      warmPromptP95Ms: 400,
      validation: validation({ meanIoU: 0.6 + PROMPTED_QUALITY_EQUIVALENCE_BAND / 2 }),
    });
    const decision = routePromptedSelection({
      ...base,
      preference: 'auto',
      cachedEmbeddingProvider: MOBILE_SAM_PROVIDER_ID,
      providers: [fastWeaker, equivalentSam2],
    });
    expect(decision.providerId).toBe(MOBILE_SAM_PROVIDER_ID);
    expect(decision.reason).toMatch(/equivalent|warm/i);
  });

  it('does not let a warm embedding override a material quality difference', () => {
    const decision = routePromptedSelection({
      ...base,
      preference: 'auto',
      cachedEmbeddingProvider: MOBILE_SAM_PROVIDER_ID,
      providers: [fastWeaker, sam2Stronger],
    });
    expect(decision.providerId).toBe(SAM2_PROVIDER_ID);
  });

  it('rejects a provider above the hard working-set budget instead of ranking it lower', () => {
    const decision = routePromptedSelection({
      ...base,
      safeWorkingSetBytes: 500 * 1024 * 1024,
      preference: 'auto',
      providers: [fastWeaker, sam2Stronger],
    });
    expect(decision.providerId).toBe(MOBILE_SAM_PROVIDER_ID);
    const rejection = decision.rejected.find((item) => item.providerId === SAM2_PROVIDER_ID);
    expect(rejection?.code).toBe('exceeds-hard-budget');
    expect(rejection?.reason).toMatch(/budget/i);
  });

  it('returns no provider when every candidate exceeds the hard budget', () => {
    const decision = routePromptedSelection({
      ...base,
      safeWorkingSetBytes: 64 * 1024 * 1024,
      preference: 'quality',
      providers: [fastWeaker, sam2Stronger],
    });
    expect(decision.providerId).toBeNull();
    expect(decision.rejected.every((item) => item.code === 'exceeds-hard-budget')).toBe(true);
    expect(decision.reason).toMatch(/memory|budget|unavailable/i);
  });

  it('never lets an experimental, unvalidated provider win auto', () => {
    const experimental = provider({
      id: 'efficient-sam-ti',
      label: 'Experimental EfficientSAM',
      encoderId: 'efficient-sam-ti-encoder',
      decoderId: 'efficient-sam-ti-decoder',
      experimental: true,
      validation: undefined,
      workingSetBytes: 100 * 1024 * 1024,
      warmPromptP95Ms: 50,
    });
    const decision = routePromptedSelection({
      ...base,
      preference: 'auto',
      providers: [experimental, fastWeaker],
    });
    expect(decision.providerId).toBe(MOBILE_SAM_PROVIDER_ID);
    const rejection = decision.rejected.find((item) => item.providerId === 'efficient-sam-ti');
    expect(rejection?.code).toBe('experimental-provider');
  });

  it('honors an explicit experimental provider choice without falling back', () => {
    const explicitMobile = provider({
      experimental: true,
      validation: validation({ meanIoU: 0.61, meanBoundaryF: 0.62 }),
    });
    const selected = routePromptedSelection({
      ...base,
      preference: 'auto',
      preferredProviderId: MOBILE_SAM_PROVIDER_ID,
      allowExperimentalProvider: true,
      providers: [sam2Stronger, explicitMobile],
    });

    expect(selected.providerId).toBe(MOBILE_SAM_PROVIDER_ID);
    expect(selected.reason).toMatch(/explicit provider choice/i);
    expect(selected.candidates).toHaveLength(1);

    const refused = routePromptedSelection({
      ...base,
      preference: 'auto',
      preferredProviderId: MOBILE_SAM_PROVIDER_ID,
      allowExperimentalProvider: true,
      safeWorkingSetBytes: 64 * 1024 * 1024,
      providers: [sam2Stronger, explicitMobile],
    });
    expect(refused.providerId).toBeNull();
    expect(refused.rejected).toEqual([
      expect.objectContaining({
        providerId: MOBILE_SAM_PROVIDER_ID,
        code: 'exceeds-hard-budget',
      }),
    ]);
    expect(refused.reason).toMatch(/no other provider was selected automatically/i);
  });

  it('does not enable an experimental provider without the explicit opt-in flag', () => {
    const experimentalMobile = provider({ experimental: true });
    const decision = routePromptedSelection({
      ...base,
      preference: 'auto',
      preferredProviderId: MOBILE_SAM_PROVIDER_ID,
      providers: [sam2Stronger, experimentalMobile],
    });

    expect(decision.providerId).toBeNull();
    expect(decision.rejected[0]).toEqual(
      expect.objectContaining({
        providerId: MOBILE_SAM_PROVIDER_ID,
        code: 'experimental-provider',
      }),
    );
  });

  it('never lets a validated-elsewhere provider without corpus evidence outrank a validated provider', () => {
    const unvalidated = provider({
      id: 'unknown-provider',
      label: 'Unknown provider',
      encoderId: 'unknown-encoder',
      decoderId: 'unknown-decoder',
      validation: undefined,
      warmPromptP95Ms: 10,
      workingSetBytes: 50 * 1024 * 1024,
    });
    const decision = routePromptedSelection({
      ...base,
      preference: 'auto',
      providers: [unvalidated, fastWeaker],
    });
    expect(decision.providerId).toBe(MOBILE_SAM_PROVIDER_ID);
    expect(decision.rejected.find((item) => item.providerId === 'unknown-provider')?.code).toBe(
      'unvalidated',
    );
  });

  it('rejects a provider whose critical-category floor fails even when its mean quality is high', () => {
    const thinFailure = provider({
      id: SAM2_PROVIDER_ID,
      label: 'Higher-detail prompted selection',
      encoderId: SAM2_ENCODER_ID,
      decoderId: SAM2_DECODER_ID,
      validation: validation({
        meanIoU: 0.9,
        meanBoundaryF: 0.9,
        worstCriticalIoU: 0.2,
        categoryIoU: {
          'thin-geometry': 0.2,
          'tiny-object': 0.9,
          'touches-edge': 0.9,
          'hair-fur': 0.9,
        },
      }),
    });
    const decision = routePromptedSelection({
      ...base,
      preference: 'auto',
      providers: [thinFailure, fastWeaker],
    });
    expect(decision.providerId).toBe(MOBILE_SAM_PROVIDER_ID);
    const rejection = decision.rejected.find((item) => item.providerId === SAM2_PROVIDER_ID);
    expect(rejection?.code).toBe('below-quality-floor');
    expect(rejection?.reason).toMatch(/thin-geometry|critical/i);
  });

  it('rejects an otherwise-favoured provider that cannot execute on this runtime', () => {
    const webgpuOnly = provider({
      id: SAM2_PROVIDER_ID,
      label: 'Higher-detail prompted selection',
      encoderId: SAM2_ENCODER_ID,
      decoderId: SAM2_DECODER_ID,
      supportedExecutionProviders: ['webgpu'],
    });
    const decision = routePromptedSelection({
      ...base,
      preference: 'auto',
      providers: [fastWeaker, webgpuOnly],
    });
    expect(decision.providerId).toBe(MOBILE_SAM_PROVIDER_ID);
    expect(decision.rejected.find((item) => item.providerId === SAM2_PROVIDER_ID)?.code).toBe(
      'unsupported-runtime',
    );
  });

  it('rejects a provider that lacks a required prompt capability', () => {
    const noMask = provider({
      id: 'efficient-sam-ti',
      label: 'Experimental EfficientSAM',
      encoderId: 'efficient-sam-ti-encoder',
      decoderId: 'efficient-sam-ti-decoder',
      capabilities: { ...ALL_CAPABILITIES, maskPrompts: false },
    });
    const decision = routePromptedSelection({
      ...base,
      preference: 'auto',
      requiredCapabilities: { maskPrompts: true },
      providers: [noMask, fastWeaker],
    });
    expect(decision.providerId).toBe(MOBILE_SAM_PROVIDER_ID);
    expect(decision.rejected.find((item) => item.providerId === 'efficient-sam-ti')?.code).toBe(
      'missing-capability',
    );
  });

  it('reports a missing model as an installation issue, never an automatic download', () => {
    const decision = routePromptedSelection({
      ...base,
      preference: 'auto',
      providers: [fastWeaker, sam2Stronger].map((item) => ({ ...item, installed: false })),
    });
    expect(decision.providerId).toBeNull();
    expect(decision.rejected.map((item) => item.code)).toEqual(['not-installed', 'not-installed']);
    expect(decision.reason).toMatch(/install|download/i);
  });

  it('resolves identical quality and performance deterministically by stable provider id', () => {
    const twinA = provider({ id: 'alpha-provider' as PromptedProviderFact['id'] });
    const twinB = provider({ id: 'beta-provider' as PromptedProviderFact['id'] });
    const forward = routePromptedSelection({
      ...base,
      preference: 'auto',
      providers: [twinB, twinA],
    });
    const reversed = routePromptedSelection({
      ...base,
      preference: 'auto',
      providers: [twinA, twinB],
    });
    expect(forward.providerId).toBe('alpha-provider');
    expect(reversed.providerId).toBe('alpha-provider');
  });
});

describe('prompted selection routing — fast, balanced, and quality preferences', () => {
  it('fast selects the lower-latency validated provider even when quality is lower', () => {
    const decision = routePromptedSelection({
      ...base,
      preference: 'fast',
      providers: [sam2Stronger, fastWeaker],
    });
    expect(decision.providerId).toBe(MOBILE_SAM_PROVIDER_ID);
    expect(decision.reason).toMatch(/speed|latency|fast/i);
  });

  it('fast still refuses a provider below the validated quality floor', () => {
    const unusable = provider({
      id: 'unusable',
      label: 'Unusable',
      encoderId: 'unusable-encoder',
      decoderId: 'unusable-decoder',
      warmPromptP95Ms: 1,
      validation: validation({
        meanIoU: 0.2,
        meanBoundaryF: 0.2,
        worstCriticalIoU: 0.2,
        worstCriticalBoundaryF: 0.2,
      }),
    });
    const decision = routePromptedSelection({
      ...base,
      preference: 'fast',
      providers: [unusable, fastWeaker],
    });
    expect(decision.providerId).toBe(MOBILE_SAM_PROVIDER_ID);
    expect(decision.rejected.find((item) => item.providerId === 'unusable')?.code).toBe(
      'below-quality-floor',
    );
  });

  it('quality ignores the warm cache when the warm provider is materially worse', () => {
    const decision = routePromptedSelection({
      ...base,
      preference: 'quality',
      cachedEmbeddingProvider: MOBILE_SAM_PROVIDER_ID,
      providers: [fastWeaker, sam2Stronger],
    });
    expect(decision.providerId).toBe(SAM2_PROVIDER_ID);
    expect(decision.reason).toMatch(/quality preference/i);
  });

  it('balanced prefers a materially faster provider only when quality is close', () => {
    const closeQuality = provider({
      id: SAM2_PROVIDER_ID,
      label: 'Higher-detail prompted selection',
      encoderId: SAM2_ENCODER_ID,
      decoderId: SAM2_DECODER_ID,
      warmPromptP95Ms: 200,
      workingSetBytes: 400 * 1024 * 1024,
      validation: validation({
        meanIoU: 0.61,
        meanBoundaryF: 0.61,
        worstCriticalIoU: 0.7,
        worstCriticalBoundaryF: 0.7,
      }),
    });
    const decision = routePromptedSelection({
      ...base,
      preference: 'balanced',
      providers: [fastWeaker, closeQuality],
    });
    expect(decision.providerId).toBe(SAM2_PROVIDER_ID);
    expect(decision.reason).toMatch(/balanced/i);
  });

  it('balanced keeps the materially better-quality provider', () => {
    const decision = routePromptedSelection({
      ...base,
      preference: 'balanced',
      providers: [fastWeaker, sam2Stronger],
    });
    expect(decision.providerId).toBe(SAM2_PROVIDER_ID);
  });
});

describe('prompted selection routing — diagnostics', () => {
  it('explains every rejection and the winning rank reason in structured evidence', () => {
    const decision = routePromptedSelection({
      ...base,
      safeWorkingSetBytes: 500 * 1024 * 1024,
      preference: 'auto',
      cachedEmbeddingProvider: MOBILE_SAM_PROVIDER_ID,
      providers: [fastWeaker, sam2Stronger],
    });
    expect(decision.candidates).toHaveLength(2);
    const winner = decision.candidates.find(
      (candidate) => candidate.providerId === decision.providerId,
    );
    expect(winner?.eligible).toBe(true);
    expect(winner?.warm).toBe(true);
    expect(winner?.validatedMeanIoU).toBeCloseTo(0.6, 5);
    expect(winner?.estimatedWorkingSetBytes).toBeGreaterThan(380 * 1024 * 1024);
    expect(decision.qualitySource).toBe('validated-corpus');
    expect(decision.rejected.every((item) => item.reason.length > 0)).toBe(true);
  });
});
