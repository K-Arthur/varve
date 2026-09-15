// @vitest-environment node
/**
 * Real-model Grounding DINO Tiny gate (manual).
 *
 * Runs the pinned int8 ONNX graph through the exact production
 * preprocessing/tokenization/decoding functions and records numeric and
 * visual evidence:
 *
 *   - tokenizer ids match the reference transformers.js tokenizer for the
 *     documented query convention (lowercase, trailing period);
 *   - real photographs produce detections above the published thresholds;
 *   - boxes are converted from normalized center/size to source-pixel corners;
 *   - phrase association survives multi-token words and multiple phrases.
 *
 * Enable with:
 *   VARVE_GROUNDING_DINO_MODEL=/path/to/model_int8.onnx
 *   VARVE_GROUNDING_DINO_VOCAB=/path/to/vocab.txt
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type { InferenceSession, Tensor } from 'onnxruntime-node';
import { describe, expect, it } from 'vitest';
import {
  bertTokenize,
  buildGroundingDinoInputs,
  decodeGroundingDinoOutput,
  locatePhraseSpans,
  normalizeGroundingQuery,
  parseBertVocab,
} from './groundingDino';

const MODEL_PATH = process.env.VARVE_GROUNDING_DINO_MODEL ?? '';
const VOCAB_PATH = process.env.VARVE_GROUNDING_DINO_VOCAB ?? '';
const FIXTURE_ROOT = resolve(process.cwd(), 'tests/e2e/fixtures');
const EVIDENCE_DIR =
  process.env.VARVE_GROUNDING_DINO_EVIDENCE_DIR ?? '/tmp/varve-grounding-dino-evidence';
const RESULTS_PATH =
  process.env.VARVE_GROUNDING_DINO_RESULTS_PATH ?? '/tmp/varve-grounding-dino-results.json';
const enabled =
  MODEL_PATH.length > 0 &&
  VOCAB_PATH.length > 0 &&
  existsSync(MODEL_PATH) &&
  existsSync(VOCAB_PATH);

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
  ): { width: number; height: number; data: Uint8Array };
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

function writeOverlay(
  path: string,
  photo: DecodedPhoto,
  boxes: Array<{ x1: number; y1: number; x2: number; y2: number }>,
): void {
  const png = new PNG({ width: photo.width, height: photo.height });
  png.data.set(photo.data);
  for (const box of boxes) {
    const x1 = Math.max(0, Math.round(box.x1));
    const y1 = Math.max(0, Math.round(box.y1));
    const x2 = Math.min(photo.width - 1, Math.round(box.x2));
    const y2 = Math.min(photo.height - 1, Math.round(box.y2));
    const thickness = Math.max(2, Math.round(Math.max(photo.width, photo.height) / 300));
    for (let t = 0; t < thickness; t += 1) {
      for (let x = x1; x <= x2; x += 1) {
        for (const y of [y1 + t, y2 - t]) {
          if (x < 0 || y < 0 || y >= photo.height) continue;
          const at = (y * photo.width + x) * 4;
          png.data[at] = 255;
          png.data[at + 1] = 32;
          png.data[at + 2] = 32;
          png.data[at + 3] = 255;
        }
      }
      for (let y = y1; y <= y2; y += 1) {
        for (const x of [x1 + t, x2 - t]) {
          if (x < 0 || y < 0 || x >= photo.width) continue;
          const at = (y * photo.width + x) * 4;
          png.data[at] = 255;
          png.data[at + 1] = 32;
          png.data[at + 2] = 32;
          png.data[at + 3] = 255;
        }
      }
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, PNG.sync.write(png));
}

describe('Grounding DINO Tiny real-model gate (gated)', () => {
  it.skipIf(!enabled)(
    'finds described objects in real photographs and records evidence',
    async () => {
      const vocab = parseBertVocab(readFileSync(VOCAB_PATH, 'utf8'));

      // Reference ids captured from transformers.js AutoTokenizer
      // (onnx-community/grounding-dino-tiny-ONNX @ ff690b0a) on 2026-09-15.
      expect(bertTokenize('a cat.', vocab).ids).toEqual([101, 1037, 4937, 1012, 102]);
      expect(bertTokenize('the red mug.', vocab).ids).toEqual([101, 1996, 2417, 14757, 1012, 102]);
      expect(bertTokenize('person. dog.', vocab).ids).toEqual([101, 2711, 1012, 3899, 1012, 102]);
      expect(bertTokenize('café table.', vocab).ids).toEqual([101, 7668, 2795, 1012, 102]);
      expect(bertTokenize('  spaced   out  ', vocab).ids).toEqual([101, 19835, 2041, 102]);

      const ort = await import('onnxruntime-node');
      const session: InferenceSession = await ort.InferenceSession.create(MODEL_PATH, {
        executionProviders: ['cpu'],
      });

      const cases = [
        { id: 'elephant', image: 'real-life-elephant.jpg', query: 'elephant.' },
        { id: 'still-life', image: 'real-life-still-life.jpg', query: 'sunflower.' },
        { id: 'portrait', image: 'real-life-portrait.jpg', query: 'person.' },
        { id: 'multi', image: 'real-life-elephant.jpg', query: 'elephant. tree.' },
      ];
      const results: Array<Record<string, unknown>> = [];
      let rssBytes = 0;

      for (const testCase of cases) {
        const photo = decodePhoto(testCase.image);
        const query = normalizeGroundingQuery(testCase.query);
        const tokenization = bertTokenize(query.normalized, vocab);
        const spans = locatePhraseSpans(tokenization, query.phrases, vocab);
        const inputs = buildGroundingDinoInputs(photo, tokenization);
        const feeds: Record<string, Tensor> = {};
        for (const [name, tensor] of Object.entries(inputs)) {
          feeds[name] = new ort.Tensor(tensor.dtype ?? 'float32', tensor.data, tensor.dims);
        }
        const started = performance.now();
        const outputs = (await session.run(feeds)) as unknown as Record<string, Tensor>;
        const inferenceMs = performance.now() - started;
        rssBytes = Math.max(rssBytes, process.memoryUsage().rss);
        const logits = outputs.logits;
        const boxes = outputs.pred_boxes;
        if (!logits || !boxes) throw new Error('Grounding DINO graph omitted logits or boxes');
        const detections = decodeGroundingDinoOutput(
          logits.data as Float32Array,
          [...logits.dims],
          boxes.data as Float32Array,
          [...boxes.dims],
          tokenization,
          photo.width,
          photo.height,
          { phraseSpans: spans },
        );
        expect(detections.length).toBeGreaterThan(0);
        const top = detections[0]!;
        expect(top.score).toBeGreaterThan(0.3);
        expect(top.box.x2).toBeGreaterThan(top.box.x1);
        expect(top.box.y2).toBeGreaterThan(top.box.y1);
        expect(top.box.x1).toBeGreaterThanOrEqual(0);
        expect(top.box.y1).toBeGreaterThanOrEqual(0);
        expect(top.box.x2).toBeLessThanOrEqual(photo.width);
        expect(top.box.y2).toBeLessThanOrEqual(photo.height);

        const evidencePath = join(EVIDENCE_DIR, `${testCase.id}-detections.png`);
        writeOverlay(
          evidencePath,
          photo,
          detections.slice(0, 8).map((item) => item.box),
        );
        results.push({
          case: testCase.id,
          query: testCase.query,
          phrases: query.phrases,
          tokens: tokenization.ids.length,
          detections: detections.slice(0, 8).map((item) => ({
            phrase: item.phrase,
            phraseIndex: item.phraseIndex,
            score: Number(item.score.toFixed(4)),
            box: {
              x1: Math.round(item.box.x1),
              y1: Math.round(item.box.y1),
              x2: Math.round(item.box.x2),
              y2: Math.round(item.box.y2),
            },
          })),
          inferenceMs: Math.round(inferenceMs),
          evidence: evidencePath,
        });
      }

      mkdirSync(dirname(RESULTS_PATH), { recursive: true });
      writeFileSync(
        RESULTS_PATH,
        JSON.stringify({ model: MODEL_PATH, rssBytes, results }, null, 2),
      );
      expect(results.length).toBe(cases.length);
    },
    600_000,
  );
});
