function ssd(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  stride: number,
  padSize: number,
  knownTarget: Uint8Array,
): number {
  let sum = 0;
  let compared = 0;
  for (let dy = -padSize; dy <= padSize; dy++) {
    for (let dx = -padSize; dx <= padSize; dx++) {
      const targetX = bx + dx;
      const targetY = by + dy;
      if (
        targetX < 0 ||
        targetX >= stride ||
        targetY < 0 ||
        targetY * stride + targetX >= knownTarget.length ||
        knownTarget[targetY * stride + targetX] === 0
      ) {
        continue;
      }
      const ai = ((ay + dy) * stride + (ax + dx)) * 4;
      const bi = (targetY * stride + targetX) * 4;
      const dr = (a[ai] ?? 0) - (b[bi] ?? 0);
      const dg = (a[ai + 1] ?? 0) - (b[bi + 1] ?? 0);
      const db = (a[ai + 2] ?? 0) - (b[bi + 2] ?? 0);
      sum += dr * dr + dg * dg + db * db;
      compared += 1;
    }
  }
  return compared > 0 ? sum / compared : Number.POSITIVE_INFINITY;
}

export interface PatchMatchResult {
  imageData: ImageData;
  filledBounds: { x: number; y: number; w: number; h: number };
}

/** Any non-zero coverage is editable; the compositor applies its strength. */
function hasEditableCoverage(value: number): boolean {
  return value > 0;
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
        hasEditableCoverage(mask[my * maskWidth + mx] ?? 0)
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

  // A pixel inside the edit mask still contains the source object in `rd`
  // until PatchMatch replaces it. Treating that pixel as known makes the
  // object itself part of the nearest-neighbour query and can reproduce it
  // in another part of the hole. The known map grows as masked pixels are
  // filled, which lets large holes propagate from their real boundary.
  const knownTarget = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const mx = x - maskOffsetX;
      const my = y - maskOffsetY;
      const masked =
        mx >= 0 &&
        mx < maskWidth &&
        my >= 0 &&
        my < maskHeight &&
        hasEditableCoverage(mask[my * maskWidth + mx] ?? 0);
      knownTarget[y * w + x] = masked ? 0 : 1;
    }
  }

  // Keep the best source centre for each target pixel so propagation can
  // move a coherent patch across the hole instead of using one arbitrary
  // diagonal candidate for every target.
  const bestSourceX = new Int32Array(w * h).fill(-1);
  const bestSourceY = new Int32Array(w * h).fill(-1);
  const fallbackCenters = [
    [PAD, PAD],
    [w - PAD - 1, PAD],
    [PAD, h - PAD - 1],
    [w - PAD - 1, h - PAD - 1],
    [Math.floor(w / 2), Math.floor(h / 2)],
  ] as const;

  // One pass is not enough to grow known pixels through a bounded context.
  // Keep the cap deliberately small because this function also has a direct
  // main-thread fallback when a worker is unavailable.
  const iterations = Math.max(2, Math.min(5, Math.ceil(searchRadius / 100)));

  const checkAborted = () => signal?.aborted;

  for (let iter = 0; iter < iterations; iter++) {
    if (checkAborted()) return { imageData: result, filledBounds };

    const order = iter % 2 === 0 ? fillPixels : [...fillPixels].reverse();

    for (let i = 0; i < order.length; i++) {
      if (i % 100 === 0 && checkAborted()) return { imageData: result, filledBounds };

      const { x, y } = order[i]!;
      const targetIndex = y * w + x;
      let bestScore = Number.POSITIVE_INFINITY;
      let bestSx = bestSourceX[targetIndex]!;
      let bestSy = bestSourceY[targetIndex]!;

      const consider = (candidateX: number, candidateY: number) => {
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
          return;
        }
        const score = ssd(src, rd, candidateX, candidateY, x, y, w, PAD, knownTarget);
        if (score < bestScore) {
          bestScore = score;
          bestSx = candidateX;
          bestSy = candidateY;
        }
      };

      if (bestSx >= 0 && bestSy >= 0) consider(bestSx, bestSy);

      // Propagate a neighbouring nearest-neighbour field. Forward scans use
      // left/up; reverse scans use right/down. The source centre shifts with
      // the target so texture direction is preserved across the hole.
      const neighbours: ReadonlyArray<readonly [number, number, number, number]> =
        iter % 2 === 0
          ? [
              [x - 1, y, 1, 0],
              [x, y - 1, 0, 1],
            ]
          : [
              [x + 1, y, -1, 0],
              [x, y + 1, 0, -1],
            ];
      for (const [nx, ny, shiftX, shiftY] of neighbours) {
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const neighbourIndex = ny * w + nx;
        const neighbourSx = bestSourceX[neighbourIndex]!;
        const neighbourSy = bestSourceY[neighbourIndex]!;
        if (neighbourSx < 0 || neighbourSy < 0) continue;
        consider(neighbourSx + shiftX, neighbourSy + shiftY);
      }

      const r = Math.max(1, Math.floor(searchRadius / 2 ** iter));
      for (let attempt = 0; attempt < 16; attempt++) {
        const rx = x + Math.round((random() * 2 - 1) * r);
        const ry = y + Math.round((random() * 2 - 1) * r);
        consider(rx, ry);
      }

      // Random search is useful for larger images, but it is not a
      // completeness guarantee: a small bounded context can legitimately
      // reject all eight samples. Probe deterministic anchors before giving
      // up so a valid small cleanup never intermittently becomes a no-op.
      if (!Number.isFinite(bestScore)) {
        for (const [candidateX, candidateY] of fallbackCenters) {
          consider(candidateX, candidateY);
        }
      }

      bestSourceX[targetIndex] = bestSx;
      bestSourceY[targetIndex] = bestSy;

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
          const maskX = tj - maskOffsetX;
          const maskY = ti - maskOffsetY;
          if (maskX < 0 || maskX >= maskWidth || maskY < 0 || maskY >= maskHeight) continue;
          const mi = maskY * maskWidth + maskX;
          if (!hasEditableCoverage(mask[mi] ?? 0)) continue;

          const si = (ty * w + tx) * 4;
          const di = (ti * w + tj) * 4;
          rd[di] = src[si]!;
          rd[di + 1] = src[si + 1]!;
          rd[di + 2] = src[si + 2]!;
          rd[di + 3] = 255;
          knownTarget[ti * w + tj] = 1;
        }
      }
    }
  }

  return { imageData: result, filledBounds };
}
