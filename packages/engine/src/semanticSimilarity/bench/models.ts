/**
 * Model adapters for the evaluation harness.
 *
 * Each adapter embeds an RGBA image through the canonical preprocessing
 * pipeline (preprocess.ts) and the dev-only onnxruntime-node session.
 * Production uses the same preprocessing through the inference worker;
 * the parity test verifies the two paths agree with the Python reference.
 */

import {
  DINOV2_PREPROCESS_SPEC,
  DINOV2_PREPROCESSING_VERSION,
  preprocessSemanticInput,
  SEMANTIC_PREPROCESSING_VERSION_V2,
  SIGLIP_PREPROCESS_SPEC,
} from '../preprocess';
import { int64Zeros, loadNodeOrtSession } from './ortNode';

export interface EmbeddingModelAdapter {
  id: string;
  dimension: number;
  preprocessingVersion: string;
  modelPath: string;
  embed(rgba: Uint8ClampedArray, width: number, height: number): Promise<Float32Array>;
  /** Warm p50/p95 inference time in ms (filled by the harness). */
  timing: { coldMs: number | null; samplesMs: number[] };
}

const COSINE_NORM = true;

function l2Normalize(values: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < values.length; i++) sumSq += values[i]! * values[i]!;
  const norm = Math.sqrt(sumSq) || 1;
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i]! / norm;
  return out;
}

export function makeSiglipAdapter(modelPath: string): EmbeddingModelAdapter {
  const adapter: EmbeddingModelAdapter = {
    id: 'siglip-base-patch16-224',
    dimension: 768,
    preprocessingVersion: SEMANTIC_PREPROCESSING_VERSION_V2,
    modelPath,
    timing: { coldMs: null, samplesMs: [] },
    async embed(rgba, width, height) {
      const { tensor } = preprocessSemanticInput(
        { data: rgba, width, height },
        SIGLIP_PREPROCESS_SPEC,
      );
      const session = await loadNodeOrtSession(modelPath);
      const t0 = performance.now();
      const outputs = await session.run({
        pixel_values: { data: tensor, dims: [1, 3, 224, 224] },
        input_ids: int64Zeros([1, 1]),
      });
      const elapsed = performance.now() - t0;
      adapter.timing.samplesMs.push(elapsed);
      const raw = outputs.image_embeds;
      if (!raw) throw new Error('siglip: missing image_embeds output');
      return COSINE_NORM ? l2Normalize(raw.data) : new Float32Array(raw.data);
    },
  };
  return adapter;
}

export function makeDinov2Adapter(modelPath: string): EmbeddingModelAdapter {
  const adapter: EmbeddingModelAdapter = {
    id: 'dinov2-small',
    dimension: 384,
    preprocessingVersion: DINOV2_PREPROCESSING_VERSION,
    modelPath,
    timing: { coldMs: null, samplesMs: [] },
    async embed(rgba, width, height) {
      const { tensor } = preprocessSemanticInput(
        { data: rgba, width, height },
        DINOV2_PREPROCESS_SPEC,
      );
      const session = await loadNodeOrtSession(modelPath);
      const t0 = performance.now();
      const outputs = await session.run({ pixel_values: { data: tensor, dims: [1, 3, 224, 224] } });
      const elapsed = performance.now() - t0;
      adapter.timing.samplesMs.push(elapsed);
      const raw = outputs.last_hidden_state;
      if (!raw) throw new Error('dinov2: missing last_hidden_state output');
      const cls = raw.data.subarray(0, 384);
      return COSINE_NORM ? l2Normalize(cls) : new Float32Array(cls);
    },
  };
  return adapter;
}

export function percentile(sortedMs: readonly number[], p: number): number {
  if (sortedMs.length === 0) return 0;
  const idx = Math.min(sortedMs.length - 1, Math.floor((p / 100) * sortedMs.length));
  return sortedMs[idx]!;
}
