import { describe, expect, it } from 'vitest';
import { assessGenerativeEditResources } from './resourcePolicy';
import type { GenerativeEditResourceProfile } from './types';

const constrainedBrowserProfile: GenerativeEditResourceProfile = {
  tier: 'constrained',
  platform: 'chromeos',
  architecture: 'arm64',
  executionBackend: 'wasm',
  safePeakBytes: 400_000_000,
  safeModelBytes: 200_000_000,
  summary: 'test profile',
};

describe('generative-edit resource policy', () => {
  it('refuses prompt-conditioned diffusion before allocation on a constrained device', () => {
    const assessment = assessGenerativeEditResources({
      mode: 'replace',
      width: 512,
      height: 512,
      workingWidth: 512,
      workingHeight: 512,
      quality: 'balanced',
      requiresDiffusion: true,
      profile: constrainedBrowserProfile,
    });

    expect(assessment.allowed).toBe(false);
    expect(assessment.reasonCode).toBe('insufficient-memory');
    expect(assessment.fallback).toBe('content-aware-fill');
    expect(assessment.reason).toContain('Quick Cleanup');
  });

  it('budgets a bounded cleanup region instead of the full source photograph', () => {
    const assessment = assessGenerativeEditResources({
      mode: 'remove',
      width: 8256,
      height: 5504,
      workingWidth: 512,
      workingHeight: 512,
      quality: 'quality',
      requiresDiffusion: false,
      profile: constrainedBrowserProfile,
    });

    expect(assessment.allowed).toBe(true);
    expect(assessment.fallback).toBe('none');
    expect(assessment.estimatedPeakBytes).toBeLessThan(300_000_000);
  });

  it('refuses an oversized bounded cleanup region with an actionable fallback', () => {
    const assessment = assessGenerativeEditResources({
      mode: 'remove',
      width: 8256,
      height: 5504,
      workingWidth: 4096,
      workingHeight: 4096,
      quality: 'quality',
      requiresDiffusion: false,
      profile: constrainedBrowserProfile,
    });

    expect(assessment.allowed).toBe(false);
    expect(assessment.reasonCode).toBe('insufficient-memory');
    expect(assessment.fallback).toBe('quick-cleanup');
    expect(assessment.reason).toContain('Quick Cleanup');
  });
});
