import { describe, expect, it } from 'vitest';
import { isWasmModelSafe } from '../inference/core/RuntimeCapabilities';
import { getModelById } from '../inference/modelCatalog';
import { assessImageInferenceResources } from '../inference/resourcePolicy';
import {
  EFFICIENT_SAM_PROVIDER_ID,
  MOBILE_SAM_PROVIDER_ID,
  type PromptedProviderFact,
  routePromptedSelection,
  SAM2_PROVIDER_ID,
} from './promptedRouting';
import {
  EFFICIENT_SAM_CAPABILITIES,
  EFFICIENT_SAM_QUALITY_VALIDATION,
  MOBILE_SAM_CAPABILITIES,
  MOBILE_SAM_QUALITY_VALIDATION,
  SAM2_CAPABILITIES,
  SAM2_QUALITY_VALIDATION,
} from './providerValidation';

function providerFacts(): PromptedProviderFact[] {
  return [
    {
      id: SAM2_PROVIDER_ID,
      label: 'SAM2 Hiera Tiny',
      encoderId: 'sam2-encoder',
      decoderId: 'sam2-decoder',
      installed: true,
      workingSetBytes: 600_000_000,
      warmPromptP95Ms: 1068,
      capabilities: SAM2_CAPABILITIES,
      validation: SAM2_QUALITY_VALIDATION,
      supportedExecutionProviders: ['wasm', 'webgpu'],
    },
    {
      id: MOBILE_SAM_PROVIDER_ID,
      label: 'MobileSAM',
      encoderId: 'mobile-sam-encoder',
      decoderId: 'mobile-sam-decoder',
      installed: true,
      workingSetBytes: 250_000_000,
      warmPromptP95Ms: 485,
      experimental: true,
      capabilities: MOBILE_SAM_CAPABILITIES,
      validation: MOBILE_SAM_QUALITY_VALIDATION,
      supportedExecutionProviders: ['wasm'],
    },
    {
      id: EFFICIENT_SAM_PROVIDER_ID,
      label: 'EfficientSAM-Ti',
      encoderId: 'efficient-sam-encoder',
      decoderId: 'efficient-sam-decoder',
      installed: true,
      workingSetBytes: 900_000_000,
      experimental: true,
      capabilities: EFFICIENT_SAM_CAPABILITIES,
      validation: EFFICIENT_SAM_QUALITY_VALIDATION,
      supportedExecutionProviders: ['wasm'],
    },
  ];
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    preference: 'auto' as const,
    sourceWidth: 1280,
    sourceHeight: 853,
    executionProvider: 'wasm' as const,
    safeWorkingSetBytes: 3_000_000_000,
    providers: providerFacts(),
    ...overrides,
  };
}

describe('experimental provider boundaries', () => {
  it('never selects MobileSAM or EfficientSAM for automatic routing', () => {
    for (const preference of ['auto', 'fast', 'balanced', 'quality'] as const) {
      const decision = routePromptedSelection(request({ preference }));
      expect(decision.providerId).not.toBe(MOBILE_SAM_PROVIDER_ID);
      expect(decision.providerId).not.toBe(EFFICIENT_SAM_PROVIDER_ID);
      if (preference !== 'fast') {
        expect(decision.providerId).toBe(SAM2_PROVIDER_ID);
      }
      const mobileRejection = decision.rejected.find(
        (rejection) => rejection.providerId === MOBILE_SAM_PROVIDER_ID,
      );
      expect(mobileRejection?.code).toBe('experimental-provider');
    }
  });

  it('keeps the boundary on the discovery-to-segmentation box prompt path', () => {
    const decision = routePromptedSelection(
      request({ requiredCapabilities: { boxPrompts: true } }),
    );
    expect(decision.providerId).toBe(SAM2_PROVIDER_ID);
    expect(
      decision.rejected.some(
        (rejection) =>
          rejection.providerId === MOBILE_SAM_PROVIDER_ID &&
          rejection.code === 'experimental-provider',
      ),
    ).toBe(true);
  });

  it('does not fall back to MobileSAM when the validated provider cannot run', () => {
    // SAM2 cannot fit, MobileSAM would; the router must refuse rather than
    // silently promote the experimental provider.
    const overBudget = routePromptedSelection(request({ safeWorkingSetBytes: 500_000_000 }));
    expect(overBudget.providerId).toBeNull();
    expect(overBudget.rejected.some((rejection) => rejection.providerId === SAM2_PROVIDER_ID)).toBe(
      true,
    );
    expect(
      overBudget.rejected.some(
        (rejection) =>
          rejection.providerId === MOBILE_SAM_PROVIDER_ID &&
          rejection.code === 'experimental-provider',
      ),
    ).toBe(true);

    const unsupportedRuntime = routePromptedSelection(
      request({
        executionProvider: 'webgpu',
        providers: providerFacts().map((provider) =>
          provider.id === SAM2_PROVIDER_ID
            ? { ...provider, supportedExecutionProviders: ['wasm'] }
            : provider,
        ),
      }),
    );
    expect(unsupportedRuntime.providerId).toBeNull();
  });

  it('allows an explicit, informed MobileSAM selection only with the opt-in flag', () => {
    const explicit = routePromptedSelection(
      request({ preferredProviderId: MOBILE_SAM_PROVIDER_ID, allowExperimentalProvider: true }),
    );
    expect(explicit.providerId).toBe(MOBILE_SAM_PROVIDER_ID);

    const withoutOptIn = routePromptedSelection(
      request({ preferredProviderId: MOBILE_SAM_PROVIDER_ID }),
    );
    expect(withoutOptIn.providerId).toBeNull();
    expect(withoutOptIn.rejected[0]?.code).toBe('experimental-provider');
  });

  it('keeps the opt-in scoped to the explicitly requested provider', () => {
    // An opt-in flag must not make every experimental provider eligible.
    const decision = routePromptedSelection(
      request({ preferredProviderId: SAM2_PROVIDER_ID, allowExperimentalProvider: true }),
    );
    expect(decision.providerId).toBe(SAM2_PROVIDER_ID);
  });
});

describe('text discovery admission gates', () => {
  it('refuses the detector before download on a low-memory runtime', () => {
    const refused = assessImageInferenceResources({
      width: 800,
      height: 800,
      modelPeakBytes: 2_600_000_000,
      runtime: { wasmSafePeakBytes: 1_200_000_000 },
      operation: 'Text discovery',
    });
    expect(refused.allowed).toBe(false);
    expect(refused.reasonCode).toBe('insufficient-memory');
    expect(refused.reason).toContain('Text discovery');

    const allowed = assessImageInferenceResources({
      width: 800,
      height: 800,
      modelPeakBytes: 2_600_000_000,
      runtime: { wasmSafePeakBytes: 3_000_000_000 },
      operation: 'Text discovery',
    });
    expect(allowed.allowed).toBe(true);
  });

  it('keeps the detector artifact explicit-download only', () => {
    const entry = getModelById('grounding-dino-tiny');
    expect(entry).toBeDefined();
    expect(entry?.bundled).toBe(false);
    expect(entry?.peakMemoryBytes).toBeGreaterThanOrEqual(2_600_000_000);
  });

  it('refuses the WASM fallback for the detector under default budgets', async () => {
    // Node defaults to a 2 GB coarse memory tier and no cross-origin
    // isolation, so the 2.6 GB graph must not pass the WASM safety gate.
    await expect(isWasmModelSafe('grounding-dino-tiny')).resolves.toBe(false);
  });
});
