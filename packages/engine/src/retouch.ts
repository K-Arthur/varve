/**
 * Retouch engine — shared pixel-processing functions for clone stamp,
 * healing brush, spot heal, and patch tools.
 *
 * Research basis: Porter-Duff source-over compositing, normalized
 * cross-correlation patch matching, and the documented clone/heal/patch
 * workflows in established raster editors. The byte-oriented APIs in this
 * module are legacy compatibility helpers; range-bearing work uses the
 * separate float surface contract.
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
 * Composite one straight-alpha byte pixel with source-over semantics.
 * RGB is combined in premultiplied form, then unpremultiplied once. This is
 * important at transparent edges: independently lerping straight RGB and
 * alpha creates dark fringes and can erase the destination with an empty
 * source sample.
 */
function blendBytePixel(
  destination: Uint8ClampedArray,
  destinationIndex: number,
  source: Uint8ClampedArray,
  sourceIndex: number,
  coverage: number,
  output: Uint8ClampedArray,
): void {
  const amount = Math.max(0, Math.min(1, coverage));
  if (amount <= 0) return;
  const sourceAlpha = (readPixel(source, sourceIndex + 3) / 255) * amount;
  const destinationAlpha = readPixel(destination, destinationIndex + 3) / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outputAlpha <= 1e-8) {
    output[destinationIndex] = 0;
    output[destinationIndex + 1] = 0;
    output[destinationIndex + 2] = 0;
    output[destinationIndex + 3] = 0;
    return;
  }
  for (let channel = 0; channel < 3; channel++) {
    const sourcePremultiplied = (readPixel(source, sourceIndex + channel) / 255) * sourceAlpha;
    const destinationPremultiplied =
      (readPixel(destination, destinationIndex + channel) / 255) *
      destinationAlpha *
      (1 - sourceAlpha);
    output[destinationIndex + channel] = Math.round(
      ((sourcePremultiplied + destinationPremultiplied) / outputAlpha) * 255,
    );
  }
  output[destinationIndex + 3] = Math.round(outputAlpha * 255);
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

      blendBytePixel(td, ti, sd, si, f, rd);
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
 * Shared correlation core. Both regions are read row-by-row when their count
 * is a perfect square (each with its own row stride), otherwise linearly.
 */
function nccCore(
  a: Uint8ClampedArray,
  aOffset: number,
  aStride: number,
  b: Uint8ClampedArray,
  bOffset: number,
  bStride: number,
  count: number,
): number {
  let sumA = 0,
    sumB = 0,
    sumA2 = 0,
    sumB2 = 0,
    sumAB = 0;
  let n = 0;
  const side = Math.floor(Math.sqrt(count));
  const isSquare = side > 0 && side * side === count;
  for (let i = 0; i < count; i++) {
    const row = isSquare ? Math.floor(i / side) : 0;
    const column = isSquare ? i % side : i;
    const aIndex = aOffset + (isSquare ? row * aStride + column * 4 : i * 4);
    const bIndex = bOffset + (isSquare ? row * bStride + column * 4 : i * 4);
    for (let c = 0; c < 3; c++) {
      const va = readPixel(a, aIndex + c);
      const vb = readPixel(b, bIndex + c);
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
  if (denom < 1e-10) {
    // NCC is undefined for a flat patch, but exact flat matches are still
    // useful for blemish removal and should beat the first search candidate.
    return Math.abs(meanA - meanB) < 1e-6 ? 1 : 0;
  }
  return cov / denom;
}

/**
 * Normalized Cross-Correlation between two same-sized pixel regions.
 * Returns a similarity score from -1 (inverse) to 1 (identical).
 */
export function ncc(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  offset: number,
  stride: number,
  count: number,
): number {
  return nccCore(a, offset, stride, b, offset, stride, count);
}

/**
 * Correlation between a densely packed square patch and a strided image
 * region. Used by patch search, where the target patch has no row padding.
 */
export function nccPackedPatch(
  packed: Uint8ClampedArray,
  image: Uint8ClampedArray,
  imageOffset: number,
  imageStride: number,
  side: number,
): number {
  return nccCore(packed, 0, side * 4, image, imageOffset, imageStride, side * side);
}

/**
 * Find the best-matching patch in a source region for a target patch using NCC.
 * Returns the {x, y} of the top-left corner of the best match.
 */
export function findBestPatch(
  targetData: ImageData,
  sourceData: ImageData,
  targetCenterX: number,
  targetCenterY: number,
  patchRadius: number,
  searchRadius: number,
): { x: number; y: number } {
  const pw = patchRadius * 2 + 1;
  if (
    patchRadius < 0 ||
    targetData.width < pw ||
    targetData.height < pw ||
    sourceData.width < pw ||
    sourceData.height < pw
  ) {
    return { x: Math.max(0, Math.floor(targetCenterX)), y: Math.max(0, Math.floor(targetCenterY)) };
  }
  const targetW = targetData.width;
  const targetH = targetData.height;
  const srcW = sourceData.width;
  const srcH = sourceData.height;
  const targetX = Math.max(patchRadius, Math.min(targetW - patchRadius - 1, targetCenterX));
  const targetY = Math.max(patchRadius, Math.min(targetH - patchRadius - 1, targetCenterY));

  const patchCount = pw * pw;
  const patchBytes = patchCount * 4;
  const td = targetData.data;
  const sd = sourceData.data;

  const targetPatch = new Uint8ClampedArray(patchBytes);
  for (let dy = -patchRadius; dy <= patchRadius; dy++) {
    for (let dx = -patchRadius; dx <= patchRadius; dx++) {
      const idx = ((dy + patchRadius) * pw + (dx + patchRadius)) * 4;
      const ti = ((targetY + dy) * targetW + (targetX + dx)) * 4;
      targetPatch[idx] = readPixel(td, ti);
      targetPatch[idx + 1] = readPixel(td, ti + 1);
      targetPatch[idx + 2] = readPixel(td, ti + 2);
      targetPatch[idx + 3] = readPixel(td, ti + 3);
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
      const score = nccPackedPatch(targetPatch, sd, sOffset, srcW * 4, pw);
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

      blendBytePixel(td, ri, spd, si, f, rd);
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

      const mirrorSx = centerX + Math.round(dx > 0 ? -(radius + dx) : radius - dx);
      const mirrorSy = centerY + Math.round(dy > 0 ? -(radius + dy) : radius - dy);
      const sx = Math.max(0, Math.min(w - 1, mirrorSx));
      const sy = Math.max(0, Math.min(h - 1, mirrorSy));

      const tx = centerX + dx;
      const ty = centerY + dy;
      if (tx < 0 || tx >= w || ty < 0 || ty >= h) continue;
      const ri = (ty * w + tx) * 4;
      const si = (sy * w + sx) * 4;

      const edgeWeight = Math.max(0, Math.min(1, (radius - dist) / Math.max(1, radius * 0.3)));

      blendBytePixel(id, ri, id, si, edgeWeight, rd);
    }
  }
  return result;
}

/**
 * Edge blend weights for a rectangular region — linear falloff along the perimeter.
 */
function edgeBlendWeights(rw: number, rh: number, featherRadius: number): Float64Array {
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

      blendBytePixel(id, ti, id, si, weight, rd);
    }
  }
  return result;
}

export function buildBrushMask(brushSize: number, hardness: number): Uint8Array {
  return createBrushMask(brushSize, hardness).mask;
}
