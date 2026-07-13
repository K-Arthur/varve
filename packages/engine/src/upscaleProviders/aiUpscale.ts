/**
 * Tiled Real-ESRGAN x4 inference for the enhancement worker.
 *
 * Research basis: the official Real-ESRGAN x4v3 network consumes normalized
 * NCHW RGB and produces a fixed 4x RGB tensor. Padded tiles are cropped to
 * their non-overlapping cores so each destination pixel is written once.
 */
import type { InferenceSession } from 'onnxruntime-web';

const MODEL_SCALE = 4;
const TILE_CORE = 256;
const TILE_PADDING = 32;

export function packRgbChw(imageData: ImageData): Float32Array {
  const pixelCount = imageData.width * imageData.height;
  const packed = new Float32Array(pixelCount * 3);
  for (let index = 0; index < pixelCount; index += 1) {
    const visible = (imageData.data[index * 4 + 3] ?? 0) > 0;
    packed[index] = visible ? (imageData.data[index * 4] ?? 0) / 255 : 0;
    packed[pixelCount + index] = visible ? (imageData.data[index * 4 + 1] ?? 0) / 255 : 0;
    packed[pixelCount * 2 + index] = visible ? (imageData.data[index * 4 + 2] ?? 0) / 255 : 0;
  }
  return packed;
}

interface CopyTileCoreOptions {
  destination: Uint8ClampedArray;
  destinationWidth: number;
  tileRgb: Float32Array;
  tileWidth: number;
  sourceCoreX: number;
  sourceCoreY: number;
  coreWidth: number;
  coreHeight: number;
  destinationX: number;
  destinationY: number;
}

export function copyUpscaledTileCore(options: CopyTileCoreOptions): void {
  const {
    destination,
    destinationWidth,
    tileRgb,
    tileWidth,
    sourceCoreX,
    sourceCoreY,
    coreWidth,
    coreHeight,
    destinationX,
    destinationY,
  } = options;
  const tileHeight = Math.floor(tileRgb.length / 3 / tileWidth);
  const plane = tileWidth * tileHeight;
  for (let y = 0; y < coreHeight; y += 1) {
    for (let x = 0; x < coreWidth; x += 1) {
      const sourceIndex = (sourceCoreY + y) * tileWidth + sourceCoreX + x;
      const destinationIndex = ((destinationY + y) * destinationWidth + destinationX + x) * 4;
      destination[destinationIndex] = Math.round(
        Math.max(0, Math.min(1, tileRgb[sourceIndex] ?? 0)) * 255,
      );
      destination[destinationIndex + 1] = Math.round(
        Math.max(0, Math.min(1, tileRgb[plane + sourceIndex] ?? 0)) * 255,
      );
      destination[destinationIndex + 2] = Math.round(
        Math.max(0, Math.min(1, tileRgb[plane * 2 + sourceIndex] ?? 0)) * 255,
      );
      destination[destinationIndex + 3] = 255;
    }
  }
}

function extractTile(source: ImageData, x: number, y: number, width: number, height: number) {
  const tile = new ImageData(width, height);
  for (let ty = 0; ty < height; ty += 1) {
    const sourceStart = ((y + ty) * source.width + x) * 4;
    const sourceEnd = sourceStart + width * 4;
    tile.data.set(source.data.subarray(sourceStart, sourceEnd), ty * width * 4);
  }
  return tile;
}

function bilinearAlpha(source: ImageData, destination: Uint8ClampedArray): void {
  const outputWidth = source.width * MODEL_SCALE;
  const outputHeight = source.height * MODEL_SCALE;
  for (let y = 0; y < outputHeight; y += 1) {
    const sourceY = Math.max(0, Math.min(source.height - 1, (y + 0.5) / MODEL_SCALE - 0.5));
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(source.height - 1, y0 + 1);
    const fy = sourceY - y0;
    for (let x = 0; x < outputWidth; x += 1) {
      const sourceX = Math.max(0, Math.min(source.width - 1, (x + 0.5) / MODEL_SCALE - 0.5));
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(source.width - 1, x0 + 1);
      const fx = sourceX - x0;
      const a00 = source.data[(y0 * source.width + x0) * 4 + 3] ?? 0;
      const a10 = source.data[(y0 * source.width + x1) * 4 + 3] ?? 0;
      const a01 = source.data[(y1 * source.width + x0) * 4 + 3] ?? 0;
      const a11 = source.data[(y1 * source.width + x1) * 4 + 3] ?? 0;
      const top = a00 * (1 - fx) + a10 * fx;
      const bottom = a01 * (1 - fx) + a11 * fx;
      const destinationIndex = (y * outputWidth + x) * 4;
      const alpha = Math.round(top * (1 - fy) + bottom * fy);
      destination[destinationIndex + 3] = alpha;
      if (alpha === 0) {
        destination[destinationIndex] = 0;
        destination[destinationIndex + 1] = 0;
        destination[destinationIndex + 2] = 0;
      }
    }
  }
}

async function createSession(modelPath: string): Promise<InferenceSession> {
  const ort = await import('onnxruntime-web');
  ort.env.wasm.wasmPaths = '/ort-wasm/';
  return ort.InferenceSession.create(modelPath, { executionProviders: ['wasm'] });
}

export async function upscaleWithRealEsrgan(
  source: ImageData,
  modelPath: string,
  isCancelled: () => boolean,
): Promise<ImageData> {
  const ort = await import('onnxruntime-web');
  const session = await createSession(modelPath);
  const outputWidth = source.width * MODEL_SCALE;
  const outputHeight = source.height * MODEL_SCALE;
  const output = new ImageData(outputWidth, outputHeight);

  try {
    for (let coreY = 0; coreY < source.height; coreY += TILE_CORE) {
      for (let coreX = 0; coreX < source.width; coreX += TILE_CORE) {
        if (isCancelled()) throw new Error('cancelled');
        const coreWidth = Math.min(TILE_CORE, source.width - coreX);
        const coreHeight = Math.min(TILE_CORE, source.height - coreY);
        const tileX = Math.max(0, coreX - TILE_PADDING);
        const tileY = Math.max(0, coreY - TILE_PADDING);
        const tileRight = Math.min(source.width, coreX + coreWidth + TILE_PADDING);
        const tileBottom = Math.min(source.height, coreY + coreHeight + TILE_PADDING);
        const tile = extractTile(source, tileX, tileY, tileRight - tileX, tileBottom - tileY);
        const inputName = session.inputNames[0];
        if (!inputName) throw new Error('Real-ESRGAN model has no input tensor');
        const input = new ort.Tensor('float32', packRgbChw(tile), [1, 3, tile.height, tile.width]);
        const result = await session.run({ [inputName]: input });
        if (isCancelled()) throw new Error('cancelled');
        const outputName = session.outputNames[0];
        const tensor = outputName ? result[outputName] : undefined;
        if (!tensor || !(tensor.data instanceof Float32Array)) {
          throw new Error('Real-ESRGAN returned an invalid output tensor');
        }
        const tileOutputWidth = Number(tensor.dims[3] ?? tile.width * MODEL_SCALE);
        const tileOutputHeight = Number(tensor.dims[2] ?? tile.height * MODEL_SCALE);
        if (
          tileOutputWidth !== tile.width * MODEL_SCALE ||
          tileOutputHeight !== tile.height * MODEL_SCALE
        ) {
          throw new Error('Real-ESRGAN model does not satisfy the fixed 4x contract');
        }
        copyUpscaledTileCore({
          destination: output.data,
          destinationWidth: outputWidth,
          tileRgb: tensor.data,
          tileWidth: tileOutputWidth,
          sourceCoreX: (coreX - tileX) * MODEL_SCALE,
          sourceCoreY: (coreY - tileY) * MODEL_SCALE,
          coreWidth: coreWidth * MODEL_SCALE,
          coreHeight: coreHeight * MODEL_SCALE,
          destinationX: coreX * MODEL_SCALE,
          destinationY: coreY * MODEL_SCALE,
        });
      }
    }
  } finally {
    await session.release();
  }

  bilinearAlpha(source, output.data);
  return output;
}
