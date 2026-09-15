// @vitest-environment node
/**
 * Real-photo EfficientSAM-Ti gate (manual).
 *
 * Two verifications run against the pinned upstream artifacts:
 *
 *   1. Split-vs-combined parity. The official upstream host publishes both a
 *      combined ONNX graph and split encoder/decoder graphs exported from the
 *      same checkpoint. Running the same preprocessing and prompts through the
 *      split adapter and the combined graph must produce identical predicted
 *      IoU logits and identical mask logits. This proves the adapter's tensor
 *      plumbing and preprocessing contract, not just "an ONNX model loads".
 *
 *   2. Real-photo inspection. The same photographs and prompts as the MobileSAM
 *      real-photo gate are segmented so a reviewer can compare masks directly.
 *      Output never becomes a repository asset; it is written to /tmp.
 *
 * Enable with:
 *   VARVE_EFFICIENT_SAM_MODEL_DIR=/path/to/split-models
 *   VARVE_EFFICIENT_SAM_COMBINED_MODEL=/path/to/efficientsam_ti.onnx   (optional, adds parity)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type { InferenceSession, Tensor } from 'onnxruntime-node';
import { describe, expect, it } from 'vitest';
import {
  decodeEfficientSamDecoderOutput,
  encodeEfficientSamPrompts,
  preprocessEfficientSamImageData,
  resizeEfficientSamDimensions,
} from '../../inference/models/efficientSam';

const MODEL_DIR = process.env.VARVE_EFFICIENT_SAM_MODEL_DIR ?? '';
const COMBINED_PATH = process.env.VARVE_EFFICIENT_SAM_COMBINED_MODEL ?? '';
const ENCODER_PATH = join(MODEL_DIR, 'efficientsam_ti_encoder.onnx');
const DECODER_PATH = join(MODEL_DIR, 'efficientsam_ti_decoder.onnx');
const FIXTURE_ROOT = resolve(process.cwd(), 'tests/e2e/fixtures');
const EVIDENCE_DIR =
  process.env.VARVE_EFFICIENT_SAM_EVIDENCE_DIR ?? '/tmp/varve-efficientsam-real-evidence';
const RESULTS_PATH =
  process.env.VARVE_EFFICIENT_SAM_RESULTS_PATH ?? '/tmp/varve-efficientsam-real-results.json';
const enabled = MODEL_DIR.length > 0 && existsSync(ENCODER_PATH) && existsSync(DECODER_PATH);
const parityEnabled = enabled && COMBINED_PATH.length > 0 && existsSync(COMBINED_PATH);

type Case = {
  id: string;
  image: string;
  prompts: {
    points: Array<{ x: number; y: number; label: 0 | 1 }>;
    box?: { x1: number; y1: number; x2: number; y2: number };
  };
  positivePoint: { x: number; y: number };
  note: string;
};

const CASES: Case[] = [
  {
    id: 'still-life-sunflower',
    image: 'real-life-still-life.jpg',
    prompts: {
      points: [
        { x: 0.2, y: 0.47, label: 1 },
        { x: 0.86, y: 0.08, label: 0 },
      ],
      box: { x1: 0.02, y1: 0.1, x2: 0.48, y2: 0.94 },
    },
    positivePoint: { x: 0.2, y: 0.47 },
    note: 'Busy still life: prompt a sunflower while excluding the dark background.',
  },
  {
    id: 'portrait-braids',
    image: 'real-life-braided-portrait.jpg',
    prompts: {
      points: [
        { x: 0.47, y: 0.43, label: 1 },
        { x: 0.08, y: 0.08, label: 0 },
      ],
    },
    positivePoint: { x: 0.47, y: 0.43 },
    note: 'Grayscale portrait with braided hair and a low-contrast oval background.',
  },
  {
    id: 'elephant-box',
    image: 'real-life-elephant.jpg',
    prompts: {
      points: [{ x: 0.56, y: 0.48, label: 1 }],
      box: { x1: 0.16, y1: 0.25, x2: 0.84, y2: 0.88 },
    },
    positivePoint: { x: 0.56, y: 0.48 },
    note: 'Animal selection with a box hint against foliage and sand.',
  },
  {
    id: 'reflective-glass',
    image: 'real-life-glasses-reflection.jpg',
    prompts: {
      points: [
        { x: 0.52, y: 0.48, label: 1 },
        { x: 0.08, y: 0.88, label: 0 },
      ],
      box: { x1: 0.16, y1: 0.25, x2: 0.88, y2: 0.78 },
    },
    positivePoint: { x: 0.52, y: 0.48 },
    note: 'Reflective object: a mirror image with skin, foliage, and hard highlights.',
  },
];

type OrtModule = typeof import('onnxruntime-node');

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs') as {
  PNG: {
    new (options: {
      width: number;
      height: number;
    }): {
      data: Uint8Array;
      width: number;
      height: number;
    };
    sync: { write(image: { data: Uint8Array; width: number; height: number }): Uint8Array };
  };
};
const jpeg = require('jpeg-js') as {
  decode(
    bytes: Uint8Array,
    options: { useTArray: boolean },
  ): {
    width: number;
    height: number;
    data: Uint8Array;
  };
};

type DecodedPhoto = { width: number; height: number; data: Uint8ClampedArray };

function decodePhoto(fileName: string): DecodedPhoto {
  const bytes = readFileSync(join(FIXTURE_ROOT, fileName));
  const decoded = jpeg.decode(new Uint8Array(bytes), { useTArray: true });
  return {
    width: decoded.width,
    height: decoded.height,
    data: new Uint8ClampedArray(decoded.data),
  };
}

function writeMaskPng(path: string, mask: Uint8Array, width: number, height: number): void {
  const png = new PNG({ width, height });
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    png.data[offset] = 255;
    png.data[offset + 1] = 255;
    png.data[offset + 2] = 255;
    png.data[offset + 3] = mask[index]!;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, PNG.sync.write(png));
}

async function predictSplit(
  ort: OrtModule,
  encoder: InferenceSession,
  decoder: InferenceSession,
  photo: DecodedPhoto,
  testCase: Case,
): Promise<{
  selected: ReturnType<typeof decodeEfficientSamDecoderOutput>;
  maskData: Float32Array;
  maskDims: number[];
  scoreData: Float32Array;
  encoderMs: number;
  decoderMs: number;
  rssBytes: number;
}> {
  const input = preprocessEfficientSamImageData(photo);
  const encoded = encodeEfficientSamPrompts(testCase.prompts, photo.width, photo.height);
  const encoderStarted = performance.now();
  const encoderOutputs = (await encoder.run({
    [encoder.inputNames[0]!]: new ort.Tensor('float32', input.tensor, [
      1,
      3,
      input.height,
      input.width,
    ]),
  })) as unknown as Record<string, Tensor>;
  const encoderMs = performance.now() - encoderStarted;
  const embedding = encoderOutputs.image_embeddings;
  if (!embedding) throw new Error('EfficientSAM encoder omitted image_embeddings');

  const decoderStarted = performance.now();
  const decoderOutputs = (await decoder.run({
    image_embeddings: embedding,
    batched_point_coords: new ort.Tensor(
      'float32',
      encoded.batched_point_coords.data,
      encoded.batched_point_coords.dims,
    ),
    batched_point_labels: new ort.Tensor(
      'float32',
      encoded.batched_point_labels.data,
      encoded.batched_point_labels.dims,
    ),
    orig_im_size: new ort.Tensor('int64', encoded.orig_im_size.data, encoded.orig_im_size.dims),
  })) as unknown as Record<string, Tensor>;
  const decoderMs = performance.now() - decoderStarted;
  const masks = decoderOutputs.output_masks;
  const scores = decoderOutputs.iou_predictions;
  if (!masks || !scores) throw new Error('EfficientSAM decoder omitted masks or scores');
  const selected = decodeEfficientSamDecoderOutput(
    masks.data as Float32Array,
    [...masks.dims],
    scores.data as Float32Array,
    [...scores.dims],
    photo.width,
    photo.height,
  );
  return {
    selected,
    maskData: masks.data as Float32Array,
    maskDims: [...masks.dims],
    scoreData: scores.data as Float32Array,
    encoderMs,
    decoderMs,
    rssBytes: process.memoryUsage().rss,
  };
}

describe('EfficientSAM-Ti real-model gate (gated)', () => {
  it.skipIf(!enabled)(
    'segments real photographs, checks split-vs-combined parity, and writes inspection evidence',
    async () => {
      const ort = await import('onnxruntime-node');
      const loadStarted = performance.now();
      const encoder = await ort.InferenceSession.create(ENCODER_PATH, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
      });
      const decoder = await ort.InferenceSession.create(DECODER_PATH, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
      });
      const combined = parityEnabled
        ? await ort.InferenceSession.create(COMBINED_PATH, {
            executionProviders: ['cpu'],
            graphOptimizationLevel: 'all',
          })
        : null;
      const modelLoadMs = performance.now() - loadStarted;
      const rows: Array<Record<string, unknown>> = [];

      for (const testCase of CASES) {
        const photo = decodePhoto(testCase.image);
        const prediction = await predictSplit(ort, encoder, decoder, photo, testCase);
        const { selected } = prediction;
        const selectedMask = selected.masks[selected.selectedIndex]!;
        const evidencePrefix = join(EVIDENCE_DIR, testCase.id);
        writeMaskPng(
          `${evidencePrefix}-selected-mask.png`,
          selectedMask.mask,
          photo.width,
          photo.height,
        );
        for (let index = 0; index < selected.masks.length; index += 1) {
          writeMaskPng(
            `${evidencePrefix}-candidate-${index + 1}.png`,
            selected.masks[index]!.mask,
            photo.width,
            photo.height,
          );
        }
        const positiveValue =
          selectedMask.mask[
            Math.max(
              0,
              Math.min(photo.height - 1, Math.round(testCase.positivePoint.y * photo.height)),
            ) *
              photo.width +
              Math.max(
                0,
                Math.min(photo.width - 1, Math.round(testCase.positivePoint.x * photo.width)),
              )
          ]!;

        let parity:
          | { scoreMaxAbsDiff: number; maskMaxAbsDiff: number; candidateCount: number }
          | undefined;
        if (combined) {
          const input = preprocessEfficientSamImageData(photo);
          const encoded = encodeEfficientSamPrompts(testCase.prompts, photo.width, photo.height);
          const combinedOutputs = (await combined.run({
            batched_images: new ort.Tensor('float32', input.tensor, [
              1,
              3,
              input.height,
              input.width,
            ]),
            batched_point_coords: new ort.Tensor(
              'float32',
              encoded.batched_point_coords.data,
              encoded.batched_point_coords.dims,
            ),
            batched_point_labels: new ort.Tensor(
              'float32',
              encoded.batched_point_labels.data,
              encoded.batched_point_labels.dims,
            ),
          })) as unknown as Record<string, Tensor>;
          const combinedScores = combinedOutputs.iou_predictions!.data as Float32Array;
          const combinedMasks = combinedOutputs.output_masks!.data as Float32Array;
          let scoreMaxAbsDiff = 0;
          for (let index = 0; index < combinedScores.length; index += 1) {
            scoreMaxAbsDiff = Math.max(
              scoreMaxAbsDiff,
              Math.abs(combinedScores[index]! - prediction.scoreData[index]!),
            );
          }
          let maskMaxAbsDiff = 0;
          for (let index = 0; index < combinedMasks.length; index += 1) {
            maskMaxAbsDiff = Math.max(
              maskMaxAbsDiff,
              Math.abs(combinedMasks[index]! - prediction.maskData[index]!),
            );
          }
          parity = {
            scoreMaxAbsDiff,
            maskMaxAbsDiff,
            candidateCount: combinedScores.length,
          };
          expect(scoreMaxAbsDiff).toBeLessThan(1e-6);
          expect(maskMaxAbsDiff).toBeLessThan(1e-6);
          expect(combinedScores.length).toBe(selected.masks.length);
        }

        const coverage =
          selectedMask.mask.reduce((sum, value) => sum + (value > 0 ? 1 : 0), 0) /
          selectedMask.mask.length;
        rows.push({
          id: testCase.id,
          image: testCase.image,
          note: testCase.note,
          width: photo.width,
          height: photo.height,
          resized: resizeEfficientSamDimensions(photo.width, photo.height),
          candidateCount: selected.masks.length,
          selectedIndex: selected.selectedIndex,
          scores: selected.masks.map((candidate) => candidate.score),
          coverage,
          positiveValue,
          encoderMs: prediction.encoderMs,
          decoderMs: prediction.decoderMs,
          rssBytes: prediction.rssBytes,
          parity,
          evidencePrefix,
        });
        console.log(
          `EFFICIENT REAL ${testCase.id.padEnd(24)} candidates ${selected.masks.length} coverage ${(coverage * 100).toFixed(1)}% positive ${positiveValue} enc ${Math.round(prediction.encoderMs)}ms dec ${Math.round(prediction.decoderMs)}ms rss ${Math.round(prediction.rssBytes / 1e6)}MB${parity ? ` parity(score ${parity.scoreMaxAbsDiff} mask ${parity.maskMaxAbsDiff})` : ''}`,
        );
        expect(selected.masks).toHaveLength(3);
        expect(selected.masks.every((candidate) => Number.isFinite(candidate.score))).toBe(true);
        expect(selected.selectedIndex).toBe(
          selected.masks.reduce(
            (best, candidate, index, candidates) =>
              candidate.score > candidates[best]!.score ? index : best,
            0,
          ),
        );
        expect(coverage).toBeGreaterThan(0.001);
        expect(coverage).toBeLessThan(0.999);
        expect(positiveValue).toBeGreaterThan(0);
      }

      mkdirSync(dirname(RESULTS_PATH), { recursive: true });
      writeFileSync(
        RESULTS_PATH,
        JSON.stringify(
          {
            provider: 'efficient-sam-ti',
            sourceRevision: 'yunyangx/EfficientSAM@main',
            artifacts: {
              encoder:
                'efficientsam_ti_encoder.onnx sha256 84ed466ffcc5c1f8d08409bc34a23bb364ab2c15e402cb12d4335a42be0e0951',
              decoder:
                'efficientsam_ti_decoder.onnx sha256 a62f8fa5ea080447c0689418d69e58f1e83e0b7adf9c142e2bd9bcc8045c0b11',
              combined: parityEnabled
                ? 'efficientsam_ti.onnx sha256 143c3198a7b2a15f23c21cdb723432fb3fbcdbabbdad3483cf3babd8b95c1397'
                : null,
            },
            modelLoadMs,
            modelRssBytes: process.memoryUsage().rss,
            parityEnabled,
            rows,
          },
          null,
          2,
        ),
      );
      expect(rows).toHaveLength(CASES.length);
    },
    1_800_000,
  );
});
