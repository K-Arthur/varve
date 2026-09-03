/**
 * Temporary, target-local pixels for a selected-pixel transform.
 *
 * AreaSelection remains in document space. A floating session samples it once
 * into a bounded target-pixel plane; preview and commit always sample that
 * immutable premultiplied plane, never a previous preview frame.
 */
import { type Affine, applyAffine, identity, tryInvertAffine } from '@varve/shared';
import {
  type AreaSelection,
  areaSelectionBounds,
  areaSelectionCoverageAt,
  createAreaSelection,
  MAX_AREA_SELECTION_DIMENSION,
  MAX_AREA_SELECTION_PIXELS,
  transformAreaSelection,
} from './areaSelection';

export type FloatingInterpolation = 'nearest' | 'bilinear';

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FloatingRasterSelection {
  /** Explicit node target. A floating selection never guesses a target. */
  targetNodeId: string;
  originalSelection: AreaSelection;
  /** Exact, target-clipped coverage used for transformed marching ants. */
  liftedSelection: AreaSelection;
  /** Target source-pixel rectangle that backs sourcePixels. */
  sourceRect: PixelRect;
  /** sourceRect's document-space AABB, used by handles and HUDs. */
  sourceBounds: PixelRect;
  /** Target source-pixel coordinate to document coordinate mapping. */
  sourceToDocument: Affine;
  coverageMask: Uint8Array;
  maskWidth: number;
  maskHeight: number;
  /** Immutable premultiplied RGBA8 contribution, including coverage. */
  sourcePixels: Uint8ClampedArray;
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  /** Immutable target ImageData snapshot used by preview and final commit. */
  targetPixels: Uint8ClampedArray;
  /** Source pixels visible through the image placement/crop. */
  visibleSourceRect: PixelRect;
  transform: Affine;
  interpolation: FloatingInterpolation;
  isMove: boolean;
}

export interface LiftPixelsOptions {
  targetNodeId?: string;
  /** Defaults to the origin arguments for plain 1:1 image targets. */
  sourceToDocument?: Affine;
  interpolation?: FloatingInterpolation;
  isMove?: boolean;
  /** Source-pixel clip for visible/cropped image content. */
  visibleSourceRect?: Partial<PixelRect>;
}

export interface CommitResult {
  /** Full target image in straight-alpha ImageData representation. */
  compositedPixels: Uint8ClampedArray;
  width: number;
  height: number;
  transformedSelection: AreaSelection | null;
  /** Target-local source ∪ destination dirty rectangle. */
  dirtyBounds: PixelRect;
}

const MAX_FLOATING_DIMENSION = MAX_AREA_SELECTION_DIMENSION;
// Preview keeps target + lifted + output planes alive. Keep the total below
// the 16.7M-pixel selection safety budget rather than allowing three 64MiB
// buffers for one interaction.
const MAX_FLOATING_PIXELS = Math.floor(MAX_AREA_SELECTION_PIXELS / 3);
const COVERAGE_SAMPLES = 4;
const IDENTITY_EPSILON = 1e-9;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function clampByte(value: number): number {
  return Math.round(clamp(value, 0, 255));
}

function validRect(rect: PixelRect): boolean {
  return [rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) && rect.w > 0 && rect.h > 0;
}

function isIdentityTransform(matrix: Affine): boolean {
  return (
    Math.abs(matrix[0] - 1) <= IDENTITY_EPSILON &&
    Math.abs(matrix[1]) <= IDENTITY_EPSILON &&
    Math.abs(matrix[2]) <= IDENTITY_EPSILON &&
    Math.abs(matrix[3] - 1) <= IDENTITY_EPSILON &&
    Math.abs(matrix[4]) <= IDENTITY_EPSILON &&
    Math.abs(matrix[5]) <= IDENTITY_EPSILON
  );
}

function transformedBounds(matrix: Affine, rect: PixelRect): PixelRect {
  const corners: readonly (readonly [number, number])[] = [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x + rect.w, rect.y + rect.h],
    [rect.x, rect.y + rect.h],
  ];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const corner of corners) {
    const [x, y] = applyAffine(matrix, corner);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) };
}

function clipToTarget(
  width: number,
  height: number,
  requested?: Partial<PixelRect>,
): PixelRect | null {
  const x = clamp(Math.floor(requested?.x ?? 0), 0, width);
  const y = clamp(Math.floor(requested?.y ?? 0), 0, height);
  const right = clamp(Math.ceil((requested?.x ?? 0) + (requested?.w ?? width)), 0, width);
  const bottom = clamp(Math.ceil((requested?.y ?? 0) + (requested?.h ?? height)), 0, height);
  return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : null;
}

function coverageAtTargetPixel(
  selection: AreaSelection,
  sourceToDocument: Affine,
  x: number,
  y: number,
): number {
  let total = 0;
  for (let sy = 0; sy < COVERAGE_SAMPLES; sy += 1) {
    for (let sx = 0; sx < COVERAGE_SAMPLES; sx += 1) {
      const [docX, docY] = applyAffine(sourceToDocument, [
        x + (sx + 0.5) / COVERAGE_SAMPLES,
        y + (sy + 0.5) / COVERAGE_SAMPLES,
      ]);
      total += areaSelectionCoverageAt(selection, { x: docX, y: docY });
    }
  }
  return clampByte((total / (COVERAGE_SAMPLES * COVERAGE_SAMPLES)) * 255);
}

function premultiply(
  source: Uint8ClampedArray | Uint8Array,
  offset: number,
): [number, number, number, number] {
  const alpha = source[offset + 3]! / 255;
  return [
    (source[offset]! / 255) * alpha,
    (source[offset + 1]! / 255) * alpha,
    (source[offset + 2]! / 255) * alpha,
    alpha,
  ];
}

function writeStraight(
  target: Uint8ClampedArray,
  offset: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  if (a <= 0) {
    target[offset] = 0;
    target[offset + 1] = 0;
    target[offset + 2] = 0;
    target[offset + 3] = 0;
    return;
  }
  target[offset] = clampByte((r / a) * 255);
  target[offset + 1] = clampByte((g / a) * 255);
  target[offset + 2] = clampByte((b / a) * 255);
  target[offset + 3] = clampByte(a * 255);
}

function samplePixels(
  floating: FloatingRasterSelection,
  x: number,
  y: number,
): [number, number, number, number] {
  if (x < -0.5 || y < -0.5 || x > floating.sourceWidth - 0.5 || y > floating.sourceHeight - 0.5) {
    return [0, 0, 0, 0];
  }
  const at = (px: number, py: number, channel: number) =>
    floating.sourcePixels[(py * floating.sourceWidth + px) * 4 + channel]! / 255;
  if (floating.interpolation === 'nearest') {
    const px = clamp(Math.round(x), 0, floating.sourceWidth - 1);
    const py = clamp(Math.round(y), 0, floating.sourceHeight - 1);
    return [at(px, py, 0), at(px, py, 1), at(px, py, 2), at(px, py, 3)];
  }
  const x0 = clamp(Math.floor(x), 0, floating.sourceWidth - 1);
  const y0 = clamp(Math.floor(y), 0, floating.sourceHeight - 1);
  const x1 = clamp(x0 + 1, 0, floating.sourceWidth - 1);
  const y1 = clamp(y0 + 1, 0, floating.sourceHeight - 1);
  const tx = clamp(x - Math.floor(x), 0, 1);
  const ty = clamp(y - Math.floor(y), 0, 1);
  const sample = (channel: number) => {
    const top = at(x0, y0, channel) * (1 - tx) + at(x1, y0, channel) * tx;
    const bottom = at(x0, y1, channel) * (1 - tx) + at(x1, y1, channel) * tx;
    return top * (1 - ty) + bottom * ty;
  };
  return [sample(0), sample(1), sample(2), sample(3)];
}

/**
 * Lift selected target pixels into an exact, bounded source plane. The source
 * plane is never downsampled: exceeding the safety limit returns null so the
 * caller can explain that a tiled implementation is required.
 */
export function liftSelectedPixels(
  selection: AreaSelection,
  targetPixels: Uint8ClampedArray | Uint8Array,
  targetWidth: number,
  targetHeight: number,
  targetOriginX = 0,
  targetOriginY = 0,
  options: LiftPixelsOptions = {},
): FloatingRasterSelection | null {
  if (
    !Number.isInteger(targetWidth) ||
    !Number.isInteger(targetHeight) ||
    targetWidth <= 0 ||
    targetHeight <= 0 ||
    targetPixels.length !== targetWidth * targetHeight * 4 ||
    targetWidth * targetHeight > MAX_FLOATING_PIXELS
  ) {
    return null;
  }
  const sourceToDocument = options.sourceToDocument ?? [1, 0, 0, 1, targetOriginX, targetOriginY];
  const documentToSource = tryInvertAffine(sourceToDocument);
  if (!documentToSource) return null;
  const sourceSelection = transformAreaSelection(selection, documentToSource);
  if (!sourceSelection) return null;
  const selectionBounds = areaSelectionBounds(sourceSelection.expression);
  const requested = {
    x: Math.floor(selectionBounds.x),
    y: Math.floor(selectionBounds.y),
    w: Math.ceil(selectionBounds.x + selectionBounds.w) - Math.floor(selectionBounds.x),
    h: Math.ceil(selectionBounds.y + selectionBounds.h) - Math.floor(selectionBounds.y),
  };
  const visible = clipToTarget(targetWidth, targetHeight, options.visibleSourceRect);
  if (!visible || !validRect(requested)) return null;
  const x = Math.max(requested.x, visible.x);
  const y = Math.max(requested.y, visible.y);
  const right = Math.min(requested.x + requested.w, visible.x + visible.w);
  const bottom = Math.min(requested.y + requested.h, visible.y + visible.h);
  const sourceRect = { x, y, w: right - x, h: bottom - y };
  if (
    !validRect(sourceRect) ||
    sourceRect.w > MAX_FLOATING_DIMENSION ||
    sourceRect.h > MAX_FLOATING_DIMENSION ||
    sourceRect.w * sourceRect.h > MAX_FLOATING_PIXELS
  ) {
    return null;
  }

  const coverageMask = new Uint8Array(sourceRect.w * sourceRect.h);
  const sourcePixels = new Uint8ClampedArray(sourceRect.w * sourceRect.h * 4);
  let hasCoverage = false;
  for (let py = 0; py < sourceRect.h; py += 1) {
    for (let px = 0; px < sourceRect.w; px += 1) {
      const targetX = sourceRect.x + px;
      const targetY = sourceRect.y + py;
      const index = py * sourceRect.w + px;
      const coverage = coverageAtTargetPixel(selection, sourceToDocument, targetX, targetY);
      coverageMask[index] = coverage;
      if (coverage === 0) continue;
      hasCoverage = true;
      const sourceOffset = (targetY * targetWidth + targetX) * 4;
      const destinationOffset = index * 4;
      const [r, g, b, a] = premultiply(targetPixels, sourceOffset);
      const factor = coverage / 255;
      sourcePixels[destinationOffset] = clampByte(r * factor * 255);
      sourcePixels[destinationOffset + 1] = clampByte(g * factor * 255);
      sourcePixels[destinationOffset + 2] = clampByte(b * factor * 255);
      sourcePixels[destinationOffset + 3] = clampByte(a * factor * 255);
    }
  }
  if (!hasCoverage) return null;
  const liftedSelection = createAreaSelection(
    {
      kind: 'raster-mask',
      x: sourceRect.x,
      y: sourceRect.y,
      w: sourceRect.w,
      h: sourceRect.h,
      width: sourceRect.w,
      height: sourceRect.h,
      data: coverageMask,
      boundary: [],
      transform: sourceToDocument,
      inverseTransform: documentToSource,
      feather: 0,
      antialias: false,
    },
    selection.generation,
  );
  if (!liftedSelection) return null;
  return {
    targetNodeId: options.targetNodeId ?? '',
    originalSelection: selection,
    liftedSelection,
    sourceRect,
    sourceBounds: transformedBounds(sourceToDocument, sourceRect),
    sourceToDocument,
    coverageMask,
    maskWidth: sourceRect.w,
    maskHeight: sourceRect.h,
    sourcePixels,
    sourceWidth: sourceRect.w,
    sourceHeight: sourceRect.h,
    targetWidth,
    targetHeight,
    targetPixels: new Uint8ClampedArray(targetPixels),
    visibleSourceRect: visible,
    transform: identity,
    interpolation: options.interpolation ?? 'bilinear',
    isMove: options.isMove ?? true,
  };
}

export function floatingTransformBounds(floating: FloatingRasterSelection): PixelRect {
  return transformedBounds(floating.transform, floating.sourceBounds);
}

/** Sample immutable lifted contribution at a document-space point. */
export function sampleFloatingAt(
  floating: FloatingRasterSelection,
  docX: number,
  docY: number,
): [number, number, number, number] {
  const transformInverse = tryInvertAffine(floating.transform);
  const documentToSource = tryInvertAffine(floating.sourceToDocument);
  if (!transformInverse || !documentToSource) return [0, 0, 0, 0];
  const originalDocument = applyAffine(transformInverse, [docX, docY]);
  const source = applyAffine(documentToSource, originalDocument);
  return samplePixels(
    floating,
    source[0] - floating.sourceRect.x - 0.5,
    source[1] - floating.sourceRect.y - 0.5,
  );
}

export function floatingTransformedSelection(
  floating: FloatingRasterSelection,
): AreaSelection | null {
  return transformAreaSelection(floating.liftedSelection, floating.transform);
}

/**
 * One authoritative source-over composite. Input/output are straight-alpha
 * ImageData, but lifting, filtering, source splitting, and blending are all
 * premultiplied. Output bytes outside the dirty source/destination regions are
 * copied verbatim, which preserves every zero-coverage source pixel exactly.
 */
export function commitFloatingSelection(
  floating: FloatingRasterSelection,
  targetPixels: Uint8ClampedArray | Uint8Array = floating.targetPixels,
  targetWidth = floating.targetWidth,
  targetHeight = floating.targetHeight,
): CommitResult | null {
  if (
    targetWidth !== floating.targetWidth ||
    targetHeight !== floating.targetHeight ||
    targetPixels.length !== targetWidth * targetHeight * 4
  ) {
    return null;
  }
  const transformInverse = tryInvertAffine(floating.transform);
  const documentToSource = tryInvertAffine(floating.sourceToDocument);
  if (!transformInverse || !documentToSource) return null;
  const output = new Uint8ClampedArray(targetPixels);
  // A click/Enter without a gesture is a true no-op. In particular, do not
  // recompose partially covered, semi-transparent edge pixels: Porter-Duff
  // splitting cannot reproduce a single source pixel byte-for-byte after a
  // fractional source-over round trip. Returning the immutable snapshot keeps
  // the no-op and cancel paths perfectly lossless.
  if (isIdentityTransform(floating.transform)) {
    return {
      compositedPixels: output,
      width: targetWidth,
      height: targetHeight,
      transformedSelection: floatingTransformedSelection(floating),
      dirtyBounds: { ...floating.sourceRect },
    };
  }
  const destinationDocumentBounds = floatingTransformBounds(floating);
  const destinationSourceBounds = transformedBounds(documentToSource, destinationDocumentBounds);
  const destination = clipToTarget(targetWidth, targetHeight, destinationSourceBounds);
  if (!destination) return null;

  if (floating.isMove) {
    for (let py = 0; py < floating.sourceHeight; py += 1) {
      for (let px = 0; px < floating.sourceWidth; px += 1) {
        const coverage = floating.coverageMask[py * floating.sourceWidth + px]! / 255;
        if (coverage === 0) continue;
        const x = floating.sourceRect.x + px;
        const y = floating.sourceRect.y + py;
        const offset = (y * targetWidth + x) * 4;
        const [r, g, b, a] = premultiply(targetPixels, offset);
        const remaining = 1 - coverage;
        writeStraight(output, offset, r * remaining, g * remaining, b * remaining, a * remaining);
      }
    }
  }

  for (let y = destination.y; y < destination.y + destination.h; y += 1) {
    for (let x = destination.x; x < destination.x + destination.w; x += 1) {
      const documentPoint = applyAffine(floating.sourceToDocument, [x + 0.5, y + 0.5]);
      const originalDocument = applyAffine(transformInverse, documentPoint);
      const source = applyAffine(documentToSource, originalDocument);
      const [fr, fg, fb, fa] = samplePixels(
        floating,
        source[0] - floating.sourceRect.x - 0.5,
        source[1] - floating.sourceRect.y - 0.5,
      );
      if (fa === 0) continue;
      const offset = (y * targetWidth + x) * 4;
      const [dr, dg, db, da] = premultiply(output, offset);
      writeStraight(
        output,
        offset,
        fr + dr * (1 - fa),
        fg + dg * (1 - fa),
        fb + db * (1 - fa),
        fa + da * (1 - fa),
      );
    }
  }
  const minX = Math.min(floating.sourceRect.x, destination.x);
  const minY = Math.min(floating.sourceRect.y, destination.y);
  const maxX = Math.max(
    floating.sourceRect.x + floating.sourceRect.w,
    destination.x + destination.w,
  );
  const maxY = Math.max(
    floating.sourceRect.y + floating.sourceRect.h,
    destination.y + destination.h,
  );
  return {
    compositedPixels: output,
    width: targetWidth,
    height: targetHeight,
    transformedSelection: floatingTransformedSelection(floating),
    dirtyBounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
  };
}
