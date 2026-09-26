/**
 * Non-square SAM2 mask reconstruction — geometric parity.
 *
 * The decoder emits logits in the *square encoder frame*. For any non-square
 * source the square contains letterbox padding, so the reconstruction has two
 * independent jobs: remove that padding and resample the logits back to source
 * pixels. Getting either wrong does not crash — it silently squeezes or
 * offsets the mask onto the wrong document pixels (the failure class that
 * took mask-vs-ground-truth IoU from 0.97 to 0.002 in production).
 *
 * These tests are model-free and deterministic:
 *
 * 1. Forward/inverse consistency — project a known source rectangle into the
 *    model frame, decode, and require the mask to land back on that rectangle.
 * 2. Padding isolation — logits that live only in the letterbox padding must
 *    never reach the source mask.
 * 3. Independent reference — the same reconstruction performed in the
 *    official SAM2 order (upsample to the model input size, crop padding,
 *    resample to source) must agree with the production order (crop padding
 *    in low-res mask space, resample once to source). Different code paths,
 *    same geometry: a disagreement means one of them is wrong.
 *
 * scripts/validate-pipelines/validate_sam2_pipeline.py certifies the same
 * reconstruction against the real weights; this file pins the geometry so a
 * regression fails without a model download.
 */
import { describe, expect, it } from 'vitest';
import { computeLetterboxGeometry } from '../letterboxGeometry';
import { decodeSam2DecoderOutput, SAM2_INPUT_SIZE, type Sam2Letterbox } from './sam2';

const MASK_W = 256;
const MASK_H = 256;

interface Fixture {
  label: string;
  sourceWidth: number;
  sourceHeight: number;
  /** Subject rectangle in source-image pixels. */
  rect: { x0: number; y0: number; x1: number; y1: number };
}

const FIXTURES: Fixture[] = [
  {
    label: 'square 1024x1024',
    sourceWidth: 1024,
    sourceHeight: 1024,
    rect: { x0: 200, y0: 180, x1: 700, y1: 640 },
  },
  {
    label: 'landscape 1920x1080',
    sourceWidth: 1920,
    sourceHeight: 1080,
    rect: { x0: 300, y0: 240, x1: 1400, y1: 900 },
  },
  {
    label: 'portrait 1080x1920',
    sourceWidth: 1080,
    sourceHeight: 1920,
    rect: { x0: 260, y0: 400, x1: 840, y1: 1500 },
  },
  {
    label: 'panoramic 4000x800',
    sourceWidth: 4000,
    sourceHeight: 800,
    rect: { x0: 900, y0: 150, x1: 3100, y1: 650 },
  },
];

function letterboxFor(fixture: Fixture): Sam2Letterbox {
  const geometry = computeLetterboxGeometry(
    fixture.sourceWidth,
    fixture.sourceHeight,
    SAM2_INPUT_SIZE,
    SAM2_INPUT_SIZE,
  );
  return { ...geometry };
}

/**
 * Build decoder logits (MASK_H x MASK_W) whose positive region is the given
 * source rectangle after the worker's letterbox scaling. Pixel centres are
 * used, which is the convention the canvas drawImage path implies.
 */
function buildLogits(
  fixture: Fixture,
  letterbox: Sam2Letterbox,
  mode: 'subject' | 'padding-only',
): Float32Array {
  const logits = new Float32Array(MASK_W * MASK_H);
  const { sourceWidth: sw, sourceHeight: sh, rect } = fixture;
  const contentW = letterbox.contentWidth ?? SAM2_INPUT_SIZE;
  const contentH = letterbox.contentHeight ?? SAM2_INPUT_SIZE;

  const contentToSourceX = sw / contentW;
  const contentToSourceY = sh / contentH;
  const maskToContentX = SAM2_INPUT_SIZE / MASK_W;
  const maskToContentY = SAM2_INPUT_SIZE / MASK_H;

  for (let my = 0; my < MASK_H; my += 1) {
    for (let mx = 0; mx < MASK_W; mx += 1) {
      // Mask pixel centre in model (1024) space, then in source space.
      const modelX = (mx + 0.5) * maskToContentX;
      const modelY = (my + 0.5) * maskToContentY;
      const insideContent =
        modelX >= letterbox.offsetX &&
        modelX <= letterbox.offsetX + contentW &&
        modelY >= letterbox.offsetY &&
        modelY <= letterbox.offsetY + contentH;
      const sourceX = (modelX - letterbox.offsetX) * contentToSourceX;
      const sourceY = (modelY - letterbox.offsetY) * contentToSourceY;
      const insideSubject =
        sourceX >= rect.x0 && sourceX <= rect.x1 && sourceY >= rect.y0 && sourceY <= rect.y1;

      const positive =
        mode === 'padding-only'
          ? !insideContent // logits sitting entirely in the padding bands
          : insideSubject;
      logits[my * MASK_W + mx] = positive ? 2.5 : -2.5;
    }
  }
  return logits;
}

/** Nearest-neighbour reference upscale used by the independent path. */
function nearestUpscale(
  data: Float32Array,
  srcH: number,
  srcW: number,
  dstH: number,
  dstW: number,
): Float32Array {
  const out = new Float32Array(dstH * dstW);
  for (let y = 0; y < dstH; y += 1) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
    for (let x = 0; x < dstW; x += 1) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
      out[y * dstW + x] = data[sy * srcW + sx] ?? 0;
    }
  }
  return out;
}

function bilinearToSource(
  data: Float32Array,
  srcH: number,
  srcW: number,
  dstH: number,
  dstW: number,
): Float32Array {
  const out = new Float32Array(dstH * dstW);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;
  for (let y = 0; y < dstH; y += 1) {
    const srcY = y * yRatio;
    const y0 = Math.min(Math.floor(srcY), srcH - 1);
    const y1 = Math.min(y0 + 1, srcH - 1);
    const wy = srcY - y0;
    for (let x = 0; x < dstW; x += 1) {
      const srcX = x * xRatio;
      const x0 = Math.min(Math.floor(srcX), srcW - 1);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const wx = srcX - x0;
      const top = (data[y0 * srcW + x0] ?? 0) * (1 - wx) + (data[y0 * srcW + x1] ?? 0) * wx;
      const bot = (data[y1 * srcW + x0] ?? 0) * (1 - wx) + (data[y1 * srcW + x1] ?? 0) * wx;
      out[y * dstW + x] = top * (1 - wy) + bot * wy;
    }
  }
  return out;
}

/**
 * Independent reconstruction in the official SAM2 order: upsample the low-res
 * logits to the model input size, crop the padding there, then resample the
 * surviving content down/up to source pixels and threshold once at zero.
 */
function referenceReconstruct(
  logits: Float32Array,
  letterbox: Sam2Letterbox,
  targetW: number,
  targetH: number,
): Uint8Array {
  const contentW = letterbox.contentWidth ?? SAM2_INPUT_SIZE;
  const contentH = letterbox.contentHeight ?? SAM2_INPUT_SIZE;
  const toInput = nearestUpscale(logits, MASK_H, MASK_W, SAM2_INPUT_SIZE, SAM2_INPUT_SIZE);
  const left = Math.round(letterbox.offsetX);
  const top = Math.round(letterbox.offsetY);
  const width = Math.round(contentW);
  const height = Math.round(contentH);
  const cropped = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    cropped.set(
      toInput.subarray(
        (top + y) * SAM2_INPUT_SIZE + left,
        (top + y) * SAM2_INPUT_SIZE + left + width,
      ),
      y * width,
    );
  }
  const resized = bilinearToSource(cropped, height, width, targetH, targetW);
  const mask = new Uint8Array(targetW * targetH);
  for (let i = 0; i < mask.length; i += 1) mask[i] = (resized[i] ?? 0) > 0 ? 255 : 0;
  return mask;
}

function productionReconstruct(
  logits: Float32Array,
  letterbox: Sam2Letterbox,
  targetW: number,
  targetH: number,
): Uint8Array {
  const result = decodeSam2DecoderOutput(
    logits,
    [1, 1, MASK_H, MASK_W],
    null,
    null,
    targetW,
    targetH,
    letterbox,
  );
  return result.masks[0]!.mask;
}

function maskBoundingBox(mask: Uint8Array, width: number, height: number) {
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

function countCoverage(mask: Uint8Array): number {
  let count = 0;
  for (const value of mask) if (value > 0) count += 1;
  return count;
}

function iouWithRect(
  mask: Uint8Array,
  width: number,
  height: number,
  rect: { x0: number; y0: number; x1: number; y1: number },
): number {
  let intersection = 0;
  let maskCount = 0;
  let rectCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inMask = mask[y * width + x]! > 0;
      const inRect = x >= rect.x0 && x < rect.x1 && y >= rect.y0 && y < rect.y1;
      if (inMask) maskCount += 1;
      if (inRect) rectCount += 1;
      if (inMask && inRect) intersection += 1;
    }
  }
  const union = maskCount + rectCount - intersection;
  return union > 0 ? intersection / union : 0;
}

describe('SAM2 non-square mask reconstruction', () => {
  for (const fixture of FIXTURES) {
    it(`lands a subject prompt back on its source rectangle — ${fixture.label}`, () => {
      const letterbox = letterboxFor(fixture);
      const logits = buildLogits(fixture, letterbox, 'subject');
      const mask = productionReconstruct(
        logits,
        letterbox,
        fixture.sourceWidth,
        fixture.sourceHeight,
      );

      expect(countCoverage(mask)).toBeGreaterThan(0);
      const bbox = maskBoundingBox(mask, fixture.sourceWidth, fixture.sourceHeight);
      expect(bbox).not.toBeNull();
      if (!bbox) return;

      // One mask pixel covers sourceW / contentW * 4 source pixels; a correct
      // reconstruction may only be off by the boundary sample, never by the
      // padding offset (which is hundreds of pixels on a non-square source).
      const contentW = letterbox.contentWidth ?? SAM2_INPUT_SIZE;
      const contentH = letterbox.contentHeight ?? SAM2_INPUT_SIZE;
      const tolX = Math.max(
        2,
        Math.ceil((fixture.sourceWidth / contentW) * (SAM2_INPUT_SIZE / MASK_W)) + 1,
      );
      const tolY = Math.max(
        2,
        Math.ceil((fixture.sourceHeight / contentH) * (SAM2_INPUT_SIZE / MASK_H)) + 1,
      );

      expect(bbox.minX).toBeGreaterThanOrEqual(fixture.rect.x0 - tolX);
      expect(bbox.minY).toBeGreaterThanOrEqual(fixture.rect.y0 - tolY);
      expect(bbox.maxX).toBeLessThanOrEqual(fixture.rect.x1 + tolX);
      expect(bbox.maxY).toBeLessThanOrEqual(fixture.rect.y1 + tolY);
      // The mask must actually cover the subject, not a shifted sub-region.
      expect(bbox.maxX - bbox.minX).toBeGreaterThanOrEqual(
        fixture.rect.x1 - fixture.rect.x0 - tolX * 2,
      );
      expect(bbox.maxY - bbox.minY).toBeGreaterThanOrEqual(
        fixture.rect.y1 - fixture.rect.y0 - tolY * 2,
      );

      const iou = iouWithRect(mask, fixture.sourceWidth, fixture.sourceHeight, fixture.rect);
      expect(iou).toBeGreaterThanOrEqual(0.95);
    });

    it(`agrees with the independent official-order reference — ${fixture.label}`, () => {
      const letterbox = letterboxFor(fixture);
      const logits = buildLogits(fixture, letterbox, 'subject');
      const production = productionReconstruct(
        logits,
        letterbox,
        fixture.sourceWidth,
        fixture.sourceHeight,
      );
      const reference = referenceReconstruct(
        logits,
        letterbox,
        fixture.sourceWidth,
        fixture.sourceHeight,
      );

      let intersection = 0;
      let union = 0;
      for (let i = 0; i < production.length; i += 1) {
        const p = production[i]! > 0;
        const r = reference[i]! > 0;
        if (p || r) union += 1;
        if (p && r) intersection += 1;
      }
      expect(union).toBeGreaterThan(0);
      expect(intersection / union).toBeGreaterThanOrEqual(0.95);
    });

    it(`keeps padding-only logits out of the source mask — ${fixture.label}`, () => {
      const letterbox = letterboxFor(fixture);
      const logits = buildLogits(fixture, letterbox, 'padding-only');
      const mask = productionReconstruct(
        logits,
        letterbox,
        fixture.sourceWidth,
        fixture.sourceHeight,
      );
      // Padding-only means "positive outside the content rectangle, negative
      // inside it". On a non-square source those logits live entirely in the
      // letterbox bands and must never survive the crop; on a square source
      // there is no band at all, so the fixture degenerates to an all-negative
      // field, which is likewise empty.
      expect(countCoverage(mask)).toBe(0);
    });
  }
});
