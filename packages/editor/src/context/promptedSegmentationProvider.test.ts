import {
  EFFICIENT_SAM_DECODER_ID,
  EFFICIENT_SAM_ENCODER_ID,
  EFFICIENT_SAM_PROVIDER_ID,
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
  encodeMobileSamPromptContract,
  runPromptedSegmentation,
} from './promptedSegmentationProvider';

function decision(
  providerId:
    | typeof MOBILE_SAM_PROVIDER_ID
    | typeof SAM2_PROVIDER_ID
    | typeof EFFICIENT_SAM_PROVIDER_ID,
): PromptedRoutingDecision {
  if (providerId === EFFICIENT_SAM_PROVIDER_ID) {
    return {
      providerId,
      providerLabel: 'Lightweight experimental selection',
      encoderId: EFFICIENT_SAM_ENCODER_ID,
      decoderId: EFFICIENT_SAM_DECODER_ID,
      reason: 'test route',
      candidates: [],
      rejected: [],
      sourceBytes: 64,
      estimatedWorkingSetBytes: 100,
      qualitySource: 'validated-corpus',
    };
  }
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
    expect(
      encodeMobileSamPromptContract(params.points, params.box, 4, 4).point_labels!.data,
    ).toEqual(new Float32Array([0, 2, 3]));
    expect(result.candidates).toHaveLength(4);
    expect(result.selectedIndex).toBe(1);
    expect(result.selectedScore).toBeCloseTo(1.04, 5);
    expect(result.scoreSource).toBe('predicted-iou');
    expect(result.candidates[1]!.mask.some((value) => value === 255)).toBe(true);
  });

  it('runs EfficientSAM-Ti encoder/decoder graphs through the shared lifecycle', async () => {
    const infer = vi
      .fn()
      .mockResolvedValueOnce({
        outputs: {
          image_embeddings: { data: new Float32Array(256 * 64 * 64), dims: [1, 256, 64, 64] },
          executionProvider: 'wasm',
        },
      })
      .mockResolvedValueOnce({
        outputs: {
          masks: {
            // 3 candidates, 4x4 each, matching the 4x4 source so no resize is
            // applied: candidate 0 is empty, candidate 1 covers the left
            // column, candidate 2 is full.
            data: new Float32Array([
              -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 1, -1, -1, -1, 1, -1,
              -1, -1, 1, -1, -1, -1, 1, -1, -1, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
            ]),
            dims: [1, 1, 3, 4, 4],
          },
          iou_predictions: { data: new Float32Array([0.9, 1.2, 0.4]), dims: [1, 1, 3] },
          executionProvider: 'wasm',
        },
      });
    const host = { infer } as unknown as Parameters<typeof runPromptedSegmentation>[0]['host'];

    const result = await runPromptedSegmentation({
      host,
      decision: decision(EFFICIENT_SAM_PROVIDER_ID),
      encoderPath: 'efficient-encoder.onnx',
      decoderPath: 'efficient-decoder.onnx',
      imageData: imageData(),
      sourceWidth: 4,
      sourceHeight: 4,
      points: [{ x: 0.25, y: 0.75, label: 0 }],
      box: { x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.9 },
      signal: new AbortController().signal,
      reservationBytes: 1024,
    });

    expect(infer).toHaveBeenCalledTimes(2);
    const encoderCall = infer.mock.calls[0]![0] as {
      modelType: string;
      modelId: string;
      imageData?: unknown;
      tensors?: Record<string, { data: Float32Array; dims: number[] }>;
    };
    expect(encoderCall.modelType).toBe('efficient-sam-encoder');
    expect(encoderCall.modelId).toBe(EFFICIENT_SAM_ENCODER_ID);
    // The verified upstream preprocessing is applied by the adapter, not the
    // worker's generic letterbox: the encoder receives a pre-packed tensor at
    // the longest-side-1024 geometry.
    expect(encoderCall.imageData).toBeUndefined();
    const encoderTensor = encoderCall.tensors?.batched_images;
    expect(encoderTensor?.dims).toEqual([1, 3, 1024, 1024]);
    expect(encoderTensor?.data.length).toBe(3 * 1024 * 1024);

    const decoderCall = infer.mock.calls[1]![0] as {
      modelType: string;
      modelId: string;
      tensors: Record<string, { dims: number[] }>;
      params: { points: unknown; box: unknown; sourceWidth: number; sourceHeight: number };
    };
    expect(decoderCall.modelType).toBe('efficient-sam-decoder');
    expect(decoderCall.modelId).toBe(EFFICIENT_SAM_DECODER_ID);
    expect(Object.keys(decoderCall.tensors)).toEqual(['image_embeddings']);
    expect(decoderCall.params.sourceWidth).toBe(4);
    expect(decoderCall.params.sourceHeight).toBe(4);
    // No mask input may be sent: the official decoder has no such tensor.
    expect(decoderCall.tensors.mask_input).toBeUndefined();

    expect(result.candidates).toHaveLength(3);
    expect(result.selectedIndex).toBe(1);
    expect(result.selectedScore).toBeCloseTo(1.2, 5);
    expect(result.scoreSource).toBe('predicted-iou');
    expect(result.candidates.every((candidate) => candidate.scoreSource === 'predicted-iou')).toBe(
      true,
    );
    expect(result.candidates[1]!.mask).toEqual(
      new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0]),
    );
    expect(result.candidates[1]!.width).toBe(4);
    expect(result.candidates[1]!.height).toBe(4);
    expect(result.candidates[1]!.lowResMask).toBeUndefined();
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
          data: new Float32Array([1, 1, 1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1, 1, 1, 1]),
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

    expect(result.candidates[0]?.mask).toEqual(new Uint8Array([0, 255, 255, 0, 0, 255, 255, 0]));
  });
});
