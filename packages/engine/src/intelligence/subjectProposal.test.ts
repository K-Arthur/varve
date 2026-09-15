// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

const { mockRemoveBackground } = vi.hoisted(() => ({
  mockRemoveBackground: vi.fn(),
}));

vi.mock('../backgroundRemoval', () => ({
  removeBackground: mockRemoveBackground,
}));

import {
  decideSubjectRouting,
  isBundledSubjectModel,
  methodForSubjectModel,
  modelForSubjectQuality,
  proposalSetFromAlpha,
  proposeSubjects,
  SubjectProposalUnavailableError,
  type SubjectRoutingRequest,
  subjectModelLabel,
} from './subjectProposal';

const BASE_ROUTING: SubjectRoutingRequest = {
  quality: 'fast',
  installedModelIds: ['u2netp'],
  runtime: { isTauri: false, nativeReady: false, safePeakBytes: 4_000_000_000 },
  sourceWidth: 512,
  sourceHeight: 512,
};

function alphaWithCircles(
  width: number,
  height: number,
  circles: Array<{ cx: number; cy: number; r: number }>,
): Uint8Array {
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (const circle of circles) {
        if ((x - circle.cx) ** 2 + (y - circle.cy) ** 2 <= circle.r ** 2) {
          alpha[y * width + x] = 255;
        }
      }
    }
  }
  return alpha;
}

describe('subject proposal routing', () => {
  it('fast uses the bundled model and never plans a download', () => {
    const plan = decideSubjectRouting(BASE_ROUTING);
    expect(plan.attempts.map((a) => a.modelId)).toEqual(['u2netp']);
    expect(plan.attempts[0]).toMatchObject({ native: false, steppedDown: false });
    expect(plan.install).toBeUndefined();
    expect(isBundledSubjectModel('u2netp')).toBe(true);
  });

  it('balanced prefers installed IS-Net and steps down to the bundled model otherwise', () => {
    const installed = decideSubjectRouting({
      ...BASE_ROUTING,
      quality: 'balanced',
      installedModelIds: ['u2netp', 'isnet-general-use'],
    });
    expect(installed.attempts.map((a) => a.modelId)).toEqual(['isnet-general-use', 'u2netp']);
    expect(installed.attempts[0]?.steppedDown).toBe(false);
    expect(installed.attempts[1]?.steppedDown).toBe(true);
    expect(installed.install).toBeUndefined();

    const missing = decideSubjectRouting({ ...BASE_ROUTING, quality: 'balanced' });
    expect(missing.attempts.map((a) => a.modelId)).toEqual(['u2netp']);
    expect(missing.attempts[0]?.steppedDown).toBe(true);
    expect(missing.attempts[0]?.reason).toContain('IS-Net');
    expect(missing.install?.modelId).toBe('isnet-general-use');
    expect(missing.install?.downloadBytes).toBeGreaterThan(0);
  });

  it('high prefers BiRefNet Lite, then installed IS-Net, then the bundled model', () => {
    const birefnet = decideSubjectRouting({
      ...BASE_ROUTING,
      quality: 'high',
      installedModelIds: ['u2netp', 'isnet-general-use', 'birefnet-general-lite'],
      // BiRefNet Lite's catalog working set needs a high-memory runtime; on a
      // 4 GB browser budget it is rejected and the plan steps down.
      runtime: { ...BASE_ROUTING.runtime, safePeakBytes: 16_000_000_000 },
    });
    expect(birefnet.attempts.map((a) => a.modelId)).toEqual([
      'birefnet-general-lite',
      'isnet-general-use',
      'u2netp',
    ]);
    expect(birefnet.attempts[0]?.steppedDown).toBe(false);

    const isnet = decideSubjectRouting({
      ...BASE_ROUTING,
      quality: 'high',
      installedModelIds: ['u2netp', 'isnet-general-use'],
    });
    expect(isnet.attempts.map((a) => a.modelId)).toEqual(['isnet-general-use', 'u2netp']);
    expect(isnet.attempts[0]?.steppedDown).toBe(true);
    expect(isnet.install?.modelId).toBe('birefnet-general-lite');
    expect(isnet.rejected.map((r) => r.modelId)).toContain('birefnet-general-lite');

    const bundled = decideSubjectRouting({ ...BASE_ROUTING, quality: 'high' });
    expect(bundled.attempts.map((a) => a.modelId)).toEqual(['u2netp']);
    expect(bundled.install?.modelId).toBe('birefnet-general-lite');
  });

  it('rejects models that do not fit the runtime budget and falls back to model-free', () => {
    const plan = decideSubjectRouting({
      ...BASE_ROUTING,
      quality: 'high',
      installedModelIds: ['u2netp', 'isnet-general-use', 'birefnet-general-lite'],
      runtime: { isTauri: false, nativeReady: false, safePeakBytes: 1 },
    });
    expect(plan.attempts).toHaveLength(0);
    expect(plan.fallbackSource).toBe('model-free');
    expect(plan.fallbackReason).toContain('safe inference budget');
  });

  it('admits native execution without the bare-WASM budget gate', () => {
    const plan = decideSubjectRouting({
      ...BASE_ROUTING,
      quality: 'balanced',
      installedModelIds: ['u2netp', 'isnet-general-use'],
      runtime: { isTauri: true, nativeReady: true, safePeakBytes: 1 },
    });
    expect(plan.attempts).toHaveLength(1);
    expect(plan.attempts[0]).toMatchObject({
      modelId: 'isnet-general-use',
      native: true,
      steppedDown: false,
    });
  });

  it('keeps explicit model-free fallback out for bundled-only routes', () => {
    expect(subjectModelLabel('model-free')).toBe('Model-free estimate');
  });

  it('routes portrait intent only to the portrait specialist', () => {
    const plan = decideSubjectRouting({
      ...BASE_ROUTING,
      quality: 'portrait',
      installedModelIds: ['u2netp', 'modnet-portrait'],
    });

    expect(modelForSubjectQuality('portrait')).toBe('modnet-portrait');
    expect(plan.attempts.map((attempt) => attempt.modelId)).toEqual(['modnet-portrait']);
    expect(plan.attempts[0]).toMatchObject({ native: false, steppedDown: false });
    expect(plan.install).toBeUndefined();
    expect(methodForSubjectModel('modnet-portrait')).toBe('portrait');
    expect(subjectModelLabel('modnet-portrait')).toBe('MODNet Portrait');
  });

  it('does not plan a general-model step-down when the portrait specialist is missing', () => {
    const plan = decideSubjectRouting({ ...BASE_ROUTING, quality: 'portrait' });

    expect(plan.attempts).toHaveLength(0);
    expect(plan.fallbackSource).toBe('model-free');
    expect(plan.install).toMatchObject({
      modelId: 'modnet-portrait',
      displayName: 'MODNet Portrait',
    });
    expect(plan.rejected).toEqual([{ modelId: 'modnet-portrait', reason: 'not installed' }]);
  });
});

describe('proposalSetFromAlpha', () => {
  it('returns a soft union candidate and separate region candidates', () => {
    const alpha = alphaWithCircles(64, 64, [
      { cx: 16, cy: 16, r: 8 },
      { cx: 48, cy: 48, r: 8 },
    ]);
    const set = proposalSetFromAlpha(alpha, 64, 64);
    expect(set.candidates.map((c) => c.label)).toEqual(['All foreground', 'Region 1', 'Region 2']);
    expect(set.candidates[0]?.alpha).toBe(alpha);
    expect(set.candidates[0]?.coverage).toBeGreaterThan(0.05);
    // Region masks are binary and disjoint.
    const region1 = set.candidates[1]!.mask;
    const region2 = set.candidates[2]!.mask;
    expect(set.candidates[1]?.alpha).toBeDefined();
    for (let index = 0; index < region1.length; index += 1) {
      expect((region1[index] ?? 0) === 0 || (region2[index] ?? 0) === 0).toBe(true);
    }
  });

  it('keeps region selections binary while retaining the provider soft edge separately', () => {
    const alpha = new Uint8Array(32 * 32);
    for (let y = 8; y < 24; y += 1) {
      for (let x = 8; x < 16; x += 1) alpha[y * 32 + x] = 255;
      for (let x = 20; x < 28; x += 1) alpha[y * 32 + x] = 255;
    }
    // This soft value belongs to the first hard component. It must remain
    // available to Apply as mask without turning the selection candidate into
    // a soft mask.
    alpha[16 * 32 + 8] = 192;

    const set = proposalSetFromAlpha(alpha, 32, 32);
    const firstRegion = set.candidates[1];
    expect(firstRegion?.alpha?.[16 * 32 + 8]).toBe(192);
    expect(firstRegion?.mask[16 * 32 + 8]).toBe(255);
    expect(firstRegion?.mask.some((value) => value !== 0 && value !== 255)).toBe(false);
  });

  it('does not duplicate the union when there is one component', () => {
    const alpha = alphaWithCircles(64, 64, [{ cx: 32, cy: 32, r: 12 }]);
    const set = proposalSetFromAlpha(alpha, 64, 64);
    expect(set.candidates.map((c) => c.label)).toEqual(['All foreground']);
  });

  it('reports no-subject for an empty alpha', () => {
    const set = proposalSetFromAlpha(new Uint8Array(16 * 16), 16, 16);
    expect(set.candidates).toHaveLength(0);
    expect(set.emptyReason).toBe('no-subject');
  });

  it('rejects a near-full-frame model result instead of offering the whole image as a subject', () => {
    const alpha = new Uint8Array(32 * 32).fill(255);
    alpha[0] = 0;
    const set = proposalSetFromAlpha(alpha, 32, 32);
    expect(set.candidates).toHaveLength(0);
    expect(set.emptyReason).toBe('ambiguous-subject');
  });
});

describe('proposeSubjects', () => {
  function imageData(width: number, height: number): ImageData {
    return new ImageData(new Uint8ClampedArray(width * height * 4), width, height);
  }

  it('runs the planned model with an explicit id and returns soft candidates', async () => {
    mockRemoveBackground.mockReset().mockResolvedValue({
      maskDataUrl: 'data:image/png;base64,x',
      confidence: 0.9,
      method: 'ai-balanced',
      processingTimeMs: 5,
      width: 32,
      height: 32,
      rawMask: alphaWithCircles(32, 32, [{ cx: 10, cy: 10, r: 5 }]),
    });

    const result = await proposeSubjects({
      ...BASE_ROUTING,
      quality: 'fast',
      sourceWidth: 32,
      sourceHeight: 32,
      imageData: imageData(32, 32),
    });

    expect(result.source).toBe('u2netp');
    expect(result.modelId).toBe('u2netp');
    expect(result.set.candidates[0]?.label).toBe('All foreground');
    expect(mockRemoveBackground).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: 'ai-balanced', modelId: 'u2netp' }),
      undefined,
    );
  });

  it('uses the portrait removal method and exact model id for portrait intent', async () => {
    mockRemoveBackground.mockReset().mockResolvedValue({
      maskDataUrl: 'data:image/png;base64,x',
      confidence: 0.9,
      method: 'portrait',
      processingTimeMs: 5,
      width: 32,
      height: 32,
      rawMask: alphaWithCircles(32, 32, [{ cx: 10, cy: 10, r: 5 }]),
    });

    const result = await proposeSubjects({
      ...BASE_ROUTING,
      quality: 'portrait',
      installedModelIds: ['u2netp', 'modnet-portrait'],
      sourceWidth: 32,
      sourceHeight: 32,
      imageData: imageData(32, 32),
      allowModelFreeFallback: false,
    });

    expect(result.source).toBe('modnet-portrait');
    expect(result.modelId).toBe('modnet-portrait');
    expect(mockRemoveBackground).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: 'portrait', modelId: 'modnet-portrait' }),
      undefined,
    );
  });

  it('retains the portrait install plan when strict routing has no model', async () => {
    mockRemoveBackground.mockReset();
    await expect(
      proposeSubjects({
        ...BASE_ROUTING,
        quality: 'portrait',
        sourceWidth: 32,
        sourceHeight: 32,
        imageData: imageData(32, 32),
        allowModelFreeFallback: false,
      }),
    ).rejects.toMatchObject({
      name: 'SubjectProposalUnavailableError',
      plan: {
        install: { modelId: 'modnet-portrait' },
      },
    });
    expect(mockRemoveBackground).not.toHaveBeenCalled();
    expect(SubjectProposalUnavailableError).toBeDefined();
  });

  it('keeps portrait intent fail-closed when the fallback flag is omitted', async () => {
    mockRemoveBackground.mockReset();
    await expect(
      proposeSubjects({
        ...BASE_ROUTING,
        quality: 'portrait',
        sourceWidth: 32,
        sourceHeight: 32,
        imageData: imageData(32, 32),
      }),
    ).rejects.toMatchObject({
      name: 'SubjectProposalUnavailableError',
      plan: { install: { modelId: 'modnet-portrait' } },
    });
    expect(mockRemoveBackground).not.toHaveBeenCalled();
  });

  it('falls back to the model-free estimator with the failure recorded when a model fails', async () => {
    mockRemoveBackground.mockReset().mockRejectedValue(new Error('websocket disconnected'));

    const result = await proposeSubjects({
      ...BASE_ROUTING,
      quality: 'fast',
      sourceWidth: 32,
      sourceHeight: 32,
      imageData: imageData(32, 32),
    });

    expect(result.source).toBe('model-free');
    expect(result.modelId).toBeNull();
    expect(result.attempts[0]).toMatchObject({ modelId: 'u2netp', outcome: 'failed' });
    expect(result.attempts.at(-1)).toMatchObject({ modelId: 'model-free', outcome: 'used' });
  });

  it('keeps only the union candidate on very large sources to bound memory', async () => {
    const width = 2100;
    const height = 2000;
    const alpha = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const first = (x - 300) ** 2 + (y - 300) ** 2 <= 80 * 80;
        const second = (x - 1500) ** 2 + (y - 1200) ** 2 <= 90 * 90;
        if (first || second) alpha[y * width + x] = 255;
      }
    }
    mockRemoveBackground.mockReset().mockResolvedValue({
      maskDataUrl: 'data:image/png;base64,x',
      confidence: 0.9,
      method: 'ai-balanced',
      processingTimeMs: 5,
      width,
      height,
      rawMask: alpha,
    });

    const result = await proposeSubjects({
      ...BASE_ROUTING,
      quality: 'fast',
      sourceWidth: width,
      sourceHeight: height,
      imageData: { data: new Uint8ClampedArray(4), width, height } as ImageData,
    });

    expect(result.set.candidates.map((candidate) => candidate.label)).toEqual(['All foreground']);
  });

  it('never substitutes a different model when the requested one is missing', async () => {
    mockRemoveBackground.mockReset().mockResolvedValue({
      maskDataUrl: 'data:image/png;base64,x',
      confidence: 0,
      method: 'ai-balanced',
      processingTimeMs: 1,
      width: 32,
      height: 32,
      rawMask: new Uint8Array(32 * 32),
    });
    const result = await proposeSubjects({
      ...BASE_ROUTING,
      quality: 'balanced',
      installedModelIds: ['u2netp'],
      sourceWidth: 32,
      sourceHeight: 32,
      imageData: imageData(32, 32),
    });
    // The plan steps down to u2netp and reports it; the run must still be the
    // bundled model the plan chose, never the missing IS-Net.
    expect(result.plan.install?.modelId).toBe('isnet-general-use');
    expect(mockRemoveBackground).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ modelId: 'u2netp' }),
      undefined,
    );
    expect(result.source).toBe('model-free');
  });
});
