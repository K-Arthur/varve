// @vitest-environment node
/**
 * Real-model corpus parity gate (manual).
 *
 * Runs the license-safe synthetic corpus in `corpus.ts` through the pinned
 * SAM2.1 Hiera Tiny ONNX pair with onnxruntime-node and records IoU, Dice,
 * and boundary F against each fixture oracle. This is the runnable form of
 * the release gate described in `docs/quality/object-selection-parity.md`.
 *
 * Gated: skipped unless `VARVE_SAM2_REAL_MODEL_DIR` points at a directory
 * containing `sam2_hiera_tiny.encoder.repaired.onnx` and
 * `sam2_hiera_tiny.decoder.onnx`.
 *
 * Preprocessing mirrors the worker's documented transform: RGB, scale to fit
 * 1024x1024, centered padding with black, ImageNet normalization. The Node
 * runner implements the sampling in pure JS (no OffscreenCanvas); prompt
 * encoding and output decoding reuse the production functions
 * (`encodeSam2Prompts`, `decodeSam2DecoderOutput`) so prompt mapping and
 * mask postprocessing are identical to the app.
 *
 * Results JSON is written to `VARVE_SAM2_RESULTS_PATH` (default
 * `/tmp/opencode/sam2-corpus-results.json`) for
 * `scripts/bench/object-selection-parity-report.mjs`.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { InferenceSession, Tensor } from 'onnxruntime-node';
import { describe, expect, it } from 'vitest';
import {
  type DecodedMaskResult,
  decodeSam2DecoderOutput,
  encodeSam2Prompts,
  SAM2_INPUT_SIZE,
  SAM2_TENSOR_SPEC,
} from '../../inference/models/sam2';
import type { SegmentationCorpusFixture } from './corpus';
import { computeSegmentationQuality } from './metrics';

/**
 * The corpus is defined with `ImageData`; Node has no DOM. This minimal shim
 * carries the same shape the generator uses (RGBA bytes + dimensions), and it
 * is installed before the corpus module is imported.
 */
if (typeof globalThis.ImageData === 'undefined') {
  class NodeImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }
  (globalThis as unknown as { ImageData: typeof NodeImageData }).ImageData = NodeImageData;
}

const MODEL_DIR = process.env.VARVE_SAM2_REAL_MODEL_DIR ?? '';
const ENCODER_PATH = join(MODEL_DIR, 'sam2_hiera_tiny.encoder.repaired.onnx');
const DECODER_PATH = join(MODEL_DIR, 'sam2_hiera_tiny.decoder.onnx');
const RESULTS_PATH =
  process.env.VARVE_SAM2_RESULTS_PATH ?? '/tmp/opencode/sam2-corpus-results.json';
const enabled = MODEL_DIR.length > 0 && existsSync(ENCODER_PATH) && existsSync(DECODER_PATH);

interface CorpusRow {
  caseId: string;
  category: string;
  modelId: string;
  executionProvider: string;
  coldStartMs: number;
  promptP50Ms: number;
  promptP95Ms: number;
  estimatedPeakMemoryMb: number;
  metrics: { iou: number; dice: number; boundaryF: number };
  /** Best IoU across the decoder's three candidate masks (cycling bound). */
  cyclingBestIou: number;
  ok: boolean;
}

type OrtModule = typeof import('onnxruntime-node');

function letterboxNchw(imageData: ImageData): {
  data: Float32Array;
  offsetX: number;
  offsetY: number;
} {
  const size = SAM2_INPUT_SIZE;
  const { width: sourceWidth, height: sourceHeight, data: rgba } = imageData;
  const scale = Math.min(size / sourceWidth, size / sourceHeight);
  const contentWidth = Math.round(sourceWidth * scale);
  const contentHeight = Math.round(sourceHeight * scale);
  const offsetX = Math.floor((size - contentWidth) / 2);
  const offsetY = Math.floor((size - contentHeight) / 2);
  const plane = size * size;
  const data = new Float32Array(plane * 3);
  const [meanR, meanG, meanB] = SAM2_TENSOR_SPEC.mean;
  const [stdR, stdG, stdB] = SAM2_TENSOR_SPEC.std;
  const sample = (x: number, y: number, channel: number): number => {
    const cx = Math.max(0, Math.min(sourceWidth - 1, x));
    const cy = Math.max(0, Math.min(sourceHeight - 1, y));
    return rgba[(cy * sourceWidth + cx) * 4 + channel]! / 255;
  };
  for (let y = 0; y < size; y += 1) {
    const sy = (y - offsetY + 0.5) / scale - 0.5;
    for (let x = 0; x < size; x += 1) {
      const sx = (x - offsetX + 0.5) / scale - 0.5;
      let r = 0;
      let g = 0;
      let b = 0;
      if (sx >= -0.5 && sy >= -0.5 && sx <= sourceWidth - 0.5 && sy <= sourceHeight - 0.5) {
        const x0 = Math.max(0, Math.min(sourceWidth - 1, Math.floor(sx)));
        const y0 = Math.max(0, Math.min(sourceHeight - 1, Math.floor(sy)));
        const x1 = Math.max(0, Math.min(sourceWidth - 1, x0 + 1));
        const y1 = Math.max(0, Math.min(sourceHeight - 1, y0 + 1));
        const tx = Math.max(0, Math.min(1, sx - x0));
        const ty = Math.max(0, Math.min(1, sy - y0));
        const topR = sample(x0, y0, 0) * (1 - tx) + sample(x1, y0, 0) * tx;
        const topG = sample(x0, y0, 1) * (1 - tx) + sample(x1, y0, 1) * tx;
        const topB = sample(x0, y0, 2) * (1 - tx) + sample(x1, y0, 2) * tx;
        const bottomR = sample(x0, y1, 0) * (1 - tx) + sample(x1, y1, 0) * tx;
        const bottomG = sample(x0, y1, 1) * (1 - tx) + sample(x1, y1, 1) * tx;
        const bottomB = sample(x0, y1, 2) * (1 - tx) + sample(x1, y1, 2) * tx;
        r = topR * (1 - ty) + bottomR * ty;
        g = topG * (1 - ty) + bottomG * ty;
        b = topB * (1 - ty) + bottomB * ty;
      }
      // Padding stays black; normalization converts it exactly as the
      // canvas path does ((0 - mean) / std).
      const index = y * size + x;
      data[index] = (r - meanR!) / stdR!;
      data[plane + index] = (g - meanG!) / stdG!;
      data[plane * 2 + index] = (b - meanB!) / stdB!;
    }
  }
  return { data, offsetX, offsetY };
}

async function predictFixture(
  ort: OrtModule,
  encoder: InferenceSession,
  decoder: InferenceSession,
  fixture: SegmentationCorpusFixture,
): Promise<DecodedMaskResult> {
  const { data, offsetX, offsetY } = letterboxNchw(fixture.image);
  // The worker resolves input names from the session; the pinned export names
  // the encoder input `image`, while the decoder uses the contract names.
  const encoderInputName = encoder.inputNames[0]!;
  const encoderOutputs = (await encoder.run({
    [encoderInputName]: new ort.Tensor('float32', data, [1, 3, SAM2_INPUT_SIZE, SAM2_INPUT_SIZE]),
  })) as unknown as Record<string, Tensor>;

  const normalizedPoints = fixture.prompts.points.map((point) => ({
    x: point.x / fixture.width,
    y: point.y / fixture.height,
    label: point.label,
  }));
  const normalizedBox = fixture.prompts.box
    ? {
        x1: fixture.prompts.box.x1 / fixture.width,
        y1: fixture.prompts.box.y1 / fixture.height,
        x2: fixture.prompts.box.x2 / fixture.width,
        y2: fixture.prompts.box.y2 / fixture.height,
      }
    : undefined;
  const encoded = encodeSam2Prompts(
    { points: normalizedPoints, box: normalizedBox },
    { offsetX, offsetY },
  );

  const feed: Record<string, Tensor> = {
    image_embed: encoderOutputs.image_embed!,
    high_res_feats_0: encoderOutputs.high_res_feats_0!,
    high_res_feats_1: encoderOutputs.high_res_feats_1!,
    point_coords: new ort.Tensor('float32', encoded.pointCoords.data, encoded.pointCoords.dims),
    point_labels: new ort.Tensor('float32', encoded.pointLabels.data, encoded.pointLabels.dims),
    mask_input: new ort.Tensor('float32', encoded.maskInput.data, encoded.maskInput.dims),
    has_mask_input: new ort.Tensor('float32', encoded.hasMaskInput.data, encoded.hasMaskInput.dims),
  };
  const decoderOutputs = (await decoder.run(feed)) as unknown as Record<string, Tensor>;

  const tensors = Object.values(decoderOutputs);
  const masks = tensors.find((tensor) => tensor.dims.length === 4);
  const iou = tensors.find((tensor) => tensor.dims.length === 2);
  if (!masks) throw new Error(`Decoder returned no mask tensor for ${fixture.id}`);

  const decoded = decodeSam2DecoderOutput(
    masks.data as Float32Array,
    [...masks.dims],
    (iou?.data as Float32Array | undefined) ?? null,
    iou ? [...iou.dims] : null,
    fixture.width,
    fixture.height,
  );
  return decoded;
}

describe('real-model corpus parity (gated)', () => {
  it.skipIf(!enabled)(
    'runs the corpus through the pinned SAM2 pair and records metrics',
    async () => {
      const { SEGMENTATION_CORPUS } = await import('./corpus');
      const ort = await import('onnxruntime-node');
      const coldStart = performance.now();
      const encoder = await ort.InferenceSession.create(ENCODER_PATH, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
      });
      const decoder = await ort.InferenceSession.create(DECODER_PATH, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
      });
      const coldStartMs = performance.now() - coldStart;

      const rows: CorpusRow[] = [];
      for (const fixture of SEGMENTATION_CORPUS) {
        const promptStart = performance.now();
        const decoded = await predictFixture(ort, encoder, decoder, fixture);
        const promptMs = performance.now() - promptStart;
        const mask = decoded.masks[decoded.selectedIndex]!.mask;
        const metrics = computeSegmentationQuality(
          mask,
          fixture.oracleMask,
          fixture.width,
          fixture.height,
        );
        const cyclingBestIou = Math.max(
          ...decoded.masks.map(
            (candidate) =>
              computeSegmentationQuality(
                candidate.mask,
                fixture.oracleMask,
                fixture.width,
                fixture.height,
              ).iou,
          ),
        );
        rows.push({
          caseId: fixture.id,
          category: fixture.category,
          modelId: 'sam2-hiera-tiny',
          executionProvider: 'cpu',
          coldStartMs,
          promptP50Ms: promptMs,
          promptP95Ms: promptMs,
          estimatedPeakMemoryMb: 700,
          metrics,
          cyclingBestIou,
          ok: true,
        });
        console.log(
          `CORPUS ${fixture.id.padEnd(18)} IoU ${metrics.iou.toFixed(3)} best-candidate ${cyclingBestIou.toFixed(3)} Dice ${metrics.dice.toFixed(3)} boundaryF ${metrics.boundaryF.toFixed(3)} (${Math.round(promptMs)}ms)`,
        );
      }

      const successful = rows.filter((row) => row.ok);
      const mean = (pick: (row: CorpusRow) => number): number =>
        successful.reduce((sum, row) => sum + pick(row), 0) / Math.max(1, successful.length);
      const meanIou = mean((row) => row.metrics.iou);
      const meanBoundaryF = mean((row) => row.metrics.boundaryF);
      const meanCyclingIou = mean((row) => row.cyclingBestIou);
      const minIou = Math.min(...successful.map((row) => row.metrics.iou));
      const minBoundaryF = Math.min(...successful.map((row) => row.metrics.boundaryF));
      console.log(
        `CORPUS SUMMARY mean IoU ${meanIou.toFixed(3)} mean best-candidate IoU ${meanCyclingIou.toFixed(3)} mean boundaryF ${meanBoundaryF.toFixed(3)} min IoU ${minIou.toFixed(3)} min boundaryF ${minBoundaryF.toFixed(3)} cold ${Math.round(coldStartMs)}ms`,
      );

      mkdirSync(dirname(RESULTS_PATH), { recursive: true });
      writeFileSync(
        RESULTS_PATH,
        JSON.stringify(
          { modelId: 'sam2-hiera-tiny', generatedAt: new Date().toISOString(), rows },
          null,
          2,
        ),
      );

      expect(successful).toHaveLength(SEGMENTATION_CORPUS.length);
      for (const row of rows) {
        expect(Number.isFinite(row.metrics.iou), `${row.caseId} IoU finite`).toBe(true);
        expect(Number.isFinite(row.metrics.dice), `${row.caseId} Dice finite`).toBe(true);
        expect(Number.isFinite(row.metrics.boundaryF), `${row.caseId} boundaryF finite`).toBe(true);
      }
    },
    1_800_000,
  );
});
