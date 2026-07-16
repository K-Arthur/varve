export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ModelToSourceTransform {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  sourceWidth: number;
  sourceHeight: number;
  modelWidth: number;
  modelHeight: number;
}

export interface ReconstructionResult {
  alpha: Uint8Array;
  width: number;
  height: number;
  transform: ModelToSourceTransform;
}

export function computeLetterboxTransform(
  sourceW: number,
  sourceH: number,
  modelW: number,
  modelH: number,
): ModelToSourceTransform {
  if (sourceW <= 0 || sourceH <= 0 || modelW <= 0 || modelH <= 0) {
    throw new Error('All dimensions must be positive');
  }

  const contentScale = Math.min(modelW / sourceW, modelH / sourceH);
  const contentW = sourceW * contentScale;
  const contentH = sourceH * contentScale;

  return {
    offsetX: (modelW - contentW) / 2,
    offsetY: (modelH - contentH) / 2,
    scaleX: contentScale,
    scaleY: contentScale,
    sourceWidth: sourceW,
    sourceHeight: sourceH,
    modelWidth: modelW,
    modelHeight: modelH,
  };
}

export function reconstructModelMask(
  modelAlpha: Uint8Array,
  modelW: number,
  modelH: number,
  transform: ModelToSourceTransform,
): ReconstructionResult {
  const { sourceWidth, sourceHeight, offsetX, offsetY, scaleX, scaleY } = transform;

  if (modelAlpha.length !== modelW * modelH) {
    throw new Error('modelAlpha length does not match modelW * modelH');
  }
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return {
      alpha: new Uint8Array(0),
      width: 0,
      height: 0,
      transform,
    };
  }

  const result = new Uint8Array(sourceWidth * sourceHeight);
  const mw = modelW;
  const mh = modelH;

  for (let sy = 0; sy < sourceHeight; sy++) {
    for (let sx = 0; sx < sourceWidth; sx++) {
      const mx = offsetX + sx * scaleX;
      const my = offsetY + sy * scaleY;

      if (mx < 0 || mx >= mw || my < 0 || my >= mh) {
        continue;
      }

      const x0 = Math.floor(mx);
      const y0 = Math.floor(my);
      const x1 = Math.min(x0 + 1, mw - 1);
      const y1 = Math.min(y0 + 1, mh - 1);
      const fx = mx - x0;
      const fy = my - y0;

      const v00 = modelAlpha[y0 * mw + x0] ?? 0;
      const v10 = modelAlpha[y0 * mw + x1] ?? 0;
      const v01 = modelAlpha[y1 * mw + x0] ?? 0;
      const v11 = modelAlpha[y1 * mw + x1] ?? 0;

      const top = v00 * (1 - fx) + v10 * fx;
      const bottom = v01 * (1 - fx) + v11 * fx;
      const value = top * (1 - fy) + bottom * fy;

      result[sy * sourceWidth + sx] = Math.round(Math.min(255, Math.max(0, value)));
    }
  }

  return { alpha: result, width: sourceWidth, height: sourceHeight, transform };
}

export function composeSourceAndSubjectAlpha(
  sourceAlpha: Uint8Array,
  subjectAlpha: Uint8Array,
): Uint8Array {
  if (sourceAlpha.length !== subjectAlpha.length) {
    throw new Error('Alpha arrays must have the same length');
  }

  const result = new Uint8Array(sourceAlpha.length);
  for (let i = 0; i < sourceAlpha.length; i++) {
    result[i] = Math.round(((sourceAlpha[i] ?? 0) * (subjectAlpha[i] ?? 0)) / 255);
  }
  return result;
}

export function extractAlignedEdgeBand(
  alpha: Uint8Array,
  w: number,
  h: number,
  bandRadius: number,
): { bandAlpha: Uint8Array; bandBounds: Rect; sourceCrop: Rect } {
  if (w <= 0 || h <= 0 || alpha.length === 0) {
    return {
      bandAlpha: new Uint8Array(0),
      bandBounds: { x: 0, y: 0, w: 0, h: 0 },
      sourceCrop: { x: 0, y: 0, w: 0, h: 0 },
    };
  }

  const edgeMask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = alpha[y * w + x] ?? 0;
      if (v > 0 && v < 255) {
        edgeMask[y * w + x] = 1;
      }
    }
  }

  for (let r = 0; r < bandRadius; r++) {
    const prev = new Uint8Array(edgeMask);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (prev[y * w + x] === 1) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                edgeMask[ny * w + nx] = 1;
              }
            }
          }
        }
      }
    }
  }

  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let hasEdge = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (edgeMask[y * w + x] === 1) {
        hasEdge = true;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (!hasEdge) {
    return {
      bandAlpha: new Uint8Array(0),
      bandBounds: { x: 0, y: 0, w: 0, h: 0 },
      sourceCrop: { x: 0, y: 0, w: 0, h: 0 },
    };
  }

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const bandBounds: Rect = { x: minX, y: minY, w: bw, h: bh };
  const sourceCrop: Rect = { x: minX, y: minY, w: bw, h: bh };

  const bandAlpha = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      bandAlpha[y * bw + x] = alpha[(minY + y) * w + (minX + x)] ?? 0;
    }
  }

  return { bandAlpha, bandBounds, sourceCrop };
}

export function refineEdgeBand(
  bandAlpha: Uint8Array,
  _sourceCrop: Rect,
  _sourceRgba: Uint8Array,
  _sourceW: number,
): Uint8Array {
  // Placeholder: returns the edge band unchanged.
  // TODO: implement guided filter or closed-form matting using source RGB data.
  return new Uint8Array(bandAlpha);
}
