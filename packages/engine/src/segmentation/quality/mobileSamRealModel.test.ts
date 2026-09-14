// @vitest-environment node
/**
 * Real-photo MobileSAM gate.
 *
 * This is intentionally separate from the generated oracle corpus. The
 * generated corpus checks tensor/metric contracts; these photographs check
 * whether a real provider remains usable on the kinds of images that cause
 * selection complaints: hair, a bounded animal, a busy still life, and a
 * reflective scene. The test records masks for human inspection rather than
 * inventing ground truth from another model.
 *
 * Enable with:
 *   VARVE_MOBILE_SAM_MODEL_DIR=/path/to/mobile-sam
 *
 * Required files are `mobile_sam_image_encoder.onnx` and
 * `sam_mask_decoder_multi.onnx`. Evidence defaults to `/tmp` so model output
 * never becomes a repository asset.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import jpeg from 'jpeg-js';
import type { InferenceSession, Tensor } from 'onnxruntime-node';
import { describe, expect, it } from 'vitest';
import {
  decodeMobileSamDecoderOutput,
  encodeMobileSamPrompts,
  preprocessMobileSamImageData,
} from '../../inference/models/mobileSam';

const MODEL_DIR = process.env.VARVE_MOBILE_SAM_MODEL_DIR ?? '';
const ENCODER_PATH = join(MODEL_DIR, 'mobile_sam_image_encoder.onnx');
const DECODER_PATH = join(MODEL_DIR, 'sam_mask_decoder_multi.onnx');
const FIXTURE_ROOT = resolve(process.cwd(), 'tests/e2e/fixtures');
const EVIDENCE_DIR =
  process.env.VARVE_MOBILE_SAM_EVIDENCE_DIR ?? '/tmp/varve-mobilesam-real-evidence';
const RESULTS_PATH =
  process.env.VARVE_MOBILE_SAM_RESULTS_PATH ?? '/tmp/varve-mobilesam-real-results.json';
const enabled = MODEL_DIR.length > 0 && existsSync(ENCODER_PATH) && existsSync(DECODER_PATH);

type Case = {
  id: string;
  image: string;
  /** Coordinates are normalized in the decoded source image. */
  prompts: {
    points: Array<{ x: number; y: number; label: 0 | 1 }>;
    box?: { x1: number; y1: number; x2: number; y2: number };
  };
  positivePoint: { x: number; y: number };
  negativePoint?: { x: number; y: number };
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
    negativePoint: { x: 0.86, y: 0.08 },
    note: 'Busy still life: prompt a sunflower while excluding the dark background.',
  },
  {
    id: 'portrait-braids',
    image: 'real-life-braided-portrait.jpg',
    prompts: {
      points: [
        { x: 0.36, y: 0.45, label: 1 },
        { x: 0.08, y: 0.08, label: 0 },
      ],
    },
    positivePoint: { x: 0.36, y: 0.45 },
    negativePoint: { x: 0.08, y: 0.08 },
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
        { x: 0.36, y: 0.38, label: 1 },
        { x: 0.08, y: 0.88, label: 0 },
      ],
      box: { x1: 0.16, y1: 0.25, x2: 0.88, y2: 0.78 },
    },
    positivePoint: { x: 0.36, y: 0.38 },
    negativePoint: { x: 0.08, y: 0.88 },
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

type DecodedPhoto = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

function decodePhoto(fileName: string): DecodedPhoto {
  const bytes = readFileSync(join(FIXTURE_ROOT, fileName));
  const decoded = jpeg.decode(bytes, { useTArray: true });
  return {
    width: decoded.width,
    height: decoded.height,
    data: new Uint8ClampedArray(decoded.data),
  };
}

function writeMaskPng(path: string, mask: Uint8Array, width: number, height: number): void {
  const png = new PNG({ width, height });
  for (let index = 0; index < mask.length; index += 1) {
    const value = mask[index]!;
    const offset = index * 4;
    png.data[offset] = 255;
    png.data[offset + 1] = 255;
    png.data[offset + 2] = 255;
    png.data[offset + 3] = value;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, PNG.sync.write(png));
}

function maskCoverage(mask: Uint8Array): number {
  let covered = 0;
  for (const value of mask) if (value > 0) covered += 1;
  return covered / Math.max(1, mask.length);
}

function pointIndex(point: { x: number; y: number }, width: number, height: number): number {
  const x = Math.max(0, Math.min(width - 1, Math.round(point.x * (width - 1))));
  const y = Math.max(0, Math.min(height - 1, Math.round(point.y * (height - 1))));
  return y * width + x;
}

async function predictCase(
  ort: OrtModule,
  encoder: InferenceSession,
  decoder: InferenceSession,
  photo: DecodedPhoto,
  testCase: Case,
): Promise<{
  selected: ReturnType<typeof decodeMobileSamDecoderOutput>;
  encoderMs: number;
  decoderMs: number;
  rssBytes: number;
}> {
  const input = preprocessMobileSamImageData(photo);
  const encoderStarted = performance.now();
  const encoderOutputs = (await encoder.run({
    [encoder.inputNames[0]!]: new ort.Tensor('float32', input.tensor, [
      input.height,
      input.width,
      3,
    ]),
  })) as unknown as Record<string, Tensor>;
  const encoderMs = performance.now() - encoderStarted;
  const embedding = encoderOutputs.image_embeddings as Tensor | undefined;
  if (!embedding) throw new Error('MobileSAM encoder omitted image_embeddings');

  const encoded = encodeMobileSamPrompts(testCase.prompts, photo.width, photo.height);
  const decoderStarted = performance.now();
  const decoderOutputs = (await decoder.run({
    image_embeddings: embedding,
    point_coords: new ort.Tensor('float32', encoded.point_coords!.data, encoded.point_coords!.dims),
    point_labels: new ort.Tensor('float32', encoded.point_labels!.data, encoded.point_labels!.dims),
    mask_input: new ort.Tensor('float32', encoded.mask_input!.data, encoded.mask_input!.dims),
    has_mask_input: new ort.Tensor(
      'float32',
      encoded.has_mask_input!.data,
      encoded.has_mask_input!.dims,
    ),
    orig_im_size: new ort.Tensor('float32', encoded.orig_im_size!.data, encoded.orig_im_size!.dims),
  })) as unknown as Record<string, Tensor>;
  const decoderMs = performance.now() - decoderStarted;
  const masks = decoderOutputs.masks;
  const scores = decoderOutputs.iou_predictions;
  const lowRes = decoderOutputs.low_res_masks;
  if (!masks || !scores) throw new Error('MobileSAM decoder omitted masks or scores');
  const selected = decodeMobileSamDecoderOutput(
    masks.data as Float32Array,
    [...masks.dims],
    scores.data as Float32Array,
    [...scores.dims],
    photo.width,
    photo.height,
    lowRes?.data as Float32Array | undefined,
    lowRes ? [...lowRes.dims] : undefined,
  );
  return {
    selected,
    encoderMs,
    decoderMs,
    rssBytes: process.memoryUsage().rss,
  };
}

describe('MobileSAM real-photo provider gate (gated)', () => {
  it.skipIf(!enabled)(
    'segments real photographs through the pinned encoder/decoder and writes inspection evidence',
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
      const modelLoadMs = performance.now() - loadStarted;
      const rows: Array<Record<string, unknown>> = [];

      for (const testCase of CASES) {
        const photo = decodePhoto(testCase.image);
        const prediction = await predictCase(ort, encoder, decoder, photo, testCase);
        const { selected } = prediction;
        const selectedMask = selected.masks[selected.selectedIndex]!;
        const coverage = maskCoverage(selectedMask.mask);
        const positiveValue =
          selectedMask.mask[pointIndex(testCase.positivePoint, photo.width, photo.height)]!;
        const negativeValue = testCase.negativePoint
          ? selectedMask.mask[pointIndex(testCase.negativePoint, photo.width, photo.height)]!
          : null;
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
        const row = {
          id: testCase.id,
          image: testCase.image,
          note: testCase.note,
          width: photo.width,
          height: photo.height,
          candidateCount: selected.masks.length,
          selectedIndex: selected.selectedIndex,
          scores: selected.masks.map((candidate) => candidate.score),
          scoreSource: selected.scoreSource,
          coverage,
          positiveValue,
          negativeValue,
          encoderMs: prediction.encoderMs,
          decoderMs: prediction.decoderMs,
          rssBytes: prediction.rssBytes,
          evidencePrefix,
        };
        rows.push(row);
        console.log(
          `MOBILE REAL ${testCase.id.padEnd(24)} candidates ${selected.masks.length} coverage ${(coverage * 100).toFixed(1)}% positive ${positiveValue} negative ${negativeValue ?? 'n/a'} encoder ${Math.round(prediction.encoderMs)}ms decoder ${Math.round(prediction.decoderMs)}ms rss ${Math.round(prediction.rssBytes / 1e6)}MB`,
        );
        expect(selected.masks).toHaveLength(4);
        expect(selected.scoreSource).toBe('predicted-iou');
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
            provider: 'mobile-sam',
            sourceRevision: 'Acly/MobileSAM@0d3b403339b4674a82493d5e97964ddc8',
            modelLoadMs,
            modelRssBytes: process.memoryUsage().rss,
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
