export const FONT_DETECT_INPUT_SIZE = 224;

export const FONT_DETECT_TENSOR_SPEC = {
  inputWidth: FONT_DETECT_INPUT_SIZE,
  inputHeight: FONT_DETECT_INPUT_SIZE,
  mean: [0.485, 0.456, 0.406] as [number, number, number],
  std: [0.229, 0.224, 0.225] as [number, number, number],
  paddingRgb: [255, 255, 255] as [number, number, number],
};

export interface FontDetectInput {
  imageData: ImageData;
  knownFonts?: string[];
}

export interface FontCandidate {
  family: string;
  confidence: number;
  matchType: 'exact' | 'similar' | 'fallback';
}

export interface FontDetectOutput {
  candidates: FontCandidate[];
  embeddings?: Float32Array;
}

function createOffscreenCanvas(
  w: number,
  h: number,
): {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
} {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h);
    return { canvas: c, ctx: c.getContext('2d')! };
  }
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return { canvas: c, ctx: c.getContext('2d')! };
  }
  throw new Error('No canvas available');
}

export function preprocessFontDetect(imageData: ImageData): Float32Array {
  const size = FONT_DETECT_INPUT_SIZE;
  const tensor = new Float32Array(1 * 3 * size * size);

  const { ctx } = createOffscreenCanvas(size, size);
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, size, size);

  const scale = Math.min(size / imageData.width, size / imageData.height);
  const ow = Math.round(imageData.width * scale);
  const oh = Math.round(imageData.height * scale);
  const ox = Math.round((size - ow) / 2);
  const oy = Math.round((size - oh) / 2);

  const { canvas: srcCanvas, ctx: srcCtx } = createOffscreenCanvas(
    imageData.width,
    imageData.height,
  );
  srcCtx.putImageData(imageData, 0, 0);
  ctx.drawImage(srcCanvas, ox, oy, ow, oh);

  const pixels = ctx.getImageData(0, 0, size, size).data;
  const mean = FONT_DETECT_TENSOR_SPEC.mean;
  const std = FONT_DETECT_TENSOR_SPEC.std;

  for (let i = 0; i < size * size; i++) {
    const idx = i * 4;
    tensor[i] = (pixels[idx]! / 255 - mean[0]) / std[0];
    tensor[size * size + i] = (pixels[idx + 1]! / 255 - mean[1]) / std[1];
    tensor[2 * size * size + i] = (pixels[idx + 2]! / 255 - mean[2]) / std[2];
  }

  return tensor;
}

export function heuristicFontMatch(charImage: ImageData, knownFonts: string[]): FontCandidate[] {
  const candidates: FontCandidate[] = [];
  const totalPixels = charImage.width * charImage.height;
  let inkPixels = 0;
  for (let i = 0; i < charImage.data.length; i += 4) {
    if (charImage.data[i]! < 128) inkPixels++;
  }
  const inkDensity = inkPixels / totalPixels;

  for (const font of knownFonts) {
    const confidence = estimateFontConfidence(font, inkDensity);
    if (confidence > 0.2) {
      candidates.push({
        family: font,
        confidence,
        matchType: confidence > 0.7 ? (confidence > 0.85 ? 'exact' : 'similar') : 'fallback',
      });
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates.slice(0, 5);
}

const FONT_PROFILES: Record<string, { inkDensity: number; serif: boolean; mono: boolean }> = {
  Inter: { inkDensity: 0.42, serif: false, mono: false },
  Helvetica: { inkDensity: 0.4, serif: false, mono: false },
  Arial: { inkDensity: 0.41, serif: false, mono: false },
  'Times New Roman': { inkDensity: 0.38, serif: true, mono: false },
  Georgia: { inkDensity: 0.37, serif: true, mono: false },
  'Courier New': { inkDensity: 0.44, serif: false, mono: true },
  Roboto: { inkDensity: 0.41, serif: false, mono: false },
  'SF Pro': { inkDensity: 0.42, serif: false, mono: false },
  Consolas: { inkDensity: 0.45, serif: false, mono: true },
  'Playfair Display': { inkDensity: 0.35, serif: true, mono: false },
};

function estimateFontConfidence(fontFamily: string, actualDensity: number): number {
  const profile = FONT_PROFILES[fontFamily];
  if (!profile) return 0.25;
  const densityDiff = Math.abs(actualDensity - profile.inkDensity);
  if (densityDiff < 0.02) return 0.9;
  if (densityDiff < 0.05) return 0.75;
  if (densityDiff < 0.1) return 0.5;
  return 0.3;
}

export function validateFontDetectInput(input: FontDetectInput): string | null {
  if (!input.imageData || input.imageData.width < 20 || input.imageData.height < 20) {
    return 'Text region is too small for font detection';
  }
  return null;
}
