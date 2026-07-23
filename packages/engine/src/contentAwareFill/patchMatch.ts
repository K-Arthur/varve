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

export function patchMatchFill(
  imageData: ImageData,
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  maskOffsetX: number,
  maskOffsetY: number,
  signal?: AbortSignal,
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

  const filledBounds = {
    x: Math.min(...fillPixels.map((p) => p.x)),
    y: Math.min(...fillPixels.map((p) => p.y)),
    w: Math.max(...fillPixels.map((p) => p.x)) - Math.min(...fillPixels.map((p) => p.x)) + 1,
    h: Math.max(...fillPixels.map((p) => p.y)) - Math.min(...fillPixels.map((p) => p.y)) + 1,
  };

  const INVALID = new Float64Array(fillPixels.length).fill(Infinity);

  const iterations = Math.max(1, Math.min(5, Math.round(searchRadius / 100)));

  const checkAborted = () => signal?.aborted;

  for (let iter = 0; iter < iterations; iter++) {
    if (checkAborted()) return { imageData: result, filledBounds };

    const order = iter % 2 === 0 ? fillPixels : [...fillPixels].reverse();

    for (let i = 0; i < order.length; i++) {
      if (i % 100 === 0 && checkAborted()) return { imageData: result, filledBounds };

      const { x, y } = order[i]!;
      let bestScore = INVALID[i]!;
      let bestSx = x;
      let bestSy = y;

      if (iter > 0) {
        const prevDist = 1;
        const px = x + prevDist;
        const py = y + prevDist;
        if (px >= PAD && px < w - PAD && py >= PAD && py < h - PAD) {
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
        const rx = x + Math.round((Math.random() * 2 - 1) * r);
        const ry = y + Math.round((Math.random() * 2 - 1) * r);
        if (rx < PAD || rx >= w - PAD || ry < PAD || ry >= h - PAD) continue;
        const ps = ssd(src, rd, rx, ry, x, y, PATCH_SIZE, PATCH_SIZE, w, PAD);
        if (ps < bestScore) {
          bestScore = ps;
          bestSx = rx;
          bestSy = ry;
        }
      }

      INVALID[i] = bestScore;

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
