import { describe, expect, it } from 'vitest';
import {
  assessGenerativeEditResources,
  chooseExpandGenerationStrategy,
  GenerativeEditError,
  GenerativeJobController,
  getGenerativeEditCapabilities,
  runGenerativeEdit,
} from './index';

function makeImage(width = 12, height = 12): ImageData {
  const image = new ImageData(width, height);
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = 40;
    image.data[i + 1] = 80;
    image.data[i + 2] = 120;
    image.data[i + 3] = 255;
  }
  return image;
}

function request(overrides: Partial<Parameters<typeof runGenerativeEdit>[0]> = {}) {
  const mask = new Uint8Array(144);
  mask[5 * 12 + 5] = 255;
  return {
    mode: 'remove' as const,
    imageData: makeImage(),
    mask,
    maskWidth: 12,
    maskHeight: 12,
    quality: 'draft' as const,
    seed: 4,
    ...overrides,
  };
}

describe('generative edit capabilities', () => {
  it('keeps promptless reconstruction and model-backed coherence distinct', () => {
    expect(chooseExpandGenerationStrategy(768, 768, 'ai', true)).toBe('coherent-full-frame');
    expect(chooseExpandGenerationStrategy(768, 768, 'ai', false)).toBe('staged-border');
  });

  it('exposes the honest local provider boundary', () => {
    const capabilities = getGenerativeEditCapabilities();
    expect(capabilities).toMatchObject({
      fill: true,
      remove: true,
      replace: false,
      expand: false,
      prompt: false,
    });
    expect(capabilities.modes.remove).toMatchObject({
      available: true,
      ready: true,
      prompt: false,
      variations: false,
    });
    expect(capabilities.modes.replace).toMatchObject({
      available: false,
      ready: false,
      reasonCode: 'runtime-unavailable',
    });
    expect(capabilities.modes.expand).toMatchObject({
      available: false,
      ready: false,
      reasonCode: 'runtime-unavailable',
    });
    expect(capabilities.modes.remove.supportedParameters).toEqual(
      expect.arrayContaining(['contextPadding', 'maskExpansion', 'feather']),
    );
    expect(capabilities.modes.remove.limits.maxVariations).toBe(1);
    expect(capabilities.resourceProfile).toEqual(
      expect.objectContaining({
        executionBackend: expect.any(String),
        tier: expect.any(String),
      }),
    );
  });

  it('refuses a browser model request when its safe peak budget is too small', () => {
    const assessment = assessGenerativeEditResources({
      mode: 'fill',
      width: 512,
      height: 512,
      quality: 'quality',
      requiresDiffusion: false,
      profile: {
        tier: 'constrained',
        executionBackend: 'wasm',
        safePeakBytes: 100 * 1024 * 1024,
        summary: 'test',
      },
    });
    expect(assessment).toMatchObject({
      allowed: false,
      reasonCode: 'insufficient-memory',
      fallback: 'quick-cleanup',
    });
  });

  it('leaves native requests to the authoritative desktop preflight', () => {
    const assessment = assessGenerativeEditResources({
      mode: 'replace',
      width: 512,
      height: 512,
      quality: 'quality',
      requiresDiffusion: true,
      profile: {
        tier: 'unknown',
        executionBackend: 'native',
        summary: 'native test',
      },
    });
    expect(assessment.allowed).toBe(true);
    expect(assessment.estimatedPeakBytes).toBeGreaterThan(6 * 1024 ** 3);
  });

  it('budgets the bounded context instead of a large source frame', () => {
    const assessment = assessGenerativeEditResources({
      mode: 'fill',
      width: 33_000,
      height: 22_000,
      workingWidth: 256,
      workingHeight: 192,
      quality: 'quality',
      requiresDiffusion: false,
      profile: {
        tier: 'standard',
        executionBackend: 'wasm',
        safePeakBytes: 500 * 1024 * 1024,
        summary: 'test',
      },
    });

    expect(assessment.allowed).toBe(true);
    expect(assessment.estimatedPeakBytes).toBeLessThan(500 * 1024 * 1024);
  });

  it('keeps the browser safe-peak guard active when memory is unknown', () => {
    const assessment = assessGenerativeEditResources({
      mode: 'fill',
      width: 1024,
      height: 1024,
      quality: 'quality',
      requiresDiffusion: false,
      profile: {
        tier: 'unknown',
        executionBackend: 'wasm',
        safePeakBytes: 100 * 1024 * 1024,
        summary: 'privacy-preserving browser',
      },
    });

    expect(assessment).toMatchObject({
      allowed: false,
      reasonCode: 'insufficient-memory',
      fallback: 'quick-cleanup',
    });
  });

  it('refuses semantic diffusion on a constrained 4 GiB browser before allocation', () => {
    const assessment = assessGenerativeEditResources({
      mode: 'replace',
      width: 512,
      height: 512,
      quality: 'quality',
      requiresDiffusion: true,
      profile: {
        tier: 'constrained',
        platform: 'chromeos',
        architecture: 'arm64',
        executionBackend: 'wasm',
        safePeakBytes: 4 * 1024 ** 3,
        summary: '4 GiB ARM Chromebook',
      },
    });

    expect(assessment).toMatchObject({
      allowed: false,
      reasonCode: 'insufficient-memory',
      fallback: 'content-aware-fill',
    });
  });

  it('rejects prompt-only modes until a verified provider exists', async () => {
    await expect(runGenerativeEdit(request({ mode: 'replace' }))).rejects.toMatchObject({
      code: 'unsupported-mode',
    });
  });

  it('does not route browser Expand through the unqualified heuristic fallback', async () => {
    await expect(
      runGenerativeEdit(
        request({
          mode: 'expand',
          mask: new Uint8Array(144).fill(255),
          maskWidth: 12,
          maskHeight: 12,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'unsupported-mode',
    });
  });

  it('rejects malformed and empty masks before inference', async () => {
    await expect(runGenerativeEdit(request({ mask: new Uint8Array(3) }))).rejects.toMatchObject({
      code: 'invalid-mask',
    });
    await expect(runGenerativeEdit(request({ mask: new Uint8Array(144) }))).rejects.toMatchObject({
      code: 'empty-mask',
    });
  });

  it('returns a local deterministic result and keeps prompt usage explicit', async () => {
    const first = await runGenerativeEdit(request({ prompt: 'a red chair' }));
    const second = await runGenerativeEdit(request({ prompt: 'a blue chair' }));
    expect(first.provider.kind).toBe('local');
    expect(first.provider.id).toBe('varve-quick-cleanup');
    expect(first.provider.runtime).toBe('patchmatch');
    expect(first.warnings[0]).toContain('does not use prompts');
    expect(Array.from(first.imageData.data)).toEqual(Array.from(second.imageData.data));
  });
});

describe('GenerativeJobController', () => {
  it('invalidates cancelled and stale source jobs', () => {
    const jobs = new GenerativeJobController();
    const token = jobs.start(3);
    expect(jobs.isCurrent(token, 3)).toBe(true);
    expect(jobs.isCurrent(token, 4)).toBe(false);
    jobs.cancel();
    expect(jobs.isCurrent(token, 3)).toBe(false);
  });

  it('only completes the current job', () => {
    const jobs = new GenerativeJobController();
    const first = jobs.start(1);
    const second = jobs.start(1);
    expect(jobs.complete(first, 1)).toBe(false);
    expect(jobs.complete(second, 1)).toBe(true);
    expect(jobs.getState().status).toBe('completed');
  });

  it('rejects a result when any source-affecting snapshot field changes', () => {
    const jobs = new GenerativeJobController();
    const snapshot = {
      documentId: 'doc-1',
      targetId: 'image-1',
      sourceRevision: 1,
      sourceAssetId: 'asset-source',
      sourceHash: 'hash-source',
      placementFingerprint: 'placement-1',
      maskRevision: 2,
      settingsFingerprint: 'settings-1',
      outputFrameFingerprint: 'frame-1',
    } as const;
    const token = jobs.start(snapshot);
    expect(jobs.isCurrent(token, snapshot)).toBe(true);
    expect(jobs.isCurrent(token, { ...snapshot, maskRevision: 3 })).toBe(false);
    expect(jobs.complete(token, { ...snapshot, sourceHash: 'changed' })).toBe(false);
    expect(jobs.getState().status).toBe('queued');
  });

  it('uses a typed error for unsupported work', () => {
    const error = new GenerativeEditError('unsupported-mode', 'not available');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('unsupported-mode');
  });

  it('records explanatory cancellation errors as cancelled state', () => {
    const jobs = new GenerativeJobController();
    const token = jobs.start(1);
    expect(
      jobs.fail(token, new GenerativeEditError('cancelled', 'The native helper was stopped.')),
    ).toBe(true);
    expect(jobs.getState()).toMatchObject({ status: 'cancelled', error: expect.any(Error) });
  });

  it('maps cancellation errors from shared admission to cancelled state', () => {
    const jobs = new GenerativeJobController();
    const token = jobs.start(1);
    const error = Object.assign(new Error('Inference request was cancelled while waiting.'), {
      code: 'cancelled',
    });

    expect(jobs.fail(token, error)).toBe(true);
    expect(jobs.getState().status).toBe('cancelled');
  });
});
