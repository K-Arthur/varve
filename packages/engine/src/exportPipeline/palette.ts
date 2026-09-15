/**
 * Palette quantization (median cut) for canonical export (Strata export
 * pipeline, Phase 4). Produces an ordered, deterministic palette and maps
 * every pixel to its nearest box.
 *
 * Determinism:
 *  - Histogram buckets are 5-bit RGB (32³) — a fixed, platform-independent
 *    quantization.
 *  - Boxes split on the channel with the widest range, at the count-weighted
 *    median; ties break on (channel, then bucket order), so the tree shape is
 *    a pure function of the pixel population.
 *  - The final palette is sorted by luminance then RGB so identical inputs
 *    always yield the same index layout (stable hashes, stable regression).
 *
 * Transparency: when any pixel falls below `alphaThreshold`, index 0 is
 * reserved as fully transparent and the output carries straight alpha.
 */

export interface PaletteQuantizeOptions {
  /** Maximum palette size (2..256). */
  paletteSize?: number;
  /** 0..1 alpha below which pixels map to the transparent index. */
  alphaThreshold?: number;
}

export interface PaletteQuantizeResult {
  imageData: ImageData;
  /** Ordered palette, [r,g,b,a] per entry. */
  palette: Uint8ClampedArray;
  /** Whether index 0 is the reserved transparent entry. */
  transparentIndex: boolean;
}

interface Bucket {
  r: number;
  g: number;
  b: number;
  count: number;
  minR: number;
  maxR: number;
  minG: number;
  maxG: number;
  minB: number;
  maxB: number;
}

/** Flatten a 15-bit bucket key to (r, g, b) bucket indices. */
function bucketToRgb(key: number): [number, number, number] {
  return [(key >> 10) & 31, (key >> 5) & 31, key & 31];
}

function bucketIndex(r: number, g: number, b: number): number {
  return (r << 10) | (g << 5) | b;
}

/**
 * Build a median-cut palette and remap the image. Returns the input unchanged
 * when `paletteSize` is absent (no quantization requested).
 */
export function quantizeToPalette(
  source: ImageData,
  options: PaletteQuantizeOptions = {},
): PaletteQuantizeResult {
  const w = source.width;
  const h = source.height;
  const paletteSize = options.paletteSize ?? 0;
  const alphaThreshold = options.alphaThreshold ?? 0;
  const maxPalette = Math.max(1, Math.min(256, paletteSize));

  const data = source.data;
  const counts = new Map<number, number>();
  const sums = new Map<number, [number, number, number]>();
  const transparentPixels = new Uint8Array(w * h);
  let hasTransparency = false;

  for (let i = 0; i < w * h; i += 1) {
    const o = i * 4;
    const a = data[o + 3] as number;
    if (a / 255 < alphaThreshold) {
      transparentPixels[i] = 1;
      hasTransparency = true;
      continue;
    }
    const key = bucketIndex(
      (data[o] as number) >> 3,
      (data[o + 1] as number) >> 3,
      (data[o + 2] as number) >> 3,
    );
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const s = sums.get(key) ?? [0, 0, 0];
    s[0] += data[o] as number;
    s[1] += data[o + 1] as number;
    s[2] += data[o + 2] as number;
    sums.set(key, s);
  }

  const bucketCount = counts.size;
  if (bucketCount === 0) {
    return {
      imageData: new ImageData(new Uint8ClampedArray(data), w, h),
      palette: new Uint8ClampedArray([0, 0, 0, 0]),
      transparentIndex: true,
    };
  }

  // Median-cut over bucket entries (weighted by count).
  const entries = [...counts.entries()].map(([key, count]): Bucket => {
    const [r, g, b] = bucketToRgb(key);
    return {
      r,
      g,
      b,
      count,
      minR: r,
      maxR: r,
      minG: g,
      maxG: g,
      minB: b,
      maxB: b,
    };
  });

  const target = hasTransparency ? maxPalette - 1 : maxPalette;
  let boxes: Bucket[][] = [entries];
  while (boxes.length < target) {
    let bestBoxIndex = -1;
    let bestRange = -1;
    let bestChannel = 0;
    for (let bi = 0; bi < boxes.length; bi += 1) {
      const box = boxes[bi]!;
      if (box.length < 2) continue;
      let minR = 31;
      let maxR = 0;
      let minG = 31;
      let maxG = 0;
      let minB = 31;
      let maxB = 0;
      for (const b of box) {
        minR = Math.min(minR, b.minR);
        maxR = Math.max(maxR, b.maxR);
        minG = Math.min(minG, b.minG);
        maxG = Math.max(maxG, b.maxG);
        minB = Math.min(minB, b.minB);
        maxB = Math.max(maxB, b.maxB);
      }
      const ranges: Array<[number, number]> = [
        [maxR - minR, 0],
        [maxG - minG, 1],
        [maxB - minB, 2],
      ];
      ranges.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      const [range, channel] = ranges[0]!;
      if (range > bestRange) {
        bestRange = range;
        bestBoxIndex = bi;
        bestChannel = channel;
      }
    }
    if (bestBoxIndex < 0) break;
    const box = boxes[bestBoxIndex]!;
    const channelOf = (b: Bucket): number =>
      bestChannel === 0 ? b.r : bestChannel === 1 ? b.g : b.b;
    box.sort((a, b) => channelOf(a) - channelOf(b));
    let total = 0;
    for (const b of box) total += b.count;
    let acc = 0;
    let splitAt = 1;
    for (let i = 0; i < box.length; i += 1) {
      acc += box[i]!.count;
      if (acc * 2 >= total) {
        splitAt = i + 1;
        break;
      }
    }
    if (splitAt >= box.length) splitAt = box.length - 1;
    const left = box.slice(0, splitAt);
    const right = box.slice(splitAt);
    const next = boxes.slice();
    next[bestBoxIndex] = left;
    next.push(right);
    boxes = next;
  }

  // Final palette: representative colour per box (count-weighted average),
  // sorted deterministically by luminance then RGB.
  const paletteEntries: Array<[number, number, number]> = boxes.map((box) => {
    let tr = 0;
    let tg = 0;
    let tb = 0;
    let tc = 0;
    for (const b of box) {
      const s = sums.get(bucketIndex(b.r, b.g, b.b))!;
      tr += s[0];
      tg += s[1];
      tb += s[2];
      tc += b.count;
    }
    const scale = 1 / Math.max(1, tc);
    // Bucket centres (5-bit) → byte range. (No /255→*255 dead round trip:
    // the bucket sums are already byte-scale.)
    const r = Math.round(tr * scale);
    const g = Math.round(tg * scale);
    const b = Math.round(tb * scale);
    return [r, g, b];
  });

  paletteEntries.sort((a, b) => {
    const la = 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    const lb = 0.2126 * b[0] + 0.7152 * b[1] + 0.0722 * b[2];
    if (la !== lb) return la - lb;
    for (let c = 0; c < 3; c += 1) if (a[c] !== b[c]) return a[c]! - b[c]!;
    return 0;
  });

  const palette = new Uint8ClampedArray(
    (hasTransparency ? paletteEntries.length + 1 : paletteEntries.length) * 4,
  );
  let offset = 0;
  if (hasTransparency) {
    palette[0] = 0;
    palette[1] = 0;
    palette[2] = 0;
    palette[3] = 0;
    offset = 4;
  }
  for (const [r, g, b] of paletteEntries) {
    palette[offset] = r;
    palette[offset + 1] = g;
    palette[offset + 2] = b;
    palette[offset + 3] = 255;
    offset += 4;
  }

  // Remap pixels to their box's palette index via bucket membership.
  const bucketToIndex = new Map<number, number>();
  for (let bi = 0; bi < boxes.length; bi += 1) {
    for (const b of boxes[bi]!)
      bucketToIndex.set(bucketIndex(b.r, b.g, b.b), bi + (hasTransparency ? 1 : 0));
  }

  const out = new Uint8ClampedArray(data);
  for (let i = 0; i < w * h; i += 1) {
    if (transparentPixels[i]) {
      const o = i * 4;
      out[o] = 0;
      out[o + 1] = 0;
      out[o + 2] = 0;
      out[o + 3] = 0;
      continue;
    }
    const o = i * 4;
    const key = bucketIndex(
      (data[o] as number) >> 3,
      (data[o + 1] as number) >> 3,
      (data[o + 2] as number) >> 3,
    );
    const index = bucketToIndex.get(key);
    if (index === undefined) continue;
    const po = index * 4;
    out[o] = palette[po] as number;
    out[o + 1] = palette[po + 1] as number;
    out[o + 2] = palette[po + 2] as number;
  }

  return {
    imageData: new ImageData(out, w, h),
    palette,
    transparentIndex: hasTransparency,
  };
}
