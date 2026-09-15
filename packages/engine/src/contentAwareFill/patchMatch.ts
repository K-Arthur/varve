function ssd(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  _pw: number,
  _ph: number,
  stride: number,
  padSize: number,
): number {
  let sum = 0;
  for (let dy = -padSize; dy <= padSize; dy++) {
    for (let dx = -padSize; dx <= padSize; dx++) {
      const ai = ((ay + dy) * stride + (ax + dx)) * 4;
      const bi = ((by + dy) * stride + (bx + dx)) * 4;
      const dr = (a[ai] ?? 0) - (b[bi] ?? 0);
      const dg = (a[ai + 1] ?? 0) - (b[bi + 1] ?? 0);
      const db = (a[ai + 2] ?? 0) - (b[bi + 2] ?? 0);
      sum += dr * dr + dg * dg + db * db;
    }
  }
  return sum;
}

export interface PatchMatchResult {
  imageData: ImageData;
  filledBounds: { x: number; y: number; w: number; h: number };
}

/**
 * Return whether the source patch centred at `(x, y)` is safe to sample.
 *
 * PatchMatch must never use pixels from the region the user asked it to
 * reconstruct. A masked source patch can look like a very good match while
 * the source pixels are still the object being removed, which causes the
 * object to be copied back into another part of the hole. Keep this check in
 * source-image coordinates so bounded contexts and offset masks share the
 * same rule.
 */
export function isPatchSourceUsable(
  x: number,
  y: number,
  imageWidth: number,
  imageHeight: number,
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  maskOffsetX: number,
  maskOffsetY: number,
  patchRadius = 3,
): boolean {
  const radius = Math.max(0, Math.floor(patchRadius));
  if (x - radius < 0 || y - radius < 0 || x + radius >= imageWidth || y + radius >= imageHeight) {
    return false;
  }

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const maskX = x + dx - maskOffsetX;
      const maskY = y + dy - maskOffsetY;
      if (
        maskX >= 0 &&
        maskX < maskWidth &&
        maskY >= 0 &&
        maskY < maskHeight &&
        (mask[maskY * maskWidth + maskX] ?? 0) > 0
      ) {
        return false;
      }
    }
  }
  return true;
}

export function patchMatchFill(
  imageData: ImageData,
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  maskOffsetX: number,
  maskOffsetY: number,
  signal?: AbortSignal,
  seed?: number,
): PatchMatchResult {
  const w = imageData.width;
  const h = imageData.height;
  const result = new ImageData(new Uint8ClampedArray(imageData.data), w, h);
  const rd = result.data;
  const src = imageData.data;

  const PATCH_RADIUS = 3;
  const PATCH_SIZE = PATCH_RADIUS * 2 + 1;
  const PAD = PATCH_RADIUS;

  const searchRadius = Math.max(w, h);
  let randomState = (seed ?? 0x9e3779b9) >>> 0;
  const random = () => {
    randomState = Math.imul(randomState ^ (randomState >>> 15), 1 | randomState);
    randomState ^= randomState + Math.imul(randomState ^ (randomState >>> 7), 61 | randomState);
    return ((randomState ^ (randomState >>> 14)) >>> 0) / 4294967296;
  };

  const fillPixels: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const my = y - maskOffsetY;
      const mx = x - maskOffsetX;
      if (
        mx >= 0 &&
        mx < maskWidth &&
        my >= 0 &&
        my < maskHeight &&
        (mask[my * maskWidth + mx] ?? 0) > 128
      ) {
        fillPixels.push({ x, y });
      }
    }
  }

  if (fillPixels.length === 0) {
    return { imageData: result, filledBounds: { x: 0, y: 0, w: 0, h: 0 } };
  }

  // Do not spread a real photographic mask into Math.min/Math.max. A user
  // can select tens of thousands of pixels, which exceeds the JavaScript
  // argument stack and turns an otherwise valid Remove into a call-stack
  // error. The linear scan is allocation-free and has the same result.
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (const pixel of fillPixels) {
    minX = Math.min(minX, pixel.x);
    minY = Math.min(minY, pixel.y);
    maxX = Math.max(maxX, pixel.x);
    maxY = Math.max(maxY, pixel.y);
  }
  const filledBounds = {
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };

  // Scores are keyed by the target's image index. The previous
  // fill-pixel-index array reused a score for a different target whenever an
  // iteration traversed the pixels in reverse order, making the result
  // depend on traversal direction.
  const bestScores = new Float64Array(w * h).fill(Infinity);
  const fallbackCenters = [
    [PAD, PAD],
    [w - PAD - 1, PAD],
    [PAD, h - PAD - 1],
    [w - PAD - 1, h - PAD - 1],
    [Math.floor(w / 2), Math.floor(h / 2)],
  ] as const;

  const iterations = Math.max(1, Math.min(5, Math.round(searchRadius / 100)));

  const checkAborted = () => signal?.aborted;

  for (let iter = 0; iter < iterations; iter++) {
    if (checkAborted()) return { imageData: result, filledBounds };

    const order = iter % 2 === 0 ? fillPixels : [...fillPixels].reverse();

    for (let i = 0; i < order.length; i++) {
      if (i % 100 === 0 && checkAborted()) return { imageData: result, filledBounds };

      const { x, y } = order[i]!;
      const targetIndex = y * w + x;
      let bestScore = bestScores[targetIndex]!;
      let bestSx = x;
      let bestSy = y;

      if (iter > 0) {
        const prevDist = 1;
        const px = x + prevDist;
        const py = y + prevDist;
        if (
          isPatchSourceUsable(
            px,
            py,
            w,
            h,
            mask,
            maskWidth,
            maskHeight,
            maskOffsetX,
            maskOffsetY,
            PAD,
          )
        ) {
          const ps = ssd(src, rd, px, py, x, y, PATCH_SIZE, PATCH_SIZE, w, PAD);
          if (ps < bestScore) {
            bestScore = ps;
            bestSx = px;
            bestSy = py;
          }
        }
      }

      const r = searchRadius >> iter;
      for (let attempt = 0; attempt < 8; attempt++) {
        const rx = x + Math.round((random() * 2 - 1) * r);
        const ry = y + Math.round((random() * 2 - 1) * r);
        if (
          !isPatchSourceUsable(
            rx,
            ry,
            w,
            h,
            mask,
            maskWidth,
            maskHeight,
            maskOffsetX,
            maskOffsetY,
            PAD,
          )
        ) {
          continue;
        }
        const ps = ssd(src, rd, rx, ry, x, y, PATCH_SIZE, PATCH_SIZE, w, PAD);
        if (ps < bestScore) {
          bestScore = ps;
          bestSx = rx;
          bestSy = ry;
        }
      }

      // Random search is useful for larger images, but it is not a
      // completeness guarantee: a small bounded context can legitimately
      // reject all eight samples. Probe deterministic anchors before giving
      // up so a valid small cleanup never intermittently becomes a no-op.
      if (!Number.isFinite(bestScore)) {
        for (const [candidateX, candidateY] of fallbackCenters) {
          if (
            !isPatchSourceUsable(
              candidateX,
              candidateY,
              w,
              h,
              mask,
              maskWidth,
              maskHeight,
              maskOffsetX,
              maskOffsetY,
              PAD,
            )
          ) {
            continue;
          }
          const ps = ssd(src, rd, candidateX, candidateY, x, y, PATCH_SIZE, PATCH_SIZE, w, PAD);
          if (ps < bestScore) {
            bestScore = ps;
            bestSx = candidateX;
            bestSy = candidateY;
          }
        }
      }

      bestScores[targetIndex] = bestScore;

      // A fully masked or too-small context has no valid source patch. Keep
      // the source clone intact and let the caller report the unchanged
      // result rather than copying the masked object or reading out of
      // bounds.
      if (!Number.isFinite(bestScore)) continue;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tx = bestSx + dx;
          const ty = bestSy + dy;
          if (tx < PAD || tx >= w - PAD || ty < PAD || ty >= h - PAD) continue;
          const ti = y + dy;
          const tj = x + dx;
          if (ti < 0 || ti >= h || tj < 0 || tj >= w) continue;
          const mi = (ti - maskOffsetY) * maskWidth + (tj - maskOffsetX);
          if (mi < 0 || mi >= mask.length) continue;
          if ((mask[mi] ?? 0) <= 128) continue;

          const si = (ty * w + tx) * 4;
          const di = (ti * w + tj) * 4;
          rd[di] = src[si]!;
          rd[di + 1] = src[si + 1]!;
          rd[di + 2] = src[si + 2]!;
          rd[di + 3] = 255;
        }
      }
    }
  }

  return { imageData: result, filledBounds };
}
