import type { TensorSpec } from '../imageTensor';

export const TROCR_INPUT_SIZE = 384;
export const TROCR_MAX_SEQUENCE_LENGTH = 128;

export const TROCR_TENSOR_SPEC: TensorSpec = {
  inputWidth: TROCR_INPUT_SIZE,
  inputHeight: TROCR_INPUT_SIZE,
  mean: [0.5, 0.5, 0.5],
  std: [0.5, 0.5, 0.5],
  paddingRgb: [255, 255, 255],
};

export interface TrOcrInput {
  imageData: ImageData;
  maxLength?: number;
}

export interface TrOcrOutput {
  text: string;
  confidence: number;
  charConfidences: number[];
}

const CHARSET =
  ' abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?;:\'"-()[]{}@#$%^&*_+=/\\|~`<>';

function createOffscreenCanvas(
  w: number,
  h: number,
): {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
} {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d')!;
    return { canvas: c, ctx };
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return { canvas: c, ctx };
}

export function preprocessTrOcr(imageData: ImageData): {
  tensor: Float32Array;
  originalWidth: number;
  originalHeight: number;
} {
  const tensor = new Float32Array(1 * 3 * TROCR_INPUT_SIZE * TROCR_INPUT_SIZE);

  const { ctx } = createOffscreenCanvas(TROCR_INPUT_SIZE, TROCR_INPUT_SIZE);
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, TROCR_INPUT_SIZE, TROCR_INPUT_SIZE);

  const scale = Math.min(TROCR_INPUT_SIZE / imageData.width, TROCR_INPUT_SIZE / imageData.height);
  const ow = imageData.width * scale;
  const oh = imageData.height * scale;
  const ox = (TROCR_INPUT_SIZE - ow) / 2;
  const oy = (TROCR_INPUT_SIZE - oh) / 2;

  const { canvas: srcCanvas, ctx: srcCtx } = createOffscreenCanvas(
    imageData.width,
    imageData.height,
  );
  srcCtx.putImageData(imageData, 0, 0);
  ctx.drawImage(srcCanvas, ox, oy, ow, oh);

  const pixels = ctx.getImageData(0, 0, TROCR_INPUT_SIZE, TROCR_INPUT_SIZE).data;
  for (let i = 0; i < TROCR_INPUT_SIZE * TROCR_INPUT_SIZE; i++) {
    const idx = i * 4;
    tensor[i] = (pixels[idx]! / 255 - 0.5) / 0.5;
    tensor[TROCR_INPUT_SIZE * TROCR_INPUT_SIZE + i] = (pixels[idx + 1]! / 255 - 0.5) / 0.5;
    tensor[2 * TROCR_INPUT_SIZE * TROCR_INPUT_SIZE + i] = (pixels[idx + 2]! / 255 - 0.5) / 0.5;
  }

  return { tensor, originalWidth: imageData.width, originalHeight: imageData.height };
}

export function postprocessTrOcr(logits: Float32Array, sequenceLength: number): TrOcrOutput {
  let text = '';
  let totalConf = 0;
  const charConfidences: number[] = [];

  for (let pos = 0; pos < Math.min(sequenceLength, TROCR_MAX_SEQUENCE_LENGTH); pos++) {
    const offset = pos * CHARSET.length;
    let maxIdx = 0;
    let maxVal = -Infinity;
    for (let c = 0; c < CHARSET.length; c++) {
      const v = logits[offset + c] ?? -Infinity;
      if (v > maxVal) {
        maxVal = v;
        maxIdx = c;
      }
    }

    // EOS token (last charset entry)
    if (maxIdx === CHARSET.length - 1) break;

    const ch = CHARSET[maxIdx] ?? '';
    const conf = sigmoid(maxVal);
    text += ch;
    charConfidences.push(conf);
    totalConf += conf;
  }

  const confidence = charConfidences.length > 0 ? totalConf / charConfidences.length : 0;
  return { text: text.trim(), confidence, charConfidences };
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function validateTrOcrInput(input: TrOcrInput): string | null {
  if (!input.imageData || input.imageData.width < 10 || input.imageData.height < 10) {
    return 'Image is too small for OCR (minimum 10x10 pixels)';
  }
  if (input.imageData.width > 4096 || input.imageData.height > 4096) {
    return 'Image is too large for OCR (maximum 4096x4096 pixels)';
  }
  return null;
}
