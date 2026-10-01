import {
  forEachPatternInstance,
  PATTERN_MAX_INSTANCES,
  type PatternRepeatParams,
  patternIndexRange,
  resolvePatternLattice,
} from '@varve/shared';
import { getImageCache } from '../imageCache';
import type { ReplayTarget } from '../replayTypes';
import type { FillIR } from '../types';

export interface PatternPaintBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

type PatternAffine = readonly [number, number, number, number, number, number];

function multiplyPatternAffine(left: PatternAffine, right: PatternAffine): PatternAffine {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

const warnedPatternOverflows = new Set<string>();

/** Paint a pattern (tiled) fill over the primitive bounds. */
export function paintPatternFill(
  target: ReplayTarget,
  fill: Extract<FillIR, { type: 'pattern' }>,
  bounds: PatternPaintBounds,
  itemTransform: PatternAffine = [1, 0, 0, 1, 0, 0],
): void {
  if (fill.alignment !== 'document') {
    paintPatternField(target, fill, bounds, false);
    return;
  }

  const inverse = invertPatternAffine(itemTransform);
  const documentBounds = transformPatternBounds(bounds, itemTransform);
  if (!inverse || !documentBounds) {
    console.warn(
      '[Varve] Document-aligned pattern needs a finite, invertible object transform. The fill is marked with a warning hatch.',
    );
    paintPatternOverflowWarning(target, bounds.x, bounds.y, bounds.w || 1, bounds.h || 1);
    return;
  }

  // replayIr has already applied the item transform. Cancel it for this fill
  // so tile size, phase, and rotation use shared document coordinates while
  // the already-established shape clip remains unchanged.
  target.save();
  try {
    target.transform(...inverse);
    paintPatternField(target, fill, documentBounds, true);
  } finally {
    target.restore();
  }
}

function invertPatternAffine(matrix: PatternAffine): PatternAffine | null {
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || determinant === 0) return null;
  const inverse: PatternAffine = [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ];
  return inverse.every(Number.isFinite) ? inverse : null;
}

function transformPatternBounds(
  bounds: PatternPaintBounds,
  matrix: PatternAffine,
): PatternPaintBounds | null {
  const corners = [
    [bounds.x, bounds.y],
    [bounds.x + bounds.w, bounds.y],
    [bounds.x + bounds.w, bounds.y + bounds.h],
    [bounds.x, bounds.y + bounds.h],
  ].map(([x, y]) => [
    matrix[0] * (x ?? 0) + matrix[2] * (y ?? 0) + matrix[4],
    matrix[1] * (x ?? 0) + matrix[3] * (y ?? 0) + matrix[5],
  ]);
  if (corners.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return null;
  const xs = corners.map(([x]) => x as number);
  const ys = corners.map(([, y]) => y as number);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function paintPatternField(
  target: ReplayTarget,
  fill: Extract<FillIR, { type: 'pattern' }>,
  bounds: PatternPaintBounds,
  documentAligned: boolean,
): void {
  const bw = bounds.w || 1;
  const bh = bounds.h || 1;

  const cache = getImageCache();
  const tileEntry = cache.get(fill.tileSrc);
  if (fill.tileSrc && (!tileEntry || tileEntry.state === 'idle')) {
    cache.load(fill.tileSrc).catch(() => {
      /* errors recorded in cache entry */
    });
  }
  if (tileEntry?.state !== 'loaded' || !tileEntry.image) {
    paintPatternFallback(target, bounds.x, bounds.y, bw, bh);
    return;
  }

  const tileImage = tileEntry.image as HTMLImageElement;
  const tileBitmap = tileEntry.image as CanvasImageSource;
  const imageWidth = fill.imageWidth ?? tileImage.naturalWidth;
  const imageHeight = fill.imageHeight ?? tileImage.naturalHeight;

  // Resolve the repeat through the shared contract (`@varve/shared`
  // `patternRepeat`). Object alignment anchors the phase to object bounds;
  // document alignment is evaluated after rebasing into document coordinates.
  // Camera pan/zoom is never an input, so it can never change authored phase.
  const params: PatternRepeatParams = {
    tileWidth: imageWidth,
    tileHeight: imageHeight,
    gapX: fill.gapX !== undefined ? fill.gapX : fill.spacing,
    gapY: fill.gapY !== undefined ? fill.gapY : fill.spacing,
    arrangement: fill.arrangement,
    rowShift: fill.rowShift,
    columnShift: fill.columnShift,
    mirrorX: fill.mirrorX,
    mirrorY: fill.mirrorY,
    offsetX:
      (documentAligned ? 0 : bounds.x) +
      (Number.isFinite(fill.offsetX) ? (fill.offsetX as number) : 0),
    offsetY:
      (documentAligned ? 0 : bounds.y) +
      (Number.isFinite(fill.offsetY) ? (fill.offsetY as number) : 0),
  };
  const lattice = resolvePatternLattice(params);
  if (!lattice) {
    // Non-finite / non-positive tile size, or a non-positive repeat period.
    paintPatternFallback(target, bounds.x, bounds.y, bw, bh);
    return;
  }

  const radians = Number.isFinite(fill.rotation) ? (fill.rotation * Math.PI) / 180 : 0;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const centerX = documentAligned ? 0 : bounds.x + bw / 2;
  const centerY = documentAligned ? 0 : bounds.y + bh / 2;

  // Object-aligned rotation uses the object centre. A document-aligned
  // rotation turns the shared lattice around the document origin, so adjacent
  // fills with the same rotation retain the same phase.
  const rotationMatrix: PatternAffine = [
    cosine,
    sine,
    -sine,
    cosine,
    centerX - cosine * centerX + sine * centerY,
    centerY - sine * centerX - cosine * centerY,
  ];

  const mirrored = lattice.mirrorX || lattice.mirrorY;
  // A zero-gap lattice is a pure linear map of the tile rectangle, so
  // CanvasPattern reproduces it exactly with one fill — including a
  // half-drop/brick shear. Zero-gap includes both axes: a gap would scale the
  // tile instead of leaving empty space, which is not the authored intent.
  const pureLinear = !mirrored && lattice.ux === imageWidth && lattice.vy === imageHeight;

  if (pureLinear && target.createPattern) {
    const pattern = target.createPattern(tileBitmap, 'repeat');
    if (pattern && typeof pattern.setTransform === 'function') {
      // image coords -> pattern space (shear) -> canvas (rotate about centre).
      const shear: PatternAffine = [
        lattice.ux / imageWidth,
        lattice.uy / imageWidth,
        lattice.vx / imageHeight,
        lattice.vy / imageHeight,
        0,
        0,
      ];
      const phase: PatternAffine = [1, 0, 0, 1, lattice.phaseX, lattice.phaseY];
      const matrix = multiplyPatternAffine(multiplyPatternAffine(rotationMatrix, phase), shear);
      try {
        pattern.setTransform({
          a: matrix[0],
          b: matrix[1],
          c: matrix[2],
          d: matrix[3],
          e: matrix[4],
          f: matrix[5],
        });
        target.fillStyle = pattern as unknown as CanvasPattern;
        target.fillRect(bounds.x, bounds.y, bw, bh);
        return;
      } catch {
        // Older targets may expose createPattern without transform support.
        // The explicit draw loop below preserves the same visual semantics.
      }
    }
  }

  if (!target.drawImage) {
    paintPatternFallback(target, bounds.x, bounds.y, bw, bh);
    return;
  }

  // Destination rect in pattern space. For a rotated field the target is
  // already rotated, so the walk must cover the axis-aligned region that maps
  // back onto the object.
  let rect = { x: bounds.x, y: bounds.y, w: bw, h: bh };
  if (radians !== 0) {
    target.transform(
      rotationMatrix[0],
      rotationMatrix[1],
      rotationMatrix[2],
      rotationMatrix[3],
      rotationMatrix[4],
      rotationMatrix[5],
    );
    const inverseCorners = [
      [bounds.x, bounds.y],
      [bounds.x + bw, bounds.y],
      [bounds.x + bw, bounds.y + bh],
      [bounds.x, bounds.y + bh],
    ].map(([x, y]) => {
      const dx = (x ?? 0) - centerX;
      const dy = (y ?? 0) - centerY;
      return [centerX + cosine * dx + sine * dy, centerY - sine * dx + cosine * dy];
    });
    const minX = Math.min(...inverseCorners.map(([x]) => x ?? bounds.x));
    const minY = Math.min(...inverseCorners.map(([, y]) => y ?? bounds.y));
    const maxX = Math.max(...inverseCorners.map(([x]) => x ?? bounds.x + bw));
    const maxY = Math.max(...inverseCorners.map(([, y]) => y ?? bounds.y + bh));
    rect = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  const range = patternIndexRange(lattice, rect);
  const estimatedCount = range
    ? (range.iMax - range.iMin + 1) * (range.jMax - range.jMin + 1)
    : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(estimatedCount) || estimatedCount > PATTERN_MAX_INSTANCES) {
    const warningKey = [
      lattice.tileWidth,
      lattice.tileHeight,
      lattice.ux,
      lattice.uy,
      lattice.vx,
      lattice.vy,
      fill.mirrorX === true,
      fill.mirrorY === true,
    ].join('|');
    if (!warnedPatternOverflows.has(warningKey)) {
      warnedPatternOverflows.add(warningKey);
      if (warnedPatternOverflows.size > 128) {
        const oldest = warnedPatternOverflows.values().next().value;
        if (oldest) warnedPatternOverflows.delete(oldest);
      }
      console.warn(
        '[Varve] Pattern repeat exceeds the renderer instance limit. The fill is marked with a warning hatch; increase its tile size or reduce the painted area.',
      );
    }
    paintPatternOverflowWarning(target, bounds.x, bounds.y, bw, bh);
    return;
  }

  // Row-major (row index outer, ascending) so overlapping translucent tiles
  // composite in a stable, source-order-independent way.
  forEachPatternInstance(lattice, rect, (_i, _j, matrix) => {
    const tx = matrix[4];
    const ty = matrix[5];
    if (mirrored) {
      // A flipped copy needs its own transform; scope it so it cannot leak.
      target.save?.();
      try {
        target.transform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
        target.drawImage?.(tileBitmap, 0, 0, imageWidth, imageHeight);
      } finally {
        target.restore?.();
      }
    } else {
      target.drawImage?.(tileBitmap, tx, ty, imageWidth, imageHeight);
    }
  });
}

function paintPatternFallback(
  target: ReplayTarget,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  target.fillStyle = 'rgba(200,200,200,0.5)';
  target.fillRect(x, y, width, height);
}

/** Make a capped field visible as a rendering issue instead of partial output. */
function paintPatternOverflowWarning(
  target: ReplayTarget,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  target.save?.();
  try {
    target.fillStyle = 'rgba(190, 24, 93, 0.22)';
    target.fillRect(x, y, width, height);
    target.strokeStyle = 'rgba(190, 24, 93, 0.8)';
    target.lineWidth = Math.max(1, Math.min(3, Math.min(width, height) / 24));
    target.beginPath();
    const stride = Math.max(12, (width + height) / 80);
    for (let offset = -height; offset <= width; offset += stride) {
      target.moveTo(x + offset, y + height);
      target.lineTo(x + offset + height, y);
    }
    target.stroke();
  } finally {
    target.restore?.();
  }
}
