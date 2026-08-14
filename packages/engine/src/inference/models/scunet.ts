/**
 * SCUNet — real-world blind image denoising.
 *
 * Padding constraint: the Heliosoph ONNX conversion bakes a window-8
 * channel-attention reshape with floor-grid semantics, so padded H and W
 * must each be divisible by 64 — the manifest's "divisible by 8" contract
 * is wrong and crashes the graph for e.g. 1080p inputs (1080 % 64 != 0).
 * Verified 2026-08-13 on a dimension sweep (OK exactly when % 64 == 0).
 */
import type { TensorSpec } from '../imageTensor';

export const SCUNET_INPUT_SIZE = 0;

export const SCUNET_TENSOR_SPEC: TensorSpec = {
  inputWidth: 0,
  inputHeight: 0,
  mean: [0, 0, 0],
  std: [1, 1, 1],
  paddingRgb: [0, 0, 0],
};

export interface ScunetInferenceInput {
  imageData: ImageData;
  strength?: number;
  tileSize?: number;
  overlap?: number;
}

export interface ScunetInferenceOutput {
  imageData: ImageData;
  processedWidth: number;
  processedHeight: number;
}

/**
 * SCUNet requires padded H and W divisible by 64 (see the header note on
 * the baked attention reshape). The name stays `alignTo8` for
 * compatibility; the 64 alignment is the only safe padding.
 */
export function alignTo8(n: number): number {
  return Math.max(64, Math.ceil(n / 64) * 64);
}

export interface ScunetPreprocessResult {
  tensor: Float32Array;
  alignedWidth: number;
  alignedHeight: number;
  originalWidth: number;
  originalHeight: number;
  hasAlpha: boolean;
  alphaData: Uint8ClampedArray | null;
}

export function preprocessScunet(imageData: ImageData): ScunetPreprocessResult {
  const originalWidth = imageData.width;
  const originalHeight = imageData.height;
  const alignedWidth = alignTo8(originalWidth);
  const alignedHeight = alignTo8(originalHeight);
  let hasAlpha = false;
  for (let i = 0; i < originalWidth * originalHeight; i++) {
    if (imageData.data[i * 4 + 3]! < 255) {
      hasAlpha = true;
      break;
    }
  }
  let alphaData: Uint8ClampedArray | null = null;
  if (hasAlpha) {
    alphaData = new Uint8ClampedArray(originalWidth * originalHeight);
    for (let i = 0; i < originalWidth * originalHeight; i++)
      alphaData[i] = imageData.data[i * 4 + 3]!;
  }
  const pixelCount = alignedWidth * alignedHeight;
  const tensor = new Float32Array(pixelCount * 3);
  for (let y = 0; y < alignedHeight; y++) {
    for (let x = 0; x < alignedWidth; x++) {
      const srcX = Math.min(x, originalWidth - 1);
      const srcY = Math.min(y, originalHeight - 1);
      const srcIdx = (srcY * originalWidth + srcX) * 4;
      const dstIdx = y * alignedWidth + x;
      tensor[dstIdx] = imageData.data[srcIdx]! / 255;
      tensor[pixelCount + dstIdx] = imageData.data[srcIdx + 1]! / 255;
      tensor[pixelCount * 2 + dstIdx] = imageData.data[srcIdx + 2]! / 255;
    }
  }
  return {
    tensor,
    alignedWidth,
    alignedHeight,
    originalWidth,
    originalHeight,
    hasAlpha,
    alphaData,
  };
}

export interface ScunetTile {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function computeTiles(
  width: number,
  height: number,
  tileSize = 512,
  overlap = 64,
): ScunetTile[] {
  if (overlap >= tileSize) throw new Error('overlap must be less than tileSize');
  const stride = tileSize - overlap;
  const tiles: ScunetTile[] = [];
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      tiles.push({
        x,
        y,
        width: Math.min(tileSize, width - x),
        height: Math.min(tileSize, height - y),
      });
    }
  }
  return tiles;
}

export function extractTile(
  imageData: ImageData,
  tile: ScunetTile,
): {
  tensor: Float32Array;
  alignedWidth: number;
  alignedHeight: number;
  alphaData: Uint8ClampedArray | null;
} {
  const { width, height } = tile;
  const tw = alignTo8(width);
  const th = alignTo8(height);
  const pixelCount = tw * th;
  const tensor = new Float32Array(pixelCount * 3);
  let hasAlpha = false;
  for (let dy = 0; dy < tile.height; dy++) {
    for (let dx = 0; dx < tile.width; dx++) {
      const srcX = Math.min(tile.x + dx, imageData.width - 1);
      const srcY = Math.min(tile.y + dy, imageData.height - 1);
      if (imageData.data[(srcY * imageData.width + srcX) * 4 + 3]! < 255) {
        hasAlpha = true;
        break;
      }
    }
    if (hasAlpha) break;
  }
  let alphaData: Uint8ClampedArray | null = null;
  if (hasAlpha) {
    alphaData = new Uint8ClampedArray(tile.width * tile.height);
    for (let dy = 0; dy < tile.height; dy++) {
      for (let dx = 0; dx < tile.width; dx++) {
        const srcX = Math.min(tile.x + dx, imageData.width - 1);
        const srcY = Math.min(tile.y + dy, imageData.height - 1);
        alphaData[dy * tile.width + dx] = imageData.data[(srcY * imageData.width + srcX) * 4 + 3]!;
      }
    }
  }
  for (let dy = 0; dy < th; dy++) {
    for (let dx = 0; dx < tw; dx++) {
      const srcX = Math.min(tile.x + dx, imageData.width - 1);
      const srcY = Math.min(tile.y + dy, imageData.height - 1);
      const srcIdx = (srcY * imageData.width + srcX) * 4;
      const dstIdx = dy * tw + dx;
      tensor[dstIdx] = imageData.data[srcIdx]! / 255;
      tensor[pixelCount + dstIdx] = imageData.data[srcIdx + 1]! / 255;
      tensor[pixelCount * 2 + dstIdx] = imageData.data[srcIdx + 2]! / 255;
    }
  }
  return { tensor, alignedWidth: tw, alignedHeight: th, alphaData };
}

export function blendTiles(
  tiles: ScunetTile[],
  tileResults: Float32Array[],
  outputWidth: number,
  outputHeight: number,
  overlap: number,
): Float32Array {
  const pixelCount = outputWidth * outputHeight;
  const output = new Float32Array(pixelCount * 3);
  const weightAccum = new Float32Array(pixelCount);
  // Zero-weight pixels (image borders covered by a single tile's edge) fall
  // back to the last tile's raw value — without this, the `weightAccum || 1`
  // fallback divides 0 by 1 and paints black border lines on tiled output.
  const rawFallback = new Float32Array(pixelCount * 3);
  for (let t = 0; t < tiles.length; t++) {
    const tile = tiles[t]!;
    const result = tileResults[t]!;
    const tw = alignTo8(tile.width);
    const th = alignTo8(tile.height);
    const srcPixels = tw * th;
    for (let dy = 0; dy < tile.height; dy++) {
      for (let dx = 0; dx < tile.width; dx++) {
        const outX = tile.x + dx;
        const outY = tile.y + dy;
        if (outX >= outputWidth || outY >= outputHeight) continue;
        const distToEdge = Math.min(dx, dy, tile.width - 1 - dx, tile.height - 1 - dy);
        const maxFeather = Math.min(overlap, tile.width >> 1, tile.height >> 1);
        const weight = Math.min(1, distToEdge / Math.max(1, maxFeather));
        const srcIdx = dy * tw + dx;
        const outIdx = outY * outputWidth + outX;
        output[outIdx] = output[outIdx]! + result[srcIdx]! * weight;
        output[outIdx + pixelCount] =
          output[outIdx + pixelCount]! + result[srcIdx + srcPixels]! * weight;
        output[outIdx + pixelCount * 2] =
          output[outIdx + pixelCount * 2]! + result[srcIdx + srcPixels * 2]! * weight;
        rawFallback[outIdx] = result[srcIdx]!;
        rawFallback[outIdx + pixelCount] = result[srcIdx + srcPixels]!;
        rawFallback[outIdx + pixelCount * 2] = result[srcIdx + srcPixels * 2]!;
        weightAccum[outIdx] = weightAccum[outIdx]! + weight;
      }
    }
  }
  for (let i = 0; i < pixelCount; i++) {
    const w = weightAccum[i]!;
    if (w > 0) {
      output[i] = output[i]! / w;
      output[i + pixelCount] = output[i + pixelCount]! / w;
      output[i + pixelCount * 2] = output[i + pixelCount * 2]! / w;
    } else {
      output[i] = rawFallback[i]!;
      output[i + pixelCount] = rawFallback[i + pixelCount]!;
      output[i + pixelCount * 2] = rawFallback[i + pixelCount * 2]!;
    }
  }
  return output;
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

export function postprocessScunet(
  outputTensor: Float32Array,
  outW: number,
  outH: number,
  targetW: number,
  targetH: number,
  alphaData: Uint8ClampedArray | null,
  strength: number,
  originalData: Uint8ClampedArray,
): ImageData {
  const result = new ImageData(targetW, targetH);
  const outPixels = outW * outH;
  if (outW === targetW && outH === targetH) {
    for (let i = 0; i < targetW * targetH; i++) {
      const dstIdx = i * 4;
      for (let c = 0; c < 3; c++) {
        const modelVal = outputTensor[i + c * outPixels]!;
        const origVal = originalData[dstIdx + c]! / 255;
        result.data[dstIdx + c] = clamp255((origVal * (1 - strength) + modelVal * strength) * 255);
      }
      result.data[dstIdx + 3] = alphaData ? alphaData[i]! : 255;
    }
  } else {
    for (let y = 0; y < targetH; y++) {
      for (let x = 0; x < targetW; x++) {
        const srcX = (x / targetW) * outW;
        const srcY = (y / targetH) * outH;
        const x0 = Math.min(Math.floor(srcX), outW - 1);
        const y0 = Math.min(Math.floor(srcY), outH - 1);
        const x1 = Math.min(x0 + 1, outW - 1);
        const y1 = Math.min(y0 + 1, outH - 1);
        const xW = srcX - x0;
        const yW = srcY - y0;
        const dstIdx = (y * targetW + x) * 4;
        for (let c = 0; c < 3; c++) {
          const tl = outputTensor[y0 * outW + x0 + c * outPixels]!;
          const tr = outputTensor[y0 * outW + x1 + c * outPixels]!;
          const bl = outputTensor[y1 * outW + x0 + c * outPixels]!;
          const br = outputTensor[y1 * outW + x1 + c * outPixels]!;
          const val = (tl * (1 - xW) + tr * xW) * (1 - yW) + (bl * (1 - xW) + br * xW) * yW;
          const origVal = originalData[dstIdx + c]! / 255;
          result.data[dstIdx + c] = clamp255((origVal * (1 - strength) + val * strength) * 255);
        }
        result.data[dstIdx + 3] = alphaData ? alphaData[y * targetW + x]! : 255;
      }
    }
  }
  return result;
}

export function validateScunetInput(input: unknown): string | null {
  if (!input || typeof input !== 'object') return 'Input must be an object';
  const obj = input as Record<string, unknown>;
  if (!obj.imageData || typeof obj.imageData !== 'object') return 'imageData is required';
  const img = obj.imageData as Record<string, unknown>;
  if (typeof img.width !== 'number' || img.width <= 0) return 'imageData must have a valid width';
  if (typeof img.height !== 'number' || img.height <= 0)
    return 'imageData must have a valid height';
  if (
    obj.strength !== undefined &&
    (typeof obj.strength !== 'number' || obj.strength < 0 || obj.strength > 1)
  ) {
    return 'strength must be a number between 0 and 1';
  }
  return null;
}
