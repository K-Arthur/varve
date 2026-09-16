import { describe, expect, it } from 'vitest';
import {
  CURRENT_LOCAL_GENERATIVE_MODEL_PROFILE,
  getLocalGenerativeModelProfile,
  isLocalGenerativeModelRunnable,
  LOCAL_GENERATIVE_MODEL_PROFILES,
  LOCAL_GENERATIVE_MODEL_RESEARCH_PROFILES,
} from './modelProfiles';

describe('local generative model profiles', () => {
  it('keeps the shipped artifact disabled until every local gate passes', () => {
    const profile = CURRENT_LOCAL_GENERATIVE_MODEL_PROFILE;

    expect(profile.disposition).toBe('disabled-unqualified');
    expect(profile.inputKind).toBe('masked-inpainting');
    expect(profile.maskConvention).toBe('white-edit-black-preserve');
    expect(profile.frameContract).toMatchObject({ frameWidth: 512, frameHeight: 512 });
    expect(profile.artifact.requiredComponentRoles).toEqual([
      'sd15-inpainting',
      'clip-vit-l-14',
      'vae',
    ]);
    expect(profile.runtime.executionBackends).toEqual(['native-cpu']);
    expect(profile.qualification).toMatchObject({
      status: 'failed',
      evidenceRef: 'docs/audits/generative-editing-runtime-qualification-2026-09-12.md',
      platforms: [],
    });
    expect(profile.runtime.offlineAfterInstall).toBe(true);
    expect(
      isLocalGenerativeModelRunnable(profile, {
        mode: 'replace',
        executionBackend: 'native-cpu',
        availableMemoryBytes: 32 * 1024 ** 3,
      }),
    ).toMatchObject({ runnable: false });
  });

  it('does not mistake a smaller quantized or sidecar candidate for a runnable provider', () => {
    expect(LOCAL_GENERATIVE_MODEL_RESEARCH_PROFILES.length).toBeGreaterThanOrEqual(3);
    for (const profile of LOCAL_GENERATIVE_MODEL_RESEARCH_PROFILES) {
      expect(profile.disposition).toBe('research-only');
      expect(profile.runtime.executionBackends).toEqual([]);
      expect(
        isLocalGenerativeModelRunnable(profile, {
          mode: 'fill',
          executionBackend: 'native-cpu',
          availableMemoryBytes: 64 * 1024 ** 3,
        }),
      ).toMatchObject({ runnable: false });
    }
  });

  it('resolves only registered profiles and preserves the full mode contract', () => {
    expect(getLocalGenerativeModelProfile('flux-fill-dev-research')?.inputKind).toBe(
      'masked-inpainting',
    );
    expect(getLocalGenerativeModelProfile('powerpaint-v2-1-research')?.frameContract).toMatchObject(
      {
        frameWidth: 512,
        frameHeight: 512,
      },
    );
    expect(getLocalGenerativeModelProfile('does-not-exist')).toBeUndefined();
    expect(LOCAL_GENERATIVE_MODEL_PROFILES).toContain(CURRENT_LOCAL_GENERATIVE_MODEL_PROFILE);
  });

  it('fails closed if a future profile is promoted without platform qualification', () => {
    const hypotheticalQualifiedProfile = {
      ...CURRENT_LOCAL_GENERATIVE_MODEL_PROFILE,
      disposition: 'qualified' as const,
    };

    expect(
      isLocalGenerativeModelRunnable(hypotheticalQualifiedProfile, {
        mode: 'fill',
        executionBackend: 'native-cpu',
        architecture: 'x86_64',
        platform: 'linux-x86_64',
        availableMemoryBytes: 32 * 1024 ** 3,
      }),
    ).toEqual({
      runnable: false,
      reason:
        'Stable Diffusion 1.5 Inpainting · Q4_0 has no passed local quality qualification evidence.',
    });
  });

  it('requires complete local provenance and measured runtime identity before startup', () => {
    const qualifiedProfile = {
      ...CURRENT_LOCAL_GENERATIVE_MODEL_PROFILE,
      disposition: 'qualified' as const,
      runtime: {
        ...CURRENT_LOCAL_GENERATIVE_MODEL_PROFILE.runtime,
        architectures: ['x86_64'],
      },
      qualification: {
        status: 'passed' as const,
        evidenceRef: 'docs/audits/example.md',
        platforms: ['linux-x86_64'],
      },
    };

    expect(
      isLocalGenerativeModelRunnable(qualifiedProfile, {
        mode: 'fill',
        architecture: 'x86_64',
        platform: 'linux-x86_64',
        availableMemoryBytes: 8 * 1024 ** 3,
      }),
    ).toEqual({
      runnable: false,
      reason:
        'Stable Diffusion 1.5 Inpainting · Q4_0 requires an explicitly selected qualified execution backend.',
    });

    expect(
      isLocalGenerativeModelRunnable(qualifiedProfile, {
        mode: 'fill',
        executionBackend: 'native-cpu',
        architecture: 'x86_64',
        platform: 'linux-x86_64',
      }),
    ).toEqual({
      runnable: false,
      reason:
        'Stable Diffusion 1.5 Inpainting · Q4_0 requires a measured available-memory value before startup.',
    });

    expect(
      isLocalGenerativeModelRunnable(qualifiedProfile, {
        mode: 'fill',
        executionBackend: 'native-cpu',
        architecture: 'x86_64',
        platform: 'linux-x86_64',
        availableMemoryBytes: 8 * 1024 ** 3,
      }),
    ).toEqual({ runnable: true });
  });
});
