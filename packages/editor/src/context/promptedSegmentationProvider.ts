/**
 * Shared editor adapter for prompted segmentation providers.
 *
 * The editor owns one lifecycle (abort, source revision, embedding cache,
 * candidate commit). This adapter owns only provider-specific worker graph
 * names, tensor plumbing, and output decoding so MobileSAM cannot grow a
 * parallel hook with different stale-result behaviour.
 */

import type {
  InferenceWorkerHost,
  MobileSamDecoderOutput,
  PromptedRoutingDecision,
  Sam2Letterbox,
  WorkerInferResult,
} from '@varve/engine';
import {
  decodeEfficientSamDecoderOutput,
  decodeMobileSamDecoderOutput,
  decodeSam2DecoderOutput,
  encodeMobileSamPrompts,
  encodeSam2Prompts,
  preprocessEfficientSamImageData,
} from '@varve/engine';

export type PromptedWorkerTensor = { data: Float32Array; dims: number[] };

export type PromptedEmbedding = {
  providerId: string;
  tensors: Record<string, PromptedWorkerTensor>;
  letterbox?: Sam2Letterbox;
  executionProvider?: string;
};

export type PromptedMaskCandidate = {
  mask: Uint8Array;
  width: number;
  height: number;
  score: number;
  scoreSource: 'predicted-iou' | 'heuristic';
  lowResMask?: { data: Float32Array; width: number; height: number };
};

export type PromptedPrediction = {
  embedding: PromptedEmbedding;
  candidates: PromptedMaskCandidate[];
  selectedIndex: number;
  selectedScore: number;
  scoreSource: 'predicted-iou' | 'heuristic';
  executionProvider: string;
};

export async function runPromptedSegmentation({
  host,
  decision,
  encoderPath,
  decoderPath,
  imageData,
  sourceWidth,
  sourceHeight,
  points,
  box,
  embedding,
  signal,
  reservationBytes,
}: {
  host: InferenceWorkerHost;
  decision: PromptedRoutingDecision;
  encoderPath: string;
  decoderPath: string;
  imageData: ImageData;
  sourceWidth: number;
  sourceHeight: number;
  points?: Array<{ x: number; y: number; label: 0 | 1 }>;
  box?: { x1: number; y1: number; x2: number; y2: number };
  embedding?: PromptedEmbedding;
  signal: AbortSignal;
  reservationBytes: number;
}): Promise<PromptedPrediction> {
  if (!decision.providerId || !decision.encoderId || !decision.decoderId) {
    throw new Error('Prompted object selection has no eligible local provider');
  }
  const providerId = decision.providerId;
  const encoderId = decision.encoderId;
  const decoderId = decision.decoderId;

  let resolvedEmbedding = embedding;
  if (!resolvedEmbedding) {
    const encoderResult =
      providerId === 'efficient-sam-ti'
        ? await host.infer(
            {
              type: 'infer',
              modelType: 'efficient-sam-encoder',
              modelPath: encoderPath,
              modelId: encoderId,
              // The verified upstream preprocessing (longest side -> 1024,
              // raw RGB in [0,1], NCHW) is owned by the provider module; the
              // worker must not re-run a different letterbox on top of it.
              tensors: (() => {
                const preprocessed = preprocessEfficientSamImageData(imageData);
                return {
                  batched_images: {
                    data: preprocessed.tensor,
                    dims: [1, 3, preprocessed.height, preprocessed.width],
                  },
                };
              })(),
              reuseSession: true,
            },
            { signal, reservationBytes },
          )
        : await host.infer(
            {
              type: 'infer',
              modelType: providerId === 'mobile-sam' ? 'mobile-sam-encoder' : 'sam2-encoder',
              modelPath: encoderPath,
              modelId: encoderId,
              imageData,
              reuseSession: true,
            },
            { signal, reservationBytes },
          );
    resolvedEmbedding = decodeEmbedding({ ...decision, providerId }, encoderResult);
  }

  const decoderResult = await host.infer(
    {
      type: 'infer',
      modelType:
        providerId === 'mobile-sam'
          ? 'mobile-sam-decoder'
          : providerId === 'efficient-sam-ti'
            ? 'efficient-sam-decoder'
            : 'sam2-decoder',
      modelPath: decoderPath,
      modelId: decoderId,
      tensors: resolvedEmbedding.tensors,
      params: buildDecoderParams(
        providerId,
        points,
        box,
        sourceWidth,
        sourceHeight,
        resolvedEmbedding.letterbox,
      ),
      reuseSession: true,
    },
    { signal, reservationBytes },
  );

  const decoded = decodePrediction(
    providerId,
    decoderResult,
    sourceWidth,
    sourceHeight,
    resolvedEmbedding.letterbox,
  );
  return {
    embedding: resolvedEmbedding,
    candidates: decoded.candidates,
    selectedIndex: decoded.selectedIndex,
    selectedScore: decoded.selectedScore,
    scoreSource: decoded.scoreSource,
    executionProvider: String(decoderResult.outputs.executionProvider ?? 'unknown'),
  };
}

function decodeEmbedding(
  decision: PromptedRoutingDecision,
  result: WorkerInferResult,
): PromptedEmbedding {
  const outputs = result.outputs as Record<string, unknown>;
  const providerId = decision.providerId;
  if (!providerId) throw new Error('Prompted object selection returned no provider identity');
  if (providerId === 'efficient-sam-ti') {
    const embedding = asWorkerTensor(outputs.image_embeddings, 'image_embeddings');
    return {
      providerId,
      tensors: { image_embeddings: embedding },
      executionProvider: String(outputs.executionProvider ?? 'unknown'),
    };
  }
  if (providerId === 'mobile-sam') {
    const embedding = asWorkerTensor(outputs.image_embeddings, 'image_embeddings');
    return {
      providerId,
      tensors: { image_embeddings: embedding },
      executionProvider: String(outputs.executionProvider ?? 'unknown'),
    };
  }
  const imageEmbed = asWorkerTensor(outputs.image_embed, 'image_embed');
  const highRes0 = asWorkerTensor(outputs.high_res_feats_0, 'high_res_feats_0');
  const highRes1 = asWorkerTensor(outputs.high_res_feats_1, 'high_res_feats_1');
  const letterbox = outputs.letterbox as Sam2Letterbox | undefined;
  return {
    providerId,
    tensors: {
      image_embed: imageEmbed,
      high_res_feats_0: highRes0,
      high_res_feats_1: highRes1,
    },
    letterbox,
    executionProvider: String(outputs.executionProvider ?? 'unknown'),
  };
}

function buildDecoderParams(
  providerId: string,
  points: Array<{ x: number; y: number; label: 0 | 1 }> | undefined,
  box: { x1: number; y1: number; x2: number; y2: number } | undefined,
  sourceWidth: number,
  sourceHeight: number,
  letterbox: Sam2Letterbox | undefined,
): Record<string, unknown> {
  if (providerId === 'mobile-sam') {
    return {
      points,
      box,
      sourceWidth,
      sourceHeight,
    };
  }
  if (providerId === 'efficient-sam-ti') {
    return { points, box, sourceWidth, sourceHeight };
  }
  return { points, box, letterbox };
}

function decodePrediction(
  providerId: string,
  result: WorkerInferResult,
  sourceWidth: number,
  sourceHeight: number,
  letterbox?: Sam2Letterbox,
): {
  candidates: PromptedMaskCandidate[];
  selectedIndex: number;
  selectedScore: number;
  scoreSource: 'predicted-iou' | 'heuristic';
} {
  const outputs = result.outputs as Record<string, unknown>;
  const masks = asWorkerTensor(outputs.masks, 'masks');
  const scores = outputs.iou_predictions
    ? asWorkerTensor(outputs.iou_predictions, 'iou_predictions')
    : undefined;
  if (providerId === 'efficient-sam-ti') {
    if (!scores) throw new Error('EfficientSAM decoder did not return predicted-IoU scores');
    const decoded = decodeEfficientSamDecoderOutput(
      masks.data,
      masks.dims,
      scores.data,
      scores.dims,
      sourceWidth,
      sourceHeight,
    );
    return {
      candidates: decoded.masks.map((candidate) => ({
        mask: candidate.mask,
        width: candidate.width,
        height: candidate.height,
        score: candidate.score,
        scoreSource: 'predicted-iou' as const,
      })),
      selectedIndex: decoded.selectedIndex,
      selectedScore: decoded.selectedScore,
      scoreSource: 'predicted-iou' as const,
    };
  }
  if (providerId === 'mobile-sam') {
    if (!scores) throw new Error('MobileSAM decoder did not return predicted-IoU scores');
    const lowRes = outputs.low_res_masks
      ? asWorkerTensor(outputs.low_res_masks, 'low_res_masks')
      : undefined;
    const decoded: MobileSamDecoderOutput = decodeMobileSamDecoderOutput(
      masks.data,
      masks.dims,
      scores.data,
      scores.dims,
      sourceWidth,
      sourceHeight,
      lowRes?.data,
      lowRes?.dims,
    );
    return {
      candidates: decoded.masks.map((candidate) => ({
        mask: candidate.mask,
        width: candidate.width,
        height: candidate.height,
        score: candidate.score,
        scoreSource: 'predicted-iou',
        lowResMask: candidate.lowResMask,
      })),
      selectedIndex: decoded.selectedIndex,
      selectedScore: decoded.selectedScore,
      scoreSource: 'predicted-iou',
    };
  }
  const decoded = decodeSam2DecoderOutput(
    masks.data,
    masks.dims,
    scores?.data ?? null,
    scores?.dims ?? null,
    sourceWidth,
    sourceHeight,
    letterbox,
  );
  return {
    candidates: decoded.masks.map((candidate) => ({
      mask: candidate.mask,
      width: candidate.width,
      height: candidate.height,
      score: candidate.iouScore,
      scoreSource: candidate.confidenceSource === 'model-iou' ? 'predicted-iou' : 'heuristic',
    })),
    selectedIndex: decoded.selectedIndex,
    selectedScore: decoded.confidence,
    scoreSource: decoded.confidenceSource === 'model-iou' ? 'predicted-iou' : 'heuristic',
  };
}

function asWorkerTensor(value: unknown, name: string): PromptedWorkerTensor {
  if (!value || typeof value !== 'object') throw new Error(`Prompted provider omitted ${name}`);
  const tensor = value as { data?: unknown; dims?: unknown };
  if (!(tensor.data instanceof Float32Array) || !Array.isArray(tensor.dims)) {
    throw new Error(`Prompted provider returned an invalid ${name} tensor`);
  }
  return { data: tensor.data, dims: tensor.dims as number[] };
}

/** Keep the encoder contract available to adapter-level parity tests. */
export function encodeMobileSamPromptContract(
  points: Array<{ x: number; y: number; label: 0 | 1 }> | undefined,
  box: { x1: number; y1: number; x2: number; y2: number } | undefined,
  sourceWidth: number,
  sourceHeight: number,
) {
  return encodeMobileSamPrompts({ points, box }, sourceWidth, sourceHeight);
}

/** Keep the legacy SAM2 contract available to adapter-level parity tests. */
export function encodeSam2PromptContract(
  points: Array<{ x: number; y: number; label: 0 | 1 }> | undefined,
  box: { x1: number; y1: number; x2: number; y2: number } | undefined,
  letterbox?: Sam2Letterbox,
) {
  return encodeSam2Prompts({ points, box }, letterbox);
}
