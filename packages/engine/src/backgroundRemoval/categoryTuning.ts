/**
 * Category-aware weight caching for background removal.
 *
 * Remembers effective inference parameters for recurrent image categories
 * so the system can auto-apply the best-known settings without manual
 * reconfiguration.
 *
 * Research basis: adaptive image categorization for "smart" parameter
 * presets in Photoshop "Select and Mask" (edge detection heuristics),
 * GIMP's "Foreground Select" tool (colour + edge model), and the general
 * principle of caching inference outcomes by input distribution features.
 */

export interface CategoryProfile {
  categoryId: string;
  name: string;
  preferredModel: string;
  threshold?: number;
  featherRadius?: number;
  decontaminate?: boolean;
  useCount: number;
  lastUsedAt: number;
  satisfactionScore: number;
  featureSignature?: Float64Array;
}

export interface ImageCategoryFeatures {
  dominantHue: number;
  saturationMean: number;
  brightnessMean: number;
  edgeDensity: number;
  foregroundRatio: number;
  colorCount: number;
  hasSkinTones: boolean;
  hasTextElements: boolean;
}

const THUMBNAIL_SIZE = 128;
const EDGE_THRESHOLD = 30;
const SKIN_HUE_RANGES: ReadonlyArray<[number, number]> = [
  [0, 50],
  [330, 360],
];
const SKIN_SAT_MIN = 0.08;
const SKIN_SAT_MAX = 0.7;
const SKIN_VAL_MIN = 0.2;
const TEXT_CC_MAX_PX = 8;

function allocateThumbnailRgba(
  src: Uint8ClampedArray | Uint8Array,
  srcW: number,
  srcH: number,
): { data: Uint8Array; width: number; height: number } {
  const scale = THUMBNAIL_SIZE / Math.max(srcW, srcH);
  const tw = Math.max(1, Math.round(srcW * scale));
  const th = Math.max(1, Math.round(srcH * scale));
  const dst = new Uint8Array(tw * th * 4);

  for (let dy = 0; dy < th; dy++) {
    const sy = Math.min(Math.floor((dy * srcH) / th), srcH - 1);
    for (let dx = 0; dx < tw; dx++) {
      const sx = Math.min(Math.floor((dx * srcW) / tw), srcW - 1);
      const si = (sy * srcW + sx) * 4;
      const di = (dy * tw + dx) * 4;
      dst[di] = src[si] ?? 0;
      dst[di + 1] = src[si + 1] ?? 0;
      dst[di + 2] = src[si + 2] ?? 0;
      dst[di + 3] = src[si + 3] ?? 0;
    }
  }
  return { data: dst, width: tw, height: th };
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const cmax = Math.max(rr, gg, bb);
  const cmin = Math.min(rr, gg, bb);
  const delta = cmax - cmin;
  let h = 0;
  if (delta > 0) {
    if (cmax === rr) {
      h = 60 * (((((gg - bb) / delta) % 6) + 6) % 6);
    } else if (cmax === gg) {
      h = 60 * ((bb - rr) / delta + 2);
    } else {
      h = 60 * ((rr - gg) / delta + 4);
    }
  }
  if (h < 0) h += 360;
  let s = 0;
  if (cmax > 0) s = delta / cmax;
  const v = cmax;
  return [h, s, v];
}

function sobelEdgeMagnitude(data: Uint8Array, w: number, h: number): Float64Array {
  const mag = new Float64Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      const gx =
        -1 * (data[idx - w * 4 - 4] ?? 0) +
        0 * (data[idx - w * 4] ?? 0) +
        1 * (data[idx - w * 4 + 4] ?? 0) +
        -2 * (data[idx - 4] ?? 0) +
        0 * (data[idx] ?? 0) +
        2 * (data[idx + 4] ?? 0) +
        -1 * (data[idx + w * 4 - 4] ?? 0) +
        0 * (data[idx + w * 4] ?? 0) +
        1 * (data[idx + w * 4 + 4] ?? 0);
      const gy =
        -1 * (data[idx - w * 4 - 4] ?? 0) +
        -2 * (data[idx - w * 4] ?? 0) +
        -1 * (data[idx - w * 4 + 4] ?? 0) +
        0 * (data[idx - 4] ?? 0) +
        0 * (data[idx] ?? 0) +
        0 * (data[idx + 4] ?? 0) +
        1 * (data[idx + w * 4 - 4] ?? 0) +
        2 * (data[idx + w * 4] ?? 0) +
        1 * (data[idx + w * 4 + 4] ?? 0);
      mag[y * w + x] = Math.sqrt(gx * gx + gy * gy) / 4;
    }
  }
  return mag;
}

function computeDominantHue(data: Uint8Array, w: number, h: number): number {
  const bins = new Uint32Array(360);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const [hue] = rgbToHsv(r, g, b);
      const bi = Math.max(0, Math.min(359, Math.floor(hue)));
      bins[bi] = (bins[bi] ?? 0) + 1;
    }
  }
  let maxBin = 0;
  let maxCount = 0;
  for (let i = 0; i < 360; i++) {
    const c = bins[i] ?? 0;
    if (c > maxCount) {
      maxCount = c;
      maxBin = i;
    }
  }
  return maxBin;
}

function computeColorCount(data: Uint8Array, w: number, h: number): number {
  const seen = new Set<number>();
  const step = Math.max(1, Math.floor((w * h) / 256));
  for (let i = 0; i < w * h; i += step) {
    const pi = i * 4;
    const r = (data[pi] ?? 0) >> 5;
    const g = (data[pi + 1] ?? 0) >> 5;
    const b = (data[pi + 2] ?? 0) >> 5;
    seen.add((r << 10) | (g << 5) | b);
  }
  return seen.size;
}

function detectSkinTones(data: Uint8Array, w: number, h: number): boolean {
  let skinPixels = 0;
  const total = w * h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const [hue, sat, val] = rgbToHsv(r, g, b);
      const inHue = SKIN_HUE_RANGES.some(([lo, hi]) => hue >= lo && hue <= hi);
      if (inHue && sat >= SKIN_SAT_MIN && sat <= SKIN_SAT_MAX && val >= SKIN_VAL_MIN) {
        skinPixels++;
      }
    }
  }
  return skinPixels / total > 0.02;
}

function detectTextElements(mag: Float64Array, w: number, h: number): boolean {
  let highContrastEdgePixels = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if ((mag[i] ?? 0) > EDGE_THRESHOLD * 3) {
        highContrastEdgePixels++;
      }
    }
  }
  const totalPixels = w * h;
  const highContrastRatio = highContrastEdgePixels / totalPixels;

  let smallCCCount = 0;
  const visited = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if ((mag[i] ?? 0) > EDGE_THRESHOLD && !visited[i]) {
        const stack: number[] = [i];
        visited[i] = 1;
        let ccSize = 0;
        while (stack.length > 0) {
          const cur = stack.pop()!;
          ccSize++;
          if (ccSize > TEXT_CC_MAX_PX) break;
          const cy = Math.floor(cur / w);
          const cx = cur - cy * w;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = cx + dx;
              const ny = cy + dy;
              if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
              const ni = ny * w + nx;
              if ((mag[ni] ?? 0) > EDGE_THRESHOLD && !visited[ni]) {
                visited[ni] = 1;
                stack.push(ni);
              }
            }
          }
        }
        if (ccSize > 0 && ccSize <= TEXT_CC_MAX_PX) {
          smallCCCount++;
        }
      }
    }
  }

  const ccDensity = smallCCCount / (w * h);
  return highContrastRatio > 0.08 && ccDensity > 0.001;
}

export function extractCategoryFeatures(imageData: {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}): ImageCategoryFeatures {
  const { data, width, height } = imageData;
  if (width === 0 || height === 0) {
    return {
      dominantHue: 0,
      saturationMean: 0,
      brightnessMean: 0,
      edgeDensity: 0,
      foregroundRatio: 0,
      colorCount: 0,
      hasSkinTones: false,
      hasTextElements: false,
    };
  }

  const thumb = allocateThumbnailRgba(data, width, height);
  const { data: td, width: tw, height: th } = thumb;

  let satSum = 0;
  let valSum = 0;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const i = (y * tw + x) * 4;
      const r = td[i] ?? 0;
      const g = td[i + 1] ?? 0;
      const b = td[i + 2] ?? 0;
      const [, s, v] = rgbToHsv(r, g, b);
      satSum += s;
      valSum += v;
    }
  }
  const n = tw * th;
  const saturationMean = n > 0 ? satSum / n : 0;
  const brightnessMean = n > 0 ? valSum / n : 0;

  const mag = sobelEdgeMagnitude(td, tw, th);
  let edgeCount = 0;
  for (let i = 0; i < mag.length; i++) {
    if ((mag[i] ?? 0) > EDGE_THRESHOLD) edgeCount++;
  }
  const edgeDensity = n > 0 ? edgeCount / n : 0;

  // Estimate foreground ratio: count pixels in the center region
  // that differ significantly from the average edge-adjacent color (background estimate).
  let cornerSumR = 0;
  let cornerSumG = 0;
  let cornerSumB = 0;
  let cornerPx = 0;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const nearEdge = x < tw * 0.15 || x > tw * 0.85 || y < th * 0.15 || y > th * 0.85;
      if (nearEdge) {
        const i = (y * tw + x) * 4;
        cornerSumR += td[i] ?? 0;
        cornerSumG += td[i + 1] ?? 0;
        cornerSumB += td[i + 2] ?? 0;
        cornerPx++;
      }
    }
  }
  const bgR = cornerPx > 0 ? cornerSumR / cornerPx : 128;
  const bgG = cornerPx > 0 ? cornerSumG / cornerPx : 128;
  const bgB = cornerPx > 0 ? cornerSumB / cornerPx : 128;

  let fgPixels = 0;
  const centerArea = 0.15;
  const yStart = Math.floor(th * centerArea);
  const yEnd = Math.floor(th * (1 - centerArea));
  const xStart = Math.floor(tw * centerArea);
  const xEnd = Math.floor(tw * (1 - centerArea));
  for (let y = yStart; y < yEnd; y++) {
    for (let x = xStart; x < xEnd; x++) {
      const i = (y * tw + x) * 4;
      const r = td[i] ?? 0;
      const g = td[i + 1] ?? 0;
      const b = td[i + 2] ?? 0;
      const dr = r - bgR;
      const dg = g - bgG;
      const db = b - bgB;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      if (dist > 30) fgPixels++;
    }
  }
  const centerTotal = Math.max(1, (yEnd - yStart) * (xEnd - xStart));
  const foregroundRatio = fgPixels / centerTotal;

  const dominantHue = computeDominantHue(td, tw, th);
  const colorCount = computeColorCount(td, tw, th);
  const hasSkinTones = detectSkinTones(td, tw, th);
  const hasTextElements = detectTextElements(mag, tw, th);

  return {
    dominantHue,
    saturationMean,
    brightnessMean,
    edgeDensity,
    foregroundRatio,
    colorCount,
    hasSkinTones,
    hasTextElements,
  };
}

function featureVector(features: ImageCategoryFeatures): Float64Array {
  return new Float64Array([
    (features.dominantHue / 360) * 2 - 1,
    features.saturationMean * 2 - 1,
    features.brightnessMean * 2 - 1,
    features.edgeDensity * 2 - 1,
    features.foregroundRatio * 2 - 1,
    Math.min(features.colorCount / 32, 1) * 2 - 1,
    features.hasSkinTones ? 1 : -1,
    features.hasTextElements ? 1 : -1,
  ]);
}

function euclideanDist(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    sum += d * d;
  }
  return Math.sqrt(sum / len);
}

export function findBestCategoryMatch(
  features: ImageCategoryFeatures,
  profiles: CategoryProfile[],
): { profile: CategoryProfile; similarity: number } | null {
  if (profiles.length === 0) return null;

  const queryVec = featureVector(features);

  let bestDist = Infinity;
  let bestProfile: CategoryProfile | null = null;

  for (const p of profiles) {
    const sig = p.featureSignature ?? featureVector(extractCategoryFeaturesFromProfile(p));
    const dist = euclideanDist(queryVec, sig);
    if (dist < bestDist) {
      bestDist = dist;
      bestProfile = p;
    }
  }

  if (!bestProfile || bestDist > 1.0) return null;

  const similarity = Math.max(0, 1 - bestDist / 1.5);
  return { profile: bestProfile, similarity };
}

function extractCategoryFeaturesFromProfile(profile: CategoryProfile): ImageCategoryFeatures {
  if (profile.featureSignature) {
    const sig = profile.featureSignature;
    return {
      dominantHue: (((sig[0] ?? 0) + 1) / 2) * 360,
      saturationMean: ((sig[1] ?? 0) + 1) / 2,
      brightnessMean: ((sig[2] ?? 0) + 1) / 2,
      edgeDensity: ((sig[3] ?? 0) + 1) / 2,
      foregroundRatio: ((sig[4] ?? 0) + 1) / 2,
      colorCount: (((sig[5] ?? 0) + 1) / 2) * 32,
      hasSkinTones: (sig[6] ?? 0) > 0,
      hasTextElements: (sig[7] ?? 0) > 0,
    };
  }
  return {
    dominantHue: 0,
    saturationMean: 0.5,
    brightnessMean: 0.5,
    edgeDensity: 0,
    foregroundRatio: 0.5,
    colorCount: 16,
    hasSkinTones: false,
    hasTextElements: false,
  };
}

let idCounter = 0;

export function updateCategoryProfile(
  profile: CategoryProfile | null,
  features: ImageCategoryFeatures,
  params: {
    method: string;
    feather?: number;
    decontaminate?: boolean;
    threshold?: number;
  },
  successful: boolean,
): CategoryProfile {
  const now = Date.now();
  const sig = featureVector(features);

  if (!profile) {
    idCounter++;
    const categoryId = `cat-${idCounter}-${now}`;
    return {
      categoryId,
      name: `Category ${idCounter}`,
      preferredModel: params.method,
      threshold: params.threshold,
      featherRadius: params.feather,
      decontaminate: params.decontaminate,
      useCount: 1,
      lastUsedAt: now,
      satisfactionScore: successful ? 1 : 0.3,
      featureSignature: sig,
    };
  }

  const alpha = 0.15;
  const oldSat = profile.satisfactionScore;
  const newSat = successful ? oldSat + alpha * (1 - oldSat) : oldSat - alpha * oldSat;

  return {
    ...profile,
    preferredModel: params.method,
    threshold: params.threshold ?? profile.threshold,
    featherRadius: params.feather ?? profile.featherRadius,
    decontaminate: params.decontaminate ?? profile.decontaminate,
    useCount: profile.useCount + 1,
    lastUsedAt: now,
    satisfactionScore: Math.round(newSat * 1000) / 1000,
    featureSignature: sig,
  };
}
