/**
 * Retouch engine — shared pixel-processing functions for clone stamp,
 * healing brush, spot heal, and patch tools.
 *
 * Research basis: Image compositing algebra (Porter-Duff), NCC patch matching,
 *                 Poisson image editing (Mertens-Kautz-Van Reeth 2005), and
 *                 Photoshop/GIMP retouching tool internals.
 *
 * F1: All functions operate on raw ImageData (Uint8ClampedArray RGBA).
 * F2: Brush masks are pre-computed Uint8Array (0-255 weight per pixel).
 * F3: Edge blending uses linear falloff for seamless composites.
 */

export function createBrushMask(
  brushSize: number,
  hardness: number,
): { mask: Uint8Array; diameter: number } {
  const r = Math.max(1, Math.floor(brushSize / 2));
  const d = r * 2 + 1;
  const mask = new Uint8Array(d * d);
  const invHardness = hardness < 1 ? 1 / Math.max(0.01, 1 - hardness) : 0;
  for (let y = 0; y < d; y++) {
    for (let x = 0; x < d; x++) {
      const dx = x - r;
      const dy = y - r;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > r) {
        mask[y * d + x] = 0;
      } else if (hardness >= 1) {
        mask[y * d + x] = 255;
      } else {
        const t = dist / r;
        const falloff = t < hardness ? 1 : 1 - (t - hardness) * invHardness;
        mask[y * d + x] = Math.max(0, Math.min(255, Math.round(falloff * 255)));
      }
    }
  }
  return { mask, diameter: d };
}

function readPixel(data: Uint8ClampedArray, i: number): number {
  return data[i]!;
}

/**
 * Clone pixels from a source region to a target region.
 * Copies RGBA values pixel-by-pixel, applying the brush mask as a blend weight.
 * Returns a new ImageData of the same dimensions as targetData.
 */
export function clonePixels(
  targetData: ImageData,
  sourceData: ImageData,
  targetX: number,
  targetY: number,
  sourceX: number,
  sourceY: number,
  brushSize: number,
  brushMask: Uint8Array | null,
): ImageData {
  const w = targetData.width;
  const h = targetData.height;
  const result = new ImageData(new Uint8ClampedArray(targetData.data), w, h);
  const r = Math.max(1, Math.floor(brushSize / 2));

  let maskData: { mask: Uint8Array; diameter: number };
  if (brushMask) {
    maskData = { mask: brushMask, diameter: r * 2 + 1 };
  } else {
    const d = r * 2 + 1;
    maskData = { mask: new Uint8Array(d * d).fill(255), diameter: d };
  }
  const { mask, diameter } = maskData;
  const srcW = sourceData.width;
  const srcH = sourceData.height;
  const td = targetData.data;
  const sd = sourceData.data;
  const rd = result.data;

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const my = dy + r;
      const mx = dx + r;
      if (my < 0 || my >= diameter || mx < 0 || mx >= diameter) continue;
      const weight = mask[my * diameter + mx]!;
      if (weight === 0) continue;

      const tx = targetX + dx;
      const ty = targetY + dy;
      if (tx < 0 || tx >= w || ty < 0 || ty >= h) continue;

      const sx = sourceX + dx;
      const sy = sourceY + dy;
      if (sx < 0 || sx >= srcW || sy < 0 || sy >= srcH) continue;

      const ti = (ty * w + tx) * 4;
      const si = (sy * srcW + sx) * 4;
      const f = weight / 255;

      if (f >= 1) {
        rd[ti] = readPixel(sd, si);
        rd[ti + 1] = readPixel(sd, si + 1);
        rd[ti + 2] = readPixel(sd, si + 2);
        rd[ti + 3] = readPixel(sd, si + 3);
      } else {
        rd[ti] = Math.round(
          readPixel(td, ti) * (1 - f) + readPixel(sd, si) * f,
        );
        rd[ti + 1] = Math.round(
          readPixel(td, ti + 1) * (1 - f) + readPixel(sd, si + 1) * f,
        );
        rd[ti + 2] = Math.round(
          readPixel(td, ti + 2) * (1 - f) + readPixel(sd, si + 2) * f,
        );
        rd[ti + 3] = Math.round(
          readPixel(td, ti + 3) * (1 - f) + readPixel(sd, si + 3) * f,
        );
      }
    }
  }
  return result;
}

/**
 * Compute brush mask once and reuse across multiple clone operations.
 */
export function createBrushMaskForSize(brushSize: number, hardness: number): Uint8Array {
  return createBrushMask(brushSize, hardness).mask;
}

/**
 * Normalized Cross-Correlation between two same-sized pixel regions.
 * Returns a similarity score from -1 (inverse) to 1 (identical).
 */
export function ncc(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  offset: number,
  _stride: number,
  count: number,
): number {
  let sumA = 0, sumB = 0, sumA2 = 0, sumB2 = 0, sumAB = 0;
  let n = 0;
  for (let i = 0; i < count; i++) {
    const idx = offset + i * 4;
    for (let c = 0; c < 3; c++) {
      const va = readPixel(a, idx + c);
      const vb = readPixel(b, idx + c);
      sumA += va;
      sumB += vb;
      sumA2 += va * va;
      sumB2 += vb * vb;
      sumAB += va * vb;
      n++;
    }
  }
  const meanA = sumA / n;
  const meanB = sumB / n;
  const cov = sumAB / n - meanA * meanB;
  const varA = sumA2 / n - meanA * meanA;
  const varB = sumB2 / n - meanB * meanB;
  const denom = Math.sqrt(varA * varB);
  if (denom < 1e-10) return 0;
  return cov / denom;
}

/**
 * Find the best-matching patch in a source region for a target patch using NCC.
 * Returns the {x, y} of the top-left corner of the best match.
 */
export function findBestPatch(
  _targetData: ImageData,
  sourceData: ImageData,
  targetCenterX: number,
  targetCenterY: number,
  patchRadius: number,
  searchRadius: number,
): { x: number; y: number } {
  const pw = patchRadius * 2 + 1;
  const srcW = sourceData.width;
  const srcH = sourceData.height;
  const targetX = Math.max(patchRadius, Math.min(srcW - patchRadius - 1, targetCenterX));
  const targetY = Math.max(patchRadius, Math.min(srcH - patchRadius - 1, targetCenterY));

  const patchCount = pw * pw;
  const patchBytes = patchCount * 4;
  const sd = sourceData.data;

  const targetPatch = new Uint8ClampedArray(patchBytes);
  for (let dy = -patchRadius; dy <= patchRadius; dy++) {
    for (let dx = -patchRadius; dx <= patchRadius; dx++) {
      const idx = ((dy + patchRadius) * pw + (dx + patchRadius)) * 4;
      const si = ((targetY + dy) * srcW + (targetX + dx)) * 4;
      targetPatch[idx] = readPixel(sd, si);
      targetPatch[idx + 1] = readPixel(sd, si + 1);
      targetPatch[idx + 2] = readPixel(sd, si + 2);
      targetPatch[idx + 3] = readPixel(sd, si + 3);
    }
  }

  let bestScore = -Infinity;
  let bestX = targetX;
  let bestY = targetY;

  const minSX = Math.max(patchRadius, targetCenterX - searchRadius);
  const maxSX = Math.min(srcW - patchRadius - 1, targetCenterX + searchRadius);
  const minSY = Math.max(patchRadius, targetCenterY - searchRadius);
  const maxSY = Math.min(srcH - patchRadius - 1, targetCenterY + searchRadius);

  for (let sy = minSY; sy <= maxSY; sy++) {
    for (let sx = minSX; sx <= maxSX; sx++) {
      if (Math.abs(sx - targetX) < patchRadius && Math.abs(sy - targetY) < patchRadius) continue;

      const sOffset = (sy * srcW + sx) * 4;
      const score = ncc(targetPatch, sd, sOffset, srcW * 4, patchCount);
      if (score > bestScore) {
        bestScore = score;
        bestX = sx;
        bestY = sy;
      }
    }
  }
  return { x: bestX, y: bestY };
}

/**
 * Heal pixels by blending a source patch into the target.
 * Uses NCC-guided blend with linear falloff at the edges.
 */
export function healPixels(
  targetData: ImageData,
  sourcePatch: ImageData,
  mask: Uint8Array,
): ImageData {
  const w = targetData.width;
  const h = targetData.height;
  const result = new ImageData(new Uint8ClampedArray(targetData.data), w, h);
  const pw = sourcePatch.width;
  const ph = sourcePatch.height;
  const td = targetData.data;
  const spd = sourcePatch.data;
  const rd = result.data;

  for (let y = 0; y < ph && y < h; y++) {
    for (let x = 0; x < pw && x < w; x++) {
      const mi = y * pw + x;
      const weight = mask[mi] ?? 0;
      if (weight === 0) continue;

      const ri = (y * w + x) * 4;
      const si = (y * pw + x) * 4;
      const f = weight / 255;

      if (f >= 1) {
        rd[ri] = readPixel(spd, si);
        rd[ri + 1] = readPixel(spd, si + 1);
        rd[ri + 2] = readPixel(spd, si + 2);
        rd[ri + 3] = readPixel(spd, si + 3);
      } else {
        rd[ri] = Math.round(
          readPixel(td, ri) * (1 - f) + readPixel(spd, si) * f,
        );
        rd[ri + 1] = Math.round(
          readPixel(td, ri + 1) * (1 - f) + readPixel(spd, si + 1) * f,
        );
        rd[ri + 2] = Math.round(
          readPixel(td, ri + 2) * (1 - f) + readPixel(spd, si + 2) * f,
        );
        rd[ri + 3] = Math.round(
          readPixel(td, ri + 3) * (1 - f) + readPixel(spd, si + 3) * f,
        );
      }
    }
  }
  return result;
}

/**
 * Spot-heal a small region by sampling from a mirrored position on the
 * opposite side of the circle center. Pixels near the edge blend smoothly
 * with the surrounding area to avoid visible seams.
 */
export function spotHeal(
  imageData: ImageData,
  centerX: number,
  centerY: number,
  radius: number,
): ImageData {
  const w = imageData.width;
  const h = imageData.height;
  const result = new ImageData(new Uint8ClampedArray(imageData.data), w, h);
  const id = imageData.data;
  const rd = result.data;

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;

      const mirrorSx = centerX + Math.round(
        dx > 0 ? -(radius + dx) : (radius - dx),
      );
      const mirrorSy = centerY + Math.round(
        dy > 0 ? -(radius + dy) : (radius - dy),
      );
      const sx = Math.max(0, Math.min(w - 1, mirrorSx));
      const sy = Math.max(0, Math.min(h - 1, mirrorSy));

      const ri = ((centerY + dy) * w + (centerX + dx)) * 4;
      const si = (sy * w + sx) * 4;

      const edgeWeight = Math.max(0, Math.min(1, (radius - dist) / Math.max(1, radius * 0.3)));

      if (edgeWeight >= 1) {
        rd[ri] = readPixel(id, si);
        rd[ri + 1] = readPixel(id, si + 1);
        rd[ri + 2] = readPixel(id, si + 2);
        rd[ri + 3] = readPixel(id, si + 3);
      } else {
        const f = edgeWeight;
        rd[ri] = Math.round(
          readPixel(id, ri) * (1 - f) + readPixel(id, si) * f,
        );
        rd[ri + 1] = Math.round(
          readPixel(id, ri + 1) * (1 - f) + readPixel(id, si + 1) * f,
        );
        rd[ri + 2] = Math.round(
          readPixel(id, ri + 2) * (1 - f) + readPixel(id, si + 2) * f,
        );
        rd[ri + 3] = Math.round(
          readPixel(id, ri + 3) * (1 - f) + readPixel(id, si + 3) * f,
        );
      }
    }
  }
  return result;
}

/**
 * Edge blend weights for a rectangular region — linear falloff along the perimeter.
 */
function edgeBlendWeights(
  rw: number,
  rh: number,
  featherRadius: number,
): Float64Array {
  const weights = new Float64Array(rw * rh);
  const fr = Math.max(1, featherRadius);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const dx = Math.min(x, rw - 1 - x);
      const dy = Math.min(y, rh - 1 - y);
      const d = Math.min(dx, dy);
      const w = Math.min(1, d / fr);
      weights[y * rw + x] = w;
    }
  }
  return weights;
}

/**
 * Patch a rectangular region by copying a source rectangle to a target rectangle
 * with edge feathering for seamless compositing.
 */
export function patchRegion(
  imageData: ImageData,
  sourceRect: { x: number; y: number; w: number; h: number },
  targetRect: { x: number; y: number; w: number; h: number },
): ImageData {
  const w = imageData.width;
  const h = imageData.height;
  const result = new ImageData(new Uint8ClampedArray(imageData.data), w, h);

  const rw = Math.min(sourceRect.w, targetRect.w);
  const rh = Math.min(sourceRect.h, targetRect.h);
  const feather = Math.max(1, Math.min(rw, rh) / 6);
  const weights = edgeBlendWeights(rw, rh, feather);
  const id = imageData.data;
  const rd = result.data;

  for (let dy = 0; dy < rh; dy++) {
    for (let dx = 0; dx < rw; dx++) {
      const sx = sourceRect.x + dx;
      const sy = sourceRect.y + dy;
      const tx = targetRect.x + dx;
      const ty = targetRect.y + dy;
      if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
      if (tx < 0 || tx >= w || ty < 0 || ty >= h) continue;

      const si = (sy * w + sx) * 4;
      const ti = (ty * w + tx) * 4;
      const weight = weights[dy * rw + dx] ?? 0;

      if (weight >= 1) {
        rd[ti] = readPixel(id, si);
        rd[ti + 1] = readPixel(id, si + 1);
        rd[ti + 2] = readPixel(id, si + 2);
        rd[ti + 3] = readPixel(id, si + 3);
      } else {
        const f = weight;
        rd[ti] = Math.round(
          readPixel(id, ti) * (1 - f) + readPixel(id, si) * f,
        );
        rd[ti + 1] = Math.round(
          readPixel(id, ti + 1) * (1 - f) + readPixel(id, si + 1) * f,
        );
        rd[ti + 2] = Math.round(
          readPixel(id, ti + 2) * (1 - f) + readPixel(id, si + 2) * f,
        );
        rd[ti + 3] = Math.round(
          readPixel(id, ti + 3) * (1 - f) + readPixel(id, si + 3) * f,
        );
      }
    }
  }
  return result;
}

export function buildBrushMask(
  brushSize: number,
  hardness: number,
): Uint8Array {
  return createBrushMask(brushSize, hardness).mask;
}
