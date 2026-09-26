/**
 * Real-model reconstruction parity — production vs the Python reference.
 *
 * scripts/validate-pipelines/dump_sam2_fixture.py runs the actual SAM2
 * weights once and freezes the decoder's raw logits together with its own
 * reconstruction of them. This test decodes those *identical bytes* with the
 * production TypeScript path and requires it to agree with the reference and
 * with source-space ground truth.
 *
 * This is the check a shape-only unit test cannot make: it proves that the
 * application's letterbox crop + resample + threshold order lands on the same
 * pixels the certified reference predictor produces, on real model output,
 * for square, landscape, portrait, and panoramic sources.
 *
 * The fixture requires the ONNX weights, so the test is gated exactly like
 * the other real-model gates:
 *
 *     python scripts/validate-pipelines/dump_sam2_fixture.py --out /tmp/sam2-parity
 *     SAM2_REAL_PARITY_DIR=/tmp/sam2-parity npx vitest run \
 *         packages/engine/src/inference/models/sam2RealReconstructionParity.test.ts
 *
 * Without SAM2_REAL_PARITY_DIR the suite skips and says why — it never
 * reports a pass it did not earn.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeSam2DecoderOutput, type Sam2Letterbox } from './sam2';

interface FixtureGeometry {
  case: string;
  sourceWidth: number;
  sourceHeight: number;
  offsetX: number;
  offsetY: number;
  contentWidth: number;
  contentHeight: number;
  modelInputSize: number;
  maskWidth: number;
  maskHeight: number;
  groundTruth: { x0: number; y0: number; x1: number; y1: number };
  bestIndex: number;
  modelIou: number;
}

const FIXTURE_DIR = process.env.SAM2_REAL_PARITY_DIR ?? '';
const describeReal = FIXTURE_DIR ? describe : describe.skip;

/** Parse a binary PGM (P5) with an optional comment line. */
function readPgm(filePath: string): { width: number; height: number; data: Uint8Array } {
  const bytes = fs.readFileSync(filePath);
  // Copy out of the shared Buffer pool: views must only span this file.
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const view = new Uint8Array(buffer);
  let offset = 0;
  const readToken = (): string => {
    while (offset < view.length) {
      const byte = view[offset];
      if (byte === 0x23) {
        // comment to end of line
        while (offset < view.length && view[offset] !== 0x0a) offset += 1;
      } else if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) {
        offset += 1;
      } else {
        break;
      }
    }
    const start = offset;
    while (offset < view.length) {
      const byte = view[offset];
      if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) break;
      offset += 1;
    }
    // Uint8Array#toString joins bytes with commas — decode explicitly.
    return Buffer.from(view.buffer, start, offset - start).toString('ascii');
  };

  const magic = readToken();
  if (magic !== 'P5') throw new Error(`Unsupported PGM magic: ${magic}`);
  const width = Number(readToken());
  const height = Number(readToken());
  const maxValue = Number(readToken());
  if (maxValue !== 255) throw new Error(`Unsupported PGM max value: ${maxValue}`);
  if (view[offset] === 0x0a || view[offset] === 0x0d) offset += 1;
  const data = view.subarray(offset);
  if (data.length < width * height) {
    throw new Error(`Truncated PGM: expected ${width * height} bytes, got ${data.length}`);
  }
  return { width, height, data: data.subarray(0, width * height) };
}

function iou(a: Uint8Array, b: Uint8Array): number {
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i]! > 0;
    const bv = b[i]! > 0;
    if (av && bv) intersection += 1;
    if (av || bv) union += 1;
  }
  return union > 0 ? intersection / union : 0;
}

function bbox(mask: Uint8Array, width: number, height: number) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] === 0) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

describeReal('SAM2 production reconstruction vs real reference output', () => {
  const cases = FIXTURE_DIR
    ? fs
        .readdirSync(FIXTURE_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];

  if (FIXTURE_DIR && cases.length === 0) {
    throw new Error(`SAM2_REAL_PARITY_DIR=${FIXTURE_DIR} contains no fixture cases`);
  }

  for (const caseName of cases) {
    it(`matches the reference predictor on real decoder logits — ${caseName}`, () => {
      const dir = path.join(FIXTURE_DIR, caseName);
      const geometry = JSON.parse(
        fs.readFileSync(path.join(dir, 'geometry.json'), 'utf8'),
      ) as FixtureGeometry;
      const logitsFile = fs.readFileSync(path.join(dir, 'logits.f32'));
      const logits = new Float32Array(
        logitsFile.buffer.slice(
          logitsFile.byteOffset,
          logitsFile.byteOffset + logitsFile.byteLength,
        ),
      );
      // The real graph publishes iou_predictions, and production ranks the
      // candidate set with it. Feeding the same scores keeps the comparison
      // about mask reconstruction rather than the activation fallback.
      const modelIous = JSON.parse(
        fs.readFileSync(path.join(dir, 'ious.json'), 'utf8'),
      ) as number[];
      const iouData = new Float32Array(modelIous);
      const reference = readPgm(path.join(dir, 'reference_mask.pgm'));
      const groundTruth = readPgm(path.join(dir, 'gt_mask.pgm'));

      const { sourceWidth, sourceHeight, maskWidth, maskHeight } = geometry;
      expect(reference.width).toBe(sourceWidth);
      expect(reference.height).toBe(sourceHeight);
      expect(groundTruth.width).toBe(sourceWidth);
      expect(groundTruth.height).toBe(sourceHeight);
      expect(logits.length).toBe(3 * maskWidth * maskHeight);

      const letterbox: Sam2Letterbox = {
        offsetX: geometry.offsetX,
        offsetY: geometry.offsetY,
        contentWidth: geometry.contentWidth,
        contentHeight: geometry.contentHeight,
      };
      const decoded = decodeSam2DecoderOutput(
        logits,
        [1, 3, maskHeight, maskWidth],
        iouData,
        [1, modelIous.length],
        sourceWidth,
        sourceHeight,
        letterbox,
      );
      expect(decoded.selectedIndex).toBe(geometry.bestIndex);

      const best = decoded.masks[decoded.selectedIndex]!;
      const productionMask = best.mask;
      expect(productionMask.length).toBe(sourceWidth * sourceHeight);

      // 1. The production mask must clear the ground-truth thresholds the
      //    Python validator enforces for this case, with margin: measured
      //    2026-09-26 on real logits was 0.987 (square), 0.969 (wide),
      //    0.971 (tall), 0.939 (panoramic). The letterbox bug class scores
      //    ~0.002, so these gates have enormous separation from regression
      //    while staying below every observed value.
      const minIou = sourceWidth === sourceHeight ? 0.9 : 0.85;
      const gtIou = iou(productionMask, groundTruth.data);
      const referenceIou = iou(productionMask, reference.data);
      const referenceGtIou = iou(reference.data, groundTruth.data);
      const productionBox = bbox(productionMask, sourceWidth, sourceHeight);
      const referenceBox = bbox(reference.data, sourceWidth, sourceHeight);
      const gtBox = bbox(groundTruth.data, sourceWidth, sourceHeight);

      console.log(
        `[parity:${caseName}] production-vs-GT IoU=${gtIou.toFixed(4)} ` +
          `reference-vs-GT IoU=${referenceGtIou.toFixed(4)} ` +
          `production-vs-reference IoU=${referenceIou.toFixed(4)} ` +
          `model IoU=${geometry.modelIou.toFixed(3)} ` +
          `(${sourceWidth}x${sourceHeight})\n` +
          `  production bbox=${JSON.stringify(productionBox)}\n` +
          `  reference  bbox=${JSON.stringify(referenceBox)}\n` +
          `  groundtruth bbox=${JSON.stringify(gtBox)}`,
      );

      expect(gtIou).toBeGreaterThanOrEqual(minIou);

      // 2. Production and the independent reference reconstruct the *same*
      //    subject from the same logits. They intentionally resample in
      //    different orders (production crops low-res logits and thresholds
      //    once after a bilinear resize; the validator thresholds at the
      //    model input size and resamples with nearest), so agreement is
      //    bounded by roughly one mask pixel, not by identity — measured
      //    0.993 / 0.955 / 0.939 / 0.907 across the four fixtures.
      expect(referenceIou).toBeGreaterThanOrEqual(0.85);

      // 3. Their extents must agree — a systematic offset shows up here even
      //    when the IoU still looks healthy on a large subject.
      expect(productionBox).not.toBeNull();
      expect(referenceBox).not.toBeNull();
      if (!productionBox || !referenceBox) return;
      const tolerance = Math.max(
        4,
        Math.ceil(
          (Math.max(sourceWidth, sourceHeight) /
            Math.max(geometry.contentWidth, geometry.contentHeight)) *
            4,
        ),
      );
      expect(Math.abs(productionBox.minX - referenceBox.minX)).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(productionBox.minY - referenceBox.minY)).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(productionBox.maxX - referenceBox.maxX)).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(productionBox.maxY - referenceBox.maxY)).toBeLessThanOrEqual(tolerance);
    });
  }

  it('has a fixture set to evaluate', () => {
    expect(cases.length).toBeGreaterThan(0);
  });
});
