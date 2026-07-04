/**
 * Pixel-level image processing for filter/adjustment types that CSS ctx.filter
 * cannot handle. Each function operates directly on RGBA Uint8ClampedArray data.
 *
 * Research basis: Photoshop adjustment layer math, ImageMagick pixel cache,
 * GIMP operation implementations.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  if (v <= 0.04045) return v / 12.92;
  return ((v + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(linear: number): number {
  const v = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
  return Math.round(clamp(v, 0, 1) * 255);
}

function rgbToCmyk(r: number, g: number, b: number): [number, number, number, number] {
  const rc = 1 - r / 255;
  const gc = 1 - g / 255;
  const bc = 1 - b / 255;
  const k = Math.min(rc, gc, bc);
  if (Math.abs(k - 1) < 1e-10) return [0, 0, 0, 255];
  const denom = 1 - k;
  return [
    Math.round(255 * ((rc - k) / denom)),
    Math.round(255 * ((gc - k) / denom)),
    Math.round(255 * ((bc - k) / denom)),
    Math.round(255 * k),
  ];
}

function cmykToRgb(c: number, m: number, y: number, k: number): [number, number, number] {
  const rc = c / 255;
  const rm = m / 255;
  const ry = y / 255;
  const rk = k / 255;
  return [
    Math.round(255 * (1 - rc) * (1 - rk)),
    Math.round(255 * (1 - rm) * (1 - rk)),
    Math.round(255 * (1 - ry) * (1 - rk)),
  ];
}

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// ── Curves ───────────────────────────────────────────────────────────────────

export function applyCurves(
  data: Uint8ClampedArray,
  _width: number,
  _height: number,
  channel: 'rgb' | 'red' | 'green' | 'blue',
  points: { input: number; output: number }[],
): void {
  const lut = buildCurveLut(points);
  const len = data.length;

  if (channel === 'rgb') {
    for (let i = 0; i < len; i += 4) {
      data[i] = lut[data[i]!]!;
      data[i + 1] = lut[data[i + 1]!]!;
      data[i + 2] = lut[data[i + 2]!]!;
    }
  } else if (channel === 'red') {
    for (let i = 0; i < len; i += 4) {
      data[i] = lut[data[i]!]!;
    }
  } else if (channel === 'green') {
    for (let i = 1; i < len; i += 4) {
      data[i] = lut[data[i]!]!;
    }
  } else {
    for (let i = 2; i < len; i += 4) {
      data[i] = lut[data[i]!]!;
    }
  }
}

function buildCurveLut(points: { input: number; output: number }[]): Uint8Array {
  const lut = new Uint8Array(256);

  if (points.length === 0) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }

  const sorted = points
    .map((p) => ({ input: clamp(p.input, 0, 1), output: clamp(p.output, 0, 1) }))
    .sort((a, b) => a.input - b.input);

  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;

  for (let i = 0; i < 256; i++) {
    const x = i / 255;

    if (x <= first.input) {
      const t = first.input > 0 ? x / first.input : 0;
      lut[i] = Math.round(clamp(255 * t * first.output, 0, 255));
    } else if (x >= last.input) {
      const t = last.input < 1 ? (x - last.input) / (1 - last.input) : 0;
      const v = last.output + t * (1 - last.output);
      lut[i] = Math.round(clamp(255 * v, 0, 255));
    } else {
      for (let j = 0; j < sorted.length - 1; j++) {
        const a = sorted[j]!;
        const b = sorted[j + 1]!;
        if (x >= a.input && x <= b.input) {
          const range = b.input - a.input;
          const t = range > 0 ? (x - a.input) / range : 0;
          const v = a.output + t * (b.output - a.output);
          lut[i] = Math.round(clamp(255 * v, 0, 255));
          break;
        }
      }
    }
  }

  return lut;
}

// ── Levels ───────────────────────────────────────────────────────────────────

export function applyLevels(
  data: Uint8ClampedArray,
  _width: number,
  _height: number,
  channel: 'rgb' | 'red' | 'green' | 'blue',
  inputShadows: number,
  inputMidtones: number,
  inputHighlights: number,
  outputShadows: number,
  outputHighlights: number,
): void {
  const lut = buildLevelsLut(
    inputShadows,
    inputMidtones,
    inputHighlights,
    outputShadows,
    outputHighlights,
  );
  const len = data.length;

  if (channel === 'rgb') {
    for (let i = 0; i < len; i += 4) {
      data[i] = lut[data[i]!]!;
      data[i + 1] = lut[data[i + 1]!]!;
      data[i + 2] = lut[data[i + 2]!]!;
    }
  } else if (channel === 'red') {
    for (let i = 0; i < len; i += 4) {
      data[i] = lut[data[i]!]!;
    }
  } else if (channel === 'green') {
    for (let i = 1; i < len; i += 4) {
      data[i] = lut[data[i]!]!;
    }
  } else {
    for (let i = 2; i < len; i += 4) {
      data[i] = lut[data[i]!]!;
    }
  }
}

function buildLevelsLut(
  inputShadows: number,
  inputMidtones: number,
  inputHighlights: number,
  outputShadows: number,
  outputHighlights: number,
): Uint8Array {
  const lut = new Uint8Array(256);
  const inRange = inputHighlights - inputShadows;
  const outRange = outputHighlights - outputShadows;
  const gamma = inputMidtones > 0 ? 1 / inputMidtones : 100;

  for (let i = 0; i < 256; i++) {
    let t = inRange > 0 ? (i - inputShadows) / inRange : 0.5;
    t = clamp(t, 0, 1);
    const mapped = t ** gamma;
    lut[i] = Math.round(clamp(outputShadows + mapped * outRange, 0, 255));
  }

  return lut;
}

// ── Selective Color ──────────────────────────────────────────────────────────

export function applySelectiveColor(
  data: Uint8ClampedArray,
  _width: number,
  _height: number,
  colorRange: string,
  cyan: number,
  magenta: number,
  yellow: number,
  black: number,
  relative: boolean,
): void {
  const len = data.length;

  for (let i = 0; i < len; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const m = selectiveColorMembership(r, g, b, colorRange);

    if (m <= 0) continue;

    const [ck, mk, yk, kk] = rgbToCmyk(r, g, b);

    const nc =
      cyan !== 0
        ? relative
          ? clamp(ck + ck * (cyan / 100) * m, 0, 255)
          : clamp(ck + 255 * (cyan / 100) * m, 0, 255)
        : ck;

    const nm =
      magenta !== 0
        ? relative
          ? clamp(mk + mk * (magenta / 100) * m, 0, 255)
          : clamp(mk + 255 * (magenta / 100) * m, 0, 255)
        : mk;

    const ny =
      yellow !== 0
        ? relative
          ? clamp(yk + yk * (yellow / 100) * m, 0, 255)
          : clamp(yk + 255 * (yellow / 100) * m, 0, 255)
        : yk;

    const nk =
      black !== 0
        ? relative
          ? clamp(kk + kk * (black / 100) * m, 0, 255)
          : clamp(kk + 255 * (black / 100) * m, 0, 255)
        : kk;

    const [nr, ng, nb] = cmykToRgb(nc, nm, ny, nk);
    data[i] = nr;
    data[i + 1] = ng;
    data[i + 2] = nb;
  }
}

function selectiveColorMembership(r: number, g: number, b: number, range: string): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const diff = max - min;

  switch (range) {
    case 'reds':
      if (max !== r || diff < 8) return 0;
      return (r - Math.max(g, b)) / 255;
    case 'yellows':
      if (r < 128 || g < 128 || b > r || b > g || diff < 8) return 0;
      return (Math.min(r, g) - b) / 255;
    case 'greens':
      if (max !== g || diff < 8) return 0;
      return (g - Math.max(r, b)) / 255;
    case 'cyans':
      if (g < 128 || b < 128 || r > g || r > b || diff < 8) return 0;
      return (Math.min(g, b) - r) / 255;
    case 'blues':
      if (max !== b || diff < 8) return 0;
      return (b - Math.max(r, g)) / 255;
    case 'magentas':
      if (r < 128 || b < 128 || g > r || g > b || diff < 8) return 0;
      return (Math.min(r, b) - g) / 255;
    case 'whites': {
      const lum = (max + min) / 2;
      if (lum < 200 || diff > 30) return 0;
      return (lum - 200) / 55;
    }
    case 'neutrals': {
      if (diff > 60) return 0;
      return 1 - diff / 60;
    }
    case 'blacks': {
      const lum = (max + min) / 2;
      if (lum > 80 || diff > 30) return 0;
      return (80 - lum) / 80;
    }
    default:
      return 0;
  }
}

// ── Color Balance ────────────────────────────────────────────────────────────

export function applyColorBalance(
  data: Uint8ClampedArray,
  _width: number,
  _height: number,
  shadows: { cyanRed: number; magentaGreen: number; yellowBlue: number },
  midtones: { cyanRed: number; magentaGreen: number; yellowBlue: number },
  highlights: { cyanRed: number; magentaGreen: number; yellowBlue: number },
  preserveLuminosity: boolean,
): void {
  const len = data.length;

  for (let i = 0; i < len; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const L = luma(r, g, b);

    const sw = clamp((128 - L) / 128, 0, 1);
    const hw = clamp((L - 128) / 128, 0, 1);
    const mw = 1 - Math.abs(L - 128) / 128;

    const dr = sw * shadows.cyanRed + mw * midtones.cyanRed + hw * highlights.cyanRed;
    const dg =
      sw * shadows.magentaGreen + mw * midtones.magentaGreen + hw * highlights.magentaGreen;
    const db = sw * shadows.yellowBlue + mw * midtones.yellowBlue + hw * highlights.yellowBlue;

    let nr = clamp(r + dr, 0, 255);
    let ng = clamp(g + dg, 0, 255);
    let nb = clamp(b + db, 0, 255);

    if (preserveLuminosity) {
      const newL = luma(nr, ng, nb);
      if (newL > 0) {
        const scale = L / newL;
        nr = clamp(nr * scale, 0, 255);
        ng = clamp(ng * scale, 0, 255);
        nb = clamp(nb * scale, 0, 255);
      }
    }

    data[i] = nr;
    data[i + 1] = ng;
    data[i + 2] = nb;
  }
}

// ── Channel Mixer ────────────────────────────────────────────────────────────

export function applyChannelMixer(
  data: Uint8ClampedArray,
  _width: number,
  _height: number,
  outputChannel: 'red' | 'green' | 'blue',
  redPercent: number,
  greenPercent: number,
  bluePercent: number,
  constant: number,
  monochrome: boolean,
): void {
  const len = data.length;
  const cAdjust = (constant * 255) / 100;

  if (monochrome) {
    for (let i = 0; i < len; i += 4) {
      const v = clamp(
        (data[i]! * redPercent + data[i + 1]! * greenPercent + data[i + 2]! * bluePercent) / 100 +
          cAdjust,
        0,
        255,
      );
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    }
  } else {
    const targetOffset = outputChannel === 'red' ? 0 : outputChannel === 'green' ? 1 : 2;
    for (let i = 0; i < len; i += 4) {
      const v = clamp(
        (data[i]! * redPercent + data[i + 1]! * greenPercent + data[i + 2]! * bluePercent) / 100 +
          cAdjust,
        0,
        255,
      );
      data[i + targetOffset] = v;
    }
  }
}

// ── Exposure ─────────────────────────────────────────────────────────────────

export function applyExposure(
  data: Uint8ClampedArray,
  _width: number,
  _height: number,
  value: number,
  offset: number,
  gammaCorrection: number,
): void {
  const exposure = 2 ** value;
  const gamma = gammaCorrection > 0 ? 1 / gammaCorrection : 100;
  const offsetNorm = offset / 255;
  const len = data.length;

  for (let i = 0; i < len; i += 4) {
    const r = srgbToLinear(data[i]!);
    const g = srgbToLinear(data[i + 1]!);
    const b = srgbToLinear(data[i + 2]!);

    data[i] = linearToSrgb(clamp(r * exposure + offsetNorm, 0, 1) ** gamma);
    data[i + 1] = linearToSrgb(clamp(g * exposure + offsetNorm, 0, 1) ** gamma);
    data[i + 2] = linearToSrgb(clamp(b * exposure + offsetNorm, 0, 1) ** gamma);
  }
}

// ── Temperature ──────────────────────────────────────────────────────────────

export function applyTemperature(
  data: Uint8ClampedArray,
  _width: number,
  _height: number,
  value: number,
): void {
  const scale = value / 200;
  const rScale = 1 + scale;
  const bScale = 1 - scale;
  const gScale = 1 + scale * 0.3;
  const len = data.length;

  for (let i = 0; i < len; i += 4) {
    const rLin = srgbToLinear(data[i]!);
    const gLin = srgbToLinear(data[i + 1]!);
    const bLin = srgbToLinear(data[i + 2]!);

    data[i] = linearToSrgb(clamp(rLin * rScale, 0, 1));
    data[i + 1] = linearToSrgb(clamp(gLin * gScale, 0, 1));
    data[i + 2] = linearToSrgb(clamp(bLin * bScale, 0, 1));
  }
}

// ── Sharpen (Unsharp Mask) ───────────────────────────────────────────────────

export function applySharpen(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number,
  radius: number,
  threshold: number,
): void {
  if (amount === 0) return;

  const blurred = boxBlur(data, width, height, Math.max(0.5, radius));
  const len = data.length;
  const amountScale = amount / 100;

  for (let i = 0; i < len; i += 4) {
    for (let c = 0; c < 3; c++) {
      const idx = i + c;
      const diff = data[idx]! - blurred[idx]!;
      if (Math.abs(diff) > threshold) {
        data[idx] = clamp(data[idx]! + amountScale * diff, 0, 255);
      }
    }
  }
}

function boxBlur(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  const r = Math.max(1, Math.round(radius));
  const len = data.length;
  const temp = new Uint8ClampedArray(len);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let count = 0;

      for (let dx = -r; dx <= r; dx++) {
        const sx = x + dx;
        if (sx >= 0 && sx < width) {
          const idx = (y * width + sx) * 4;
          sumR += data[idx]!;
          sumG += data[idx + 1]!;
          sumB += data[idx + 2]!;
          count++;
        }
      }

      const oi = (y * width + x) * 4;
      temp[oi] = sumR / count;
      temp[oi + 1] = sumG / count;
      temp[oi + 2] = sumB / count;
      temp[oi + 3] = data[oi + 3]!;
    }
  }

  const result = new Uint8ClampedArray(len);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let count = 0;

      for (let dy = -r; dy <= r; dy++) {
        const sy = y + dy;
        if (sy >= 0 && sy < height) {
          const idx = (sy * width + x) * 4;
          sumR += temp[idx]!;
          sumG += temp[idx + 1]!;
          sumB += temp[idx + 2]!;
          count++;
        }
      }

      const oi = (y * width + x) * 4;
      result[oi] = sumR / count;
      result[oi + 1] = sumG / count;
      result[oi + 2] = sumB / count;
      result[oi + 3] = data[oi + 3]!;
    }
  }

  return result;
}

// ── Photo Filter ─────────────────────────────────────────────────────────────

export function applyPhotoFilter(
  data: Uint8ClampedArray,
  _width: number,
  _height: number,
  color: readonly [number, number, number, number],
  density: number,
  preserveLuminosity: boolean,
): void {
  const d = clamp(density, 0, 100) / 100;
  if (d === 0) return;

  const fr = color[0];
  const fg = color[1];
  const fb = color[2];
  const fa = color[3] / 255;
  const len = data.length;

  for (let i = 0; i < len; i += 4) {
    const or = data[i]!;
    const og = data[i + 1]!;
    const ob = data[i + 2]!;

    const nr = or * (1 - d) + fr * d * fa;
    const ng = og * (1 - d) + fg * d * fa;
    const nb = ob * (1 - d) + fb * d * fa;

    let finalR = clamp(nr, 0, 255);
    let finalG = clamp(ng, 0, 255);
    let finalB = clamp(nb, 0, 255);

    if (preserveLuminosity) {
      const origL = luma(or, og, ob);
      const newL = luma(finalR, finalG, finalB);
      if (newL > 0) {
        const scale = origL / newL;
        finalR = clamp(finalR * scale, 0, 255);
        finalG = clamp(finalG * scale, 0, 255);
        finalB = clamp(finalB * scale, 0, 255);
      }
    }

    data[i] = finalR;
    data[i + 1] = finalG;
    data[i + 2] = finalB;
  }
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

type PixelProcessor = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  params: Record<string, unknown>,
) => void;

const pixelProcessors = new Map<string, PixelProcessor>();

function registerKind(kind: string, processor: PixelProcessor): void {
  pixelProcessors.set(kind, processor);
}

registerKind('curves', (data, w, h, p) => {
  applyCurves(
    data,
    w,
    h,
    (p.channel as 'rgb' | 'red' | 'green' | 'blue') ?? 'rgb',
    (p.points as { input: number; output: number }[]) ?? [],
  );
});

registerKind('levels', (data, w, h, p) => {
  applyLevels(
    data,
    w,
    h,
    (p.channel as 'rgb' | 'red' | 'green' | 'blue') ?? 'rgb',
    (p.inputShadows as number) ?? 0,
    (p.inputMidtones as number) ?? 1,
    (p.inputHighlights as number) ?? 255,
    (p.outputShadows as number) ?? 0,
    (p.outputHighlights as number) ?? 255,
  );
});

registerKind('selectiveColor', (data, w, h, p) => {
  applySelectiveColor(
    data,
    w,
    h,
    (p.colorRange as string) ?? 'neutrals',
    (p.cyan as number) ?? 0,
    (p.magenta as number) ?? 0,
    (p.yellow as number) ?? 0,
    (p.black as number) ?? 0,
    (p.relative as boolean) ?? true,
  );
});

registerKind('colorBalance', (data, w, h, p) => {
  applyColorBalance(
    data,
    w,
    h,
    (p.shadows as { cyanRed: number; magentaGreen: number; yellowBlue: number }) ?? {
      cyanRed: 0,
      magentaGreen: 0,
      yellowBlue: 0,
    },
    (p.midtones as { cyanRed: number; magentaGreen: number; yellowBlue: number }) ?? {
      cyanRed: 0,
      magentaGreen: 0,
      yellowBlue: 0,
    },
    (p.highlights as { cyanRed: number; magentaGreen: number; yellowBlue: number }) ?? {
      cyanRed: 0,
      magentaGreen: 0,
      yellowBlue: 0,
    },
    (p.preserveLuminosity as boolean) ?? true,
  );
});

registerKind('channelMixer', (data, w, h, p) => {
  applyChannelMixer(
    data,
    w,
    h,
    (p.outputChannel as 'red' | 'green' | 'blue') ?? 'red',
    (p.redPercent as number) ?? 100,
    (p.greenPercent as number) ?? 0,
    (p.bluePercent as number) ?? 0,
    (p.constant as number) ?? 0,
    (p.monochrome as boolean) ?? false,
  );
});

registerKind('exposure', (data, w, h, p) => {
  applyExposure(
    data,
    w,
    h,
    (p.value as number) ?? 0,
    (p.offset as number) ?? 0,
    (p.gammaCorrection as number) ?? 1,
  );
});

registerKind('temperature', (data, w, h, p) => {
  applyTemperature(data, w, h, (p.value as number) ?? 0);
});

registerKind('sharpen', (data, w, h, p) => {
  applySharpen(
    data,
    w,
    h,
    (p.amount as number) ?? 0,
    (p.radius as number) ?? 1,
    (p.threshold as number) ?? 0,
  );
});

registerKind('photoFilter', (data, w, h, p) => {
  applyPhotoFilter(
    data,
    w,
    h,
    (p.color as readonly [number, number, number, number]) ?? [255, 255, 255, 255],
    (p.density as number) ?? 25,
    (p.preserveLuminosity as boolean) ?? true,
  );
});

/** Kinds that this pipeline can process. */
export function hasPixelProcessor(kind: string): boolean {
  return pixelProcessors.has(kind);
}

/**
 * Apply a pixel-level filter to an ImageData buffer.
 * Returns a new ImageData with the filter applied; the original is unmodified.
 */
export function applyPixelFilter(
  imageData: ImageData,
  kind: string,
  params: Record<string, unknown>,
): ImageData {
  const { data, width, height } = imageData;
  const result = new Uint8ClampedArray(data);
  const processor = pixelProcessors.get(kind);

  if (processor) {
    processor(result, width, height, params);
  }

  return new ImageData(result, width, height);
}
