/**
 * Temporally consistent video matte pipeline.
 *
 * Extends the static image background isolation system (index.ts) to process
 * sequential frames with temporal consistency via optical flow propagation,
 * confidence-weighted blending, and temporal median filtering.
 *
 * Research basis: Video matting with temporally consistent alpha (Chuang et al.
 * CVPR 2002); Deep Video Matting (Sun et al. 2021); Robust Video Matting (Lin
 * et al. 2021); adaptive temporal filtering for jitter reduction.
 *
 * Architecture:
 *   1. Key frames (every `keyframeInterval`) run full AI inference.
 *   2. Intermediate frames propagate the previous mask via optical flow,
 *      then blend with heuristic prediction (if available).
 *   3. A temporal median window smooths boundary jitter across frames.
 */

import { decontaminateMask, featherMaskArray } from './maskOps';
import { computeBlockFlow, warpMask } from './opticalFlow';

export interface VideoFrame {
  index: number;
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
  timestampMs: number;
}

export interface VideoMatteOptions {
  blockSize?: number;
  searchRadius?: number;
  temporalWeight?: number;
  medianWindow?: number;
  temporalSmoothing?: boolean;
  keyframeInterval?: number;
}

export interface VideoMatteResult {
  masks: Uint8Array[];
  frameTimingsMs: number[];
  confidences: number[];
  consistencyScore: number;
}

type AiInferenceFn = (frame: VideoFrame) => Promise<{ mask: Uint8Array; confidence: number }>;

const DEFAULTS: Required<VideoMatteOptions> = {
  blockSize: 16,
  searchRadius: 8,
  temporalWeight: 0.3,
  medianWindow: 3,
  temporalSmoothing: true,
  keyframeInterval: 1,
};

/**
 * Compute per-pixel confidence from a mask.
 * High confidence = pixel is far from the decision boundary (near 0 or 255).
 */
function pixelwiseConfidence(mask: Uint8Array): Float32Array {
  const conf = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ?? 0;
    conf[i] = Math.abs(v - 128) / 255;
  }
  return conf;
}

/**
 * Apply temporal median filter across a sliding window of masks.
 * For each pixel position, takes the median value across `windowSize` frames.
 * This stabilizes mask boundaries that jitter frame-to-frame.
 */
function temporalMedianFilter(
  masks: Uint8Array[],
  windowSize: number,
  width: number,
  height: number,
): Uint8Array[] {
  if (windowSize <= 1 || masks.length <= 1) return masks;

  const halfWindow = Math.floor(windowSize / 2);
  const pixelCount = width * height;
  const result: Uint8Array[] = [];

  for (let f = 0; f < masks.length; f++) {
    const filtered = new Uint8Array(pixelCount);

    for (let p = 0; p < pixelCount; p++) {
      const neighbors: number[] = [];
      for (let k = -halfWindow; k <= halfWindow; k++) {
        const nf = f + k;
        if (nf < 0 || nf >= masks.length) continue;
        neighbors.push(masks[nf]![p] ?? 0);
      }
      neighbors.sort((a, b) => a - b);
      filtered[p] = neighbors[Math.floor(neighbors.length / 2)] ?? 0;
    }

    result.push(filtered);
  }

  return result;
}

/**
 * Compute overall temporal consistency score across the sequence.
 *
 * Measures average frame-to-frame mask difference normalised to [0, 1].
 * Lower inter-frame variance = higher consistency.
 */
function computeConsistencyScore(masks: Uint8Array[]): number {
  if (masks.length <= 1) return 1;

  let totalDiff = 0;
  let comparisons = 0;

  for (let f = 1; f < masks.length; f++) {
    const prev = masks[f - 1]!;
    const curr = masks[f]!;
    if (prev.length !== curr.length) continue;

    let diff = 0;
    for (let p = 0; p < prev.length; p++) {
      diff += Math.abs((prev[p] ?? 0) - (curr[p] ?? 0));
    }
    totalDiff += diff / prev.length;
    comparisons++;
  }

  const avgDiff = comparisons > 0 ? totalDiff / comparisons : 0;
  return Math.max(0, Math.min(1, 1 - avgDiff / 255));
}

/**
 * Static frame matcher stub for non-key frames.
 * Computes a heuristic mask from the current frame using a simple
 * luminance edge-based separation estimate when no AI is available.
 *
 * In production, this would be wired to the actual heuristic or AI
 * provider chain from the existing background removal system.
 */
function heuristicFrameMask(frame: VideoFrame): { mask: Uint8Array; confidence: number } {
  const { data, width, height } = frame;
  const mask = new Uint8Array(width * height);
  const pixelCount = width * height;

  let edgeSum = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx] ?? 0;
      const g = data[idx + 1] ?? 0;
      const b = data[idx + 2] ?? 0;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      if (y > 0 && x > 0) {
        const prevIdx = ((y - 1) * width + (x - 1)) * 4;
        const pr = data[prevIdx] ?? 0;
        const pg = data[prevIdx + 1] ?? 0;
        const pb = data[prevIdx + 2] ?? 0;
        const prevLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
        const edge = Math.abs(lum - prevLum);
        edgeSum += edge;

        mask[y * width + x] = edge > 30 ? 255 : 0;
      } else {
        mask[y * width + x] = 0;
      }
    }
  }

  const avgEdge = edgeSum / pixelCount;
  const confidence = Math.min(1, avgEdge / 80);

  return { mask, confidence };
}

/**
 * Process a sequence of video frames with temporally consistent matting.
 *
 * Key frames (every `keyframeInterval`) run full AI inference via `runAi`.
 * Intermediate frames propagate the mask from the nearest keyframe via
 * optical flow, then blend with the heuristic prediction.
 */
export async function processVideoMatte(
  frames: VideoFrame[],
  runAi: AiInferenceFn,
  options?: VideoMatteOptions,
): Promise<VideoMatteResult> {
  if (frames.length === 0) {
    return { masks: [], frameTimingsMs: [], confidences: [], consistencyScore: 1 };
  }

  const opts: Required<VideoMatteOptions> = { ...DEFAULTS, ...options };
  const {
    blockSize,
    searchRadius,
    temporalWeight,
    medianWindow,
    temporalSmoothing,
    keyframeInterval,
  } = opts;

  const pixelCount = frames[0]!.width * frames[0]!.height;
  const masks: Uint8Array[] = [];
  const frameTimingsMs: number[] = [];
  const confidences: number[] = [];

  let lastKeyframeMask: Uint8Array | null = null;
  let lastKeyframeIndex = -1;

  for (let f = 0; f < frames.length; f++) {
    const frame = frames[f]!;
    const frameStart = performance.now();

    const isKeyframe = f % keyframeInterval === 0;

    let aiMask: Uint8Array | null = null;
    let aiConfidence = 0;

    if (isKeyframe) {
      const aiResult = await runAi(frame);
      aiMask = aiResult.mask;
      aiConfidence = aiResult.confidence;
      lastKeyframeMask = new Uint8Array(aiMask);
      lastKeyframeIndex = f;
    } else {
      try {
        const aiResult = await runAi(frame);
        aiMask = aiResult.mask;
        aiConfidence = aiResult.confidence;
      } catch {
        aiMask = null;
        aiConfidence = 0;
      }
    }

    let mask: Uint8Array;

    if (aiMask !== null && (!temporalSmoothing || lastKeyframeMask === null)) {
      mask = new Uint8Array(aiMask);
    } else if (aiMask !== null && lastKeyframeMask !== null && temporalSmoothing) {
      const flow = computeBlockFlow(
        frames[lastKeyframeIndex]!.data,
        frame.data,
        frame.width,
        frame.height,
        blockSize,
        searchRadius,
      );
      const warpedMask = warpMask(lastKeyframeMask, flow, frame.width, frame.height, blockSize);

      const aiPConf = pixelwiseConfidence(aiMask);
      const result = new Uint8Array(pixelCount);

      for (let p = 0; p < pixelCount; p++) {
        const ai = aiMask[p] ?? 0;
        const warped = warpedMask[p] ?? 0;
        const w = aiPConf[p] ?? 0;
        const t = temporalWeight;
        const blendWeight = w * (1 - t) + t;

        if (blendWeight > 0) {
          result[p] = Math.round((ai * w * (1 - t) + warped * t) / blendWeight);
        } else {
          result[p] = ai;
        }
      }

      mask = result;
    } else if (lastKeyframeMask !== null && temporalSmoothing) {
      const flow = computeBlockFlow(
        frames[lastKeyframeIndex]!.data,
        frame.data,
        frame.width,
        frame.height,
        blockSize,
        searchRadius,
      );
      mask = warpMask(lastKeyframeMask, flow, frame.width, frame.height, blockSize);
    } else {
      const heuristic = heuristicFrameMask(frame);
      mask = heuristic.mask;
      aiConfidence = heuristic.confidence;
    }

    mask = decontaminateMask(mask, frame.width, frame.height);
    mask = featherMaskArray(mask, frame.width, frame.height, 1);

    masks.push(mask);
    confidences.push(aiConfidence);
    frameTimingsMs.push(performance.now() - frameStart);
  }

  let finalMasks = masks;

  if (temporalSmoothing && medianWindow > 1 && frames.length > 1) {
    finalMasks = temporalMedianFilter(masks, medianWindow, frames[0]!.width, frames[0]!.height);
  }

  const consistencyScore = computeConsistencyScore(finalMasks);

  return {
    masks: finalMasks,
    frameTimingsMs,
    confidences,
    consistencyScore,
  };
}
