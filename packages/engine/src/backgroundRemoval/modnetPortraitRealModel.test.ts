// @vitest-environment node
/**
 * Real-model MODNet portrait gate (manual).
 *
 * Runs the pinned Xenova/modnet export through the exact preprocessing and
 * decoding contract the production worker uses and records numeric evidence:
 *
 *   - output geometry equals `modnetInputDimensions`;
 *   - alpha is finite and inside [0,1] without a second sigmoid;
 *   - portraits produce genuinely fractional edge coverage (a soft matte, not
 *     a binary cutout);
 *   - the reviewed-constraint fusion zeroes excluded background without
 *     darkening the support interior.
 *
 * Enable with:
 *   VARVE_MODNET_MODEL=/path/to/modnet/model.onnx
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type { InferenceSession, Tensor } from 'onnxruntime-node';
import { describe, expect, it } from 'vitest';
import {
  constrainPortraitAlpha,
  decodeModnetAlpha,
  modnetInputDimensions,
  preprocessModnetImageData,
  resizeAlphaArea,
} from './modnetPortrait';

const MODEL_PATH = process.env.VARVE_MODNET_MODEL ?? '';
const FIXTURE_ROOT = resolve(process.cwd(), 'tests/e2e/fixtures');
const EVIDENCE_DIR = process.env.VARVE_MODNET_EVIDENCE_DIR ?? '/tmp/varve-modnet-real-evidence';
const RESULTS_PATH = process.env.VARVE_MODNET_RESULTS_PATH ?? '/tmp/varve-modnet-results.json';
const enabled = MODEL_PATH.length > 0 && existsSync(MODEL_PATH);

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

function writeAlphaPng(path: string, alpha: Float32Array, width: number, height: number): void {
  const png = new PNG({ width, height });
  for (let index = 0; index < alpha.length; index += 1) {
    const offset = index * 4;
    png.data[offset] = 255;
    png.data[offset + 1] = 255;
    png.data[offset + 2] = 255;
    png.data[offset + 3] = Math.round(alpha[index]! * 255);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, PNG.sync.write(png));
}

describe('MODNet portrait real-model gate (gated)', () => {
  it.skipIf(!enabled)(
    'produces a fractional portrait matte and honours a reviewed constraint',
    async () => {
      const ort = await import('onnxruntime-node');
      const session: InferenceSession = await ort.InferenceSession.create(MODEL_PATH, {
        executionProviders: ['cpu'],
      });
      expect(session.inputNames).toContain('input');
      expect(session.outputNames).toContain('output');

      const cases = [
        { id: 'portrait', image: 'real-life-portrait.jpg' },
        { id: 'braided-portrait', image: 'real-life-braided-portrait.jpg' },
        { id: 'bearded-man', image: 'real-life-bearded-man.jpg' },
      ];
      const results: Array<Record<string, unknown>> = [];

      for (const testCase of cases) {
        const photo = decodePhoto(testCase.image);
        const dimensions = modnetInputDimensions(photo.width, photo.height);
        const { tensor, width, height } = preprocessModnetImageData(photo, dimensions);
        const started = performance.now();
        const outputs = (await session.run({
          input: new ort.Tensor('float32', tensor, [1, 3, height, width]),
        })) as unknown as Record<string, Tensor>;
        const inferenceMs = performance.now() - started;
        const output = outputs.output;
        if (!output) throw new Error('MODNet graph omitted the output tensor');
        const decoded = decodeModnetAlpha(output.data as Float32Array, [...output.dims]);
        expect(decoded.width).toBe(width);
        expect(decoded.height).toBe(height);
        expect(decoded.activationApplied).toBe(false);

        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        let fractional = 0;
        let covered = 0;
        for (const value of decoded.alpha) {
          if (!Number.isFinite(value)) throw new Error('MODNet alpha was not finite');
          if (value < min) min = value;
          if (value > max) max = value;
          if (value > 0.02 && value < 0.98) fractional += 1;
          if (value >= 0.5) covered += 1;
        }
        const pixels = decoded.alpha.length;
        const coverage = covered / pixels;
        const fractionalFraction = fractional / pixels;
        // Portraits occupy a plausible share of the frame and the matte must be
        // soft, not a thresholded binary silhouette.
        expect(coverage).toBeGreaterThan(0.02);
        expect(coverage).toBeLessThan(0.98);
        expect(fractionalFraction).toBeGreaterThan(0.001);

        const fullAlpha = resizeAlphaArea(
          decoded.alpha,
          decoded.width,
          decoded.height,
          photo.width,
          photo.height,
        );
        expect(fullAlpha.length).toBe(photo.width * photo.height);

        // Constraint fusion: exclude everything in the left quarter of the
        // frame; alpha inside the support must be preserved exactly.
        const constraint = new Uint8Array(photo.width * photo.height).fill(255);
        const cut = Math.floor(photo.width * 0.25);
        for (let y = 0; y < photo.height; y += 1) {
          for (let x = 0; x < cut; x += 1) constraint[y * photo.width + x] = 0;
        }
        const constrained = constrainPortraitAlpha(
          fullAlpha,
          photo.width,
          photo.height,
          constraint,
          {
            supportRadius: 0,
          },
        );
        let excludedAlpha = 0;
        for (let y = 0; y < photo.height; y += 1) {
          for (let x = 0; x < cut; x += 1) excludedAlpha += constrained[y * photo.width + x]!;
        }
        expect(excludedAlpha).toBe(0);
        const probeIndex = Math.floor((photo.height * 0.5 + (cut + 10)) * photo.width + cut + 10);
        expect(constrained[probeIndex]).toBeCloseTo(fullAlpha[probeIndex]!, 6);

        const evidencePath = join(EVIDENCE_DIR, `${testCase.id}-matte.png`);
        writeAlphaPng(evidencePath, decoded.alpha, decoded.width, decoded.height);
        results.push({
          case: testCase.id,
          source: `${photo.width}x${photo.height}`,
          modelInput: `${width}x${height}`,
          inferenceMs: Math.round(inferenceMs),
          coverage: Number(coverage.toFixed(4)),
          fractionalFraction: Number(fractionalFraction.toFixed(4)),
          min: Number(min.toFixed(4)),
          max: Number(max.toFixed(4)),
          evidence: evidencePath,
        });
      }

      mkdirSync(dirname(RESULTS_PATH), { recursive: true });
      writeFileSync(RESULTS_PATH, JSON.stringify({ model: MODEL_PATH, results }, null, 2));
      expect(results.length).toBe(cases.length);
    },
    120_000,
  );
});
