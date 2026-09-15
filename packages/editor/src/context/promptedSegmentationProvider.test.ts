import {
  MOBILE_SAM_DECODER_ID,
  MOBILE_SAM_ENCODER_ID,
  MOBILE_SAM_PROVIDER_ID,
  type PromptedRoutingDecision,
  SAM2_DECODER_ID,
  SAM2_ENCODER_ID,
  SAM2_PROVIDER_ID,
} from '@varve/engine';
import { describe, expect, it, vi } from 'vitest';
import {
  rankPromptedMaskCandidates,
  runPromptedSegmentation,
} from './promptedSegmentationProvider';

function decision(
  providerId: typeof MOBILE_SAM_PROVIDER_ID | typeof SAM2_PROVIDER_ID,
): PromptedRoutingDecision {
  const mobile = providerId === MOBILE_SAM_PROVIDER_ID;
  return {
    providerId,
    providerLabel: mobile ? 'Faster prompted selection' : 'Higher-detail prompted selection',
    encoderId: mobile ? MOBILE_SAM_ENCODER_ID : SAM2_ENCODER_ID,
    decoderId: mobile ? MOBILE_SAM_DECODER_ID : SAM2_DECODER_ID,
    reason: 'test route',
    candidates: [],
    rejected: [],
    sourceBytes: 64,
    estimatedWorkingSetBytes: 100,
    qualitySource: 'validated-corpus',
  };
}

function imageData(): ImageData {
  return new ImageData(new Uint8ClampedArray(4 * 4 * 4), 4, 4);
}

describe('prompted segmentation provider adapter', () => {
  it('rejects the highest-IoU mask when it misses the explicit prompts', () => {
    const wrong = new Uint8Array(16);
    wrong.fill(255, 0, 4);
    const right = new Uint8Array(16);
    right[2 * 4 + 2] = 255;
    const ranked = rankPromptedMaskCandidates(
      [
        { mask: wrong, width: 4, height: 4, score: 0.99, scoreSource: 'predicted-iou' },
        { mask: right, width: 4, height: 4, score: 0.8, scoreSource: 'predicted-iou' },
      ],
      { points: [{ x: 0.5, y: 0.5, label: 1 }] },
      4,
      4,
    );

    expect(ranked.candidates).toHaveLength(1);
    expect(ranked.candidates[0]!.promptContainment).toBe(1);
    expect(ranked.selectedIndex).toBe(0);
    expect(ranked.selectedScore).toBe(0.8);
  });

  it('requires background points to stay outside and boxes to overlap the mask', () => {
    const mask = new Uint8Array(16);
    mask[2 * 4 + 2] = 255;
    const ranked = rankPromptedMaskCandidates(
      [{ mask, width: 4, height: 4, score: 0.8, scoreSource: 'predicted-iou' }],
      {
        points: [
          { x: 0.5, y: 0.5, label: 1 },
          { x: 0, y: 0, label: 0 },
        ],
        box: { x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75 },
      },
      4,
      4,
    );

    expect(ranked.candidates[0]!.promptContainment).toBe(1);
    expect(ranked.selectedIndex).toBe(0);
  });

  it('does not return a prediction when every decoded mask misses the prompts', async () => {
    const infer = vi.fn().mockResolvedValueOnce({
      outputs: {
        masks: {
          data: new Float32Array([-1, -1, -1, -1]),
          dims: [1, 1, 2, 2],
        },
        executionProvider: 'wasm',
      },
    });
    const host = { infer } as unknown as Parameters<typeof runPromptedSegmentation>[0]['host'];
    const embedding = {
      providerId: SAM2_PROVIDER_ID,
      tensors: {
        image_embed: { data: new Float32Array(1), dims: [1, 1, 1, 1] },
        high_res_feats_0: { data: new Float32Array(1), dims: [1, 1, 1, 1] },
        high_res_feats_1: { data: new Float32Array(1), dims: [1, 1, 1, 1] },
      },
    };

    await expect(
      runPromptedSegmentation({
        host,
        decision: decision(SAM2_PROVIDER_ID),
        encoderPath: 'sam2-encoder.onnx',
        decoderPath: 'sam2-decoder.onnx',
        imageData: imageData(),
        sourceWidth: 4,
        sourceHeight: 4,
        points: [{ x: 0.5, y: 0.5, label: 1 }],
        embedding,
        signal: new AbortController().signal,
        reservationBytes: 1024,
      }),
    ).rejects.toThrow(/did not honor the supplied prompts/);
  });

  it('runs MobileSAM encoder/decoder graphs through the shared lifecycle', async () => {
    const infer = vi
      .fn()
      .mockResolvedValueOnce({
        outputs: {
          image_embeddings: {
            data: new Float32Array(256 * 64 * 64),
            dims: [1, 256, 64, 64],
          },
          executionProvider: 'wasm',
        },
      })
      .mockResolvedValueOnce({
        outputs: {
          masks: {
            data: new Float32Array([1, 1, -1, -1, -1, 1, -1, 1, 1, 1, -1, -1, -1, -1, 1, 1]),
            dims: [1, 4, 2, 2],
          },
          iou_predictions: { data: new Float32Array([0.7, 1.04, 0.8, 0.6]), dims: [1, 4] },
          executionProvider: 'wasm',
        },
      });
    const host = { infer } as unknown as Parameters<typeof runPromptedSegmentation>[0]['host'];

    const result = await runPromptedSegmentation({
      host,
      decision: decision(MOBILE_SAM_PROVIDER_ID),
      encoderPath: 'mobile-encoder.onnx',
      decoderPath: 'mobile-decoder.onnx',
      imageData: imageData(),
      sourceWidth: 4,
      sourceHeight: 4,
      points: [{ x: 0.25, y: 0.75, label: 0 }],
      box: { x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.9 },
      signal: new AbortController().signal,
      reservationBytes: 1024,
    });

    expect(infer).toHaveBeenCalledTimes(2);
    expect(infer.mock.calls[0]![0]).toMatchObject({
      modelType: 'mobile-sam-encoder',
      modelId: MOBILE_SAM_ENCODER_ID,
    });
    expect(infer.mock.calls[1]![0]).toMatchObject({
      modelType: 'mobile-sam-decoder',
      modelId: MOBILE_SAM_DECODER_ID,
      params: { sourceWidth: 4, sourceHeight: 4 },
    });
    const params = infer.mock.calls[1]![0].params as {
      points: Array<{ x: number; y: number; label: 0 | 1 }>;
      box: { x1: number; y1: number; x2: number; y2: number };
    };
    expect(params.points).toEqual([{ x: 0.25, y: 0.75, label: 0 }]);
    expect(params.box).toEqual({ x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.9 });
    expect(result.candidates).toHaveLength(3);
    expect(result.selectedIndex).toBe(1);
    expect(result.selectedScore).toBeCloseTo(1.04, 5);
    expect(result.scoreSource).toBe('predicted-iou');
    expect(result.candidates.every((candidate) => candidate.promptContainment === 1)).toBe(true);
    expect(result.candidates[0]!.mask.some((value) => value === 255)).toBe(true);
  });

  it('reuses a cached SAM2 embedding and preserves the legacy heuristic score source', async () => {
    const infer = vi.fn().mockResolvedValueOnce({
      outputs: {
        masks: {
          data: new Float32Array([1, 1, -1, -1, -1, 1, -1, 1, 1, 1, -1, -1, -1, -1, 1, 1]),
          dims: [1, 1, 4, 4],
        },
        executionProvider: 'wasm',
      },
    });
    const host = { infer } as unknown as Parameters<typeof runPromptedSegmentation>[0]['host'];
    const embedding = {
      providerId: SAM2_PROVIDER_ID,
      tensors: {
        image_embed: { data: new Float32Array(1), dims: [1, 1, 1, 1] },
        high_res_feats_0: { data: new Float32Array(1), dims: [1, 1, 1, 1] },
        high_res_feats_1: { data: new Float32Array(1), dims: [1, 1, 1, 1] },
      },
      letterbox: { offsetX: 12, offsetY: 0 },
    };

    const result = await runPromptedSegmentation({
      host,
      decision: decision(SAM2_PROVIDER_ID),
      encoderPath: 'sam2-encoder.onnx',
      decoderPath: 'sam2-decoder.onnx',
      imageData: imageData(),
      sourceWidth: 4,
      sourceHeight: 4,
      points: [{ x: 0.5, y: 0.5, label: 1 }],
      embedding,
      signal: new AbortController().signal,
      reservationBytes: 1024,
    });

    expect(infer).toHaveBeenCalledTimes(1);
    expect(infer.mock.calls[0]![0]).toMatchObject({
      modelType: 'sam2-decoder',
      tensors: embedding.tensors,
    });
    expect(result.scoreSource).toBe('heuristic');
    expect(result.candidates[0]!.scoreSource).toBe('heuristic');
  });

  it('crops SAM2 decoder padding before mapping a non-square image mask', async () => {
    const infer = vi.fn().mockResolvedValueOnce({
      outputs: {
        masks: {
          // The first and last rows represent padded rows in the 1024-square
          // decoder frame. Only the middle two rows belong to this 4x2 source.
          data: new Float32Array([
            1, 1, 1, 1,
            -1, 1, 1, -1,
            -1, 1, 1, -1,
            1, 1, 1, 1,
          ]),
          dims: [1, 1, 4, 4],
        },
        executionProvider: 'wasm',
      },
    });
    const host = { infer } as unknown as Parameters<typeof runPromptedSegmentation>[0]['host'];
    const embedding = {
      providerId: SAM2_PROVIDER_ID,
      tensors: {
        image_embed: { data: new Float32Array(1), dims: [1, 1, 1, 1] },
        high_res_feats_0: { data: new Float32Array(1), dims: [1, 1, 1, 1] },
        high_res_feats_1: { data: new Float32Array(1), dims: [1, 1, 1, 1] },
      },
      // A 4:2 source letterboxed into the 1024-square has 256px of top/bottom
      // padding. The adapter must use this exact transform while decoding.
      letterbox: { offsetX: 0, offsetY: 256, contentWidth: 1024, contentHeight: 512 },
    };

    const result = await runPromptedSegmentation({
      host,
      decision: decision(SAM2_PROVIDER_ID),
      encoderPath: 'sam2-encoder.onnx',
      decoderPath: 'sam2-decoder.onnx',
      imageData: new ImageData(new Uint8ClampedArray(4 * 2 * 4), 4, 2),
      sourceWidth: 4,
      sourceHeight: 2,
      points: [{ x: 0.5, y: 0.5, label: 1 }],
      embedding,
      signal: new AbortController().signal,
      reservationBytes: 1024,
    });

    expect(result.candidates[0]?.mask).toEqual(
      new Uint8Array([0, 255, 255, 0, 0, 255, 255, 0]),
    );
  });
});
