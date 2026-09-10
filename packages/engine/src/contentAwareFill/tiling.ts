export interface TileConfig {
  tileW: number;
  tileH: number;
  overlap: number;
  contextMargin: number;
}

export interface TileRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  intersectsMask: boolean;
}

export interface TileBlendWeights {
  weights: Float32Array;
  width: number;
  height: number;
}

const MIN_TILE_SIZE = 32;
const SIGNIFICANCE_THRESHOLD = 0.1;

export function computeTiles(
  imageWidth: number,
  imageHeight: number,
  maskBounds: { x: number; y: number; w: number; h: number } | null,
  tileSize: number,
  overlap: number,
): TileRegion[] {
  if (imageWidth <= tileSize && imageHeight <= tileSize) {
    return [
      {
        x: 0,
        y: 0,
        w: imageWidth,
        h: imageHeight,
        intersectsMask: true,
      },
    ];
  }

  let rx: number;
  let ry: number;
  let rw: number;
  let rh: number;
  if (maskBounds) {
    rx = maskBounds.x;
    ry = maskBounds.y;
    rw = maskBounds.w;
    rh = maskBounds.h;
  } else {
    rx = 0;
    ry = 0;
    rw = imageWidth;
    rh = imageHeight;
  }

  rx = Math.max(0, rx);
  ry = Math.max(0, ry);
  rw = Math.min(imageWidth - rx, rw);
  rh = Math.min(imageHeight - ry, rh);

  if (rw <= 0 || rh <= 0) return [];

  const stride = Math.max(1, tileSize - overlap);
  const tiles: TileRegion[] = [];

  for (let y = ry; y < ry + rh && y < imageHeight; y += stride) {
    for (let x = rx; x < rx + rw && x < imageWidth; x += stride) {
      let tileX = x;
      let tileY = y;
      let tileW = Math.min(tileSize, imageWidth - tileX);
      let tileH = Math.min(tileSize, imageHeight - tileY);

      if (tileW < MIN_TILE_SIZE) {
        const pullBack = MIN_TILE_SIZE - tileW;
        tileX = Math.max(0, tileX - pullBack);
        tileW = Math.min(tileSize, imageWidth - tileX);
      }
      if (tileH < MIN_TILE_SIZE) {
        const pullBack = MIN_TILE_SIZE - tileH;
        tileY = Math.max(0, tileY - pullBack);
        tileH = Math.min(tileSize, imageHeight - tileY);
      }

      tileW = Math.min(tileW, imageWidth - tileX);
      tileH = Math.min(tileH, imageHeight - tileY);

      if (tileW <= 0 || tileH <= 0) continue;

      const intersectsMask = maskBounds
        ? tileX < maskBounds.x + maskBounds.w &&
          tileX + tileW > maskBounds.x &&
          tileY < maskBounds.y + maskBounds.h &&
          tileY + tileH > maskBounds.y
        : true;

      tiles.push({
        x: tileX,
        y: tileY,
        w: tileW,
        h: tileH,
        intersectsMask,
      });
    }
  }

  return tiles;
}

export function computeFeatherWeights(
  width: number,
  height: number,
  overlap: number,
): Float32Array {
  const weights = new Float32Array(width * height);

  if (overlap <= 0) {
    weights.fill(1);
    return weights;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dLeft = x;
      const dRight = width - 1 - x;
      const dTop = y;
      const dBottom = height - 1 - y;

      const d = Math.min(dLeft, dRight, dTop, dBottom);

      if (d >= overlap) {
        weights[y * width + x] = 1;
      } else {
        weights[y * width + x] = 0.5 * (1 - Math.cos((Math.PI * d) / overlap));
      }
    }
  }

  return weights;
}

export function blendTiles(
  dest: ImageData,
  tileResults: Array<{
    tile: TileRegion;
    imageData: ImageData;
    weights: Float32Array;
  }>,
  outputWidth: number,
  outputHeight: number,
): ImageData {
  const result = new ImageData(new Uint8ClampedArray(dest.data), outputWidth, outputHeight);
  const accWeight = new Float64Array(outputWidth * outputHeight);

  for (const tr of tileResults) {
    const { tile, imageData, weights } = tr;

    for (let ty = 0; ty < tile.h; ty++) {
      for (let tx = 0; tx < tile.w; tx++) {
        const dx = tile.x + tx;
        const dy = tile.y + ty;
        if (dx < 0 || dx >= outputWidth || dy < 0 || dy >= outputHeight) continue;

        const wi = ty * tile.w + tx;
        const weight = weights[wi] ?? 0;
        if (weight <= 0) continue;

        const si = (ty * imageData.width + tx) * 4;
        const di = (dy * outputWidth + dx) * 4;
        const ai = dy * outputWidth + dx;

        result.data[di] = (result.data[di] ?? 0) + (imageData.data[si] ?? 0) * weight;
        result.data[di + 1] = (result.data[di + 1] ?? 0) + (imageData.data[si + 1] ?? 0) * weight;
        result.data[di + 2] = (result.data[di + 2] ?? 0) + (imageData.data[si + 2] ?? 0) * weight;
        result.data[di + 3] = (result.data[di + 3] ?? 0) + (imageData.data[si + 3] ?? 0) * weight;
        accWeight[ai] = (accWeight[ai] ?? 0) + weight;
      }
    }
  }

  for (let i = 0; i < outputWidth * outputHeight; i++) {
    const w = accWeight[i] ?? 0;
    if (w > 0) {
      const di = i * 4;
      result.data[di] = Math.round((result.data[di] ?? 0) / w);
      result.data[di + 1] = Math.round((result.data[di + 1] ?? 0) / w);
      result.data[di + 2] = Math.round((result.data[di + 2] ?? 0) / w);
      result.data[di + 3] = Math.round((result.data[di + 3] ?? 0) / w);
    }
  }

  return result;
}

export function shouldTile(imageWidth: number, imageHeight: number, tileSize: number): boolean {
  if (tileSize <= 0) return false;
  const ratioW = imageWidth / tileSize;
  const ratioH = imageHeight / tileSize;
  return ratioW > 1 + SIGNIFICANCE_THRESHOLD || ratioH > 1 + SIGNIFICANCE_THRESHOLD;
}

export function prepareTileSource(
  source: ImageData,
  mask: Uint8Array,
  tile: TileRegion,
  contextMargin: number,
): { imageData: ImageData; mask: Uint8Array } {
  const sx = Math.max(0, tile.x - contextMargin);
  const sy = Math.max(0, tile.y - contextMargin);
  const sw = Math.min(source.width - sx, tile.w + contextMargin * 2);
  const sh = Math.min(source.height - sy, tile.h + contextMargin * 2);

  if (sw <= 0 || sh <= 0) {
    return { imageData: new ImageData(1, 1), mask: new Uint8Array(1) };
  }

  const resultImage = new ImageData(sw, sh);
  const resultMask = new Uint8Array(sw * sh);

  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const srcX = sx + x;
      const srcY = sy + y;

      const srcIdx = (srcY * source.width + srcX) * 4;
      const dstIdx = (y * sw + x) * 4;

      resultImage.data[dstIdx] = source.data[srcIdx] ?? 0;
      resultImage.data[dstIdx + 1] = source.data[srcIdx + 1] ?? 0;
      resultImage.data[dstIdx + 2] = source.data[srcIdx + 2] ?? 0;
      resultImage.data[dstIdx + 3] = source.data[srcIdx + 3] ?? 0;

      resultMask[y * sw + x] = mask[srcY * source.width + srcX] ?? 0;
    }
  }

  return { imageData: resultImage, mask: resultMask };
}
