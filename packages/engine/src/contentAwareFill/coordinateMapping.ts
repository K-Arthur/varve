import type { FillTransform } from './types';

export function applyFillTransform(imageData: ImageData, transform: FillTransform): ImageData {
  let { data, width, height } = imageData;

  if (transform.flipH || transform.flipV) {
    const flipped = new ImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const sx = transform.flipH ? width - 1 - x : x;
        const sy = transform.flipV ? height - 1 - y : y;
        const si = (sy * width + sx) * 4;
        const di = (y * width + x) * 4;
        flipped.data[di] = data[si]!;
        flipped.data[di + 1] = data[si + 1]!;
        flipped.data[di + 2] = data[si + 2]!;
        flipped.data[di + 3] = data[si + 3]!;
      }
    }
    data = flipped.data;
  }

  if (transform.crop) {
    const { x: cx, y: cy, w: cw, h: ch } = transform.crop;
    const cropped = new ImageData(cw, ch);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const si = ((cy + y) * width + (cx + x)) * 4;
        const di = (y * cw + x) * 4;
        cropped.data[di] = data[si]!;
        cropped.data[di + 1] = data[si + 1]!;
        cropped.data[di + 2] = data[si + 2]!;
        cropped.data[di + 3] = data[si + 3]!;
      }
    }
    return cropped;
  }

  return new ImageData(new Uint8ClampedArray(data), width, height);
}

export function mapMaskThroughTransform(
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  transform: FillTransform,
): { mask: Uint8Array; width: number; height: number; offsetX: number; offsetY: number } {
  let result = mask;
  const w = maskWidth;
  const h = maskHeight;
  let ox = 0;
  let oy = 0;

  if (transform.crop) {
    ox = transform.crop.x;
    oy = transform.crop.y;
  }

  if (transform.flipH || transform.flipV) {
    const flipped = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = transform.flipH ? w - 1 - x : x;
        const sy = transform.flipV ? h - 1 - y : y;
        flipped[y * w + x] = result[sy * w + sx] ?? 0;
      }
    }
    result = flipped;
  }

  return { mask: result, width: w, height: h, offsetX: ox, offsetY: oy };
}

export function unmapFillResult(
  filledRegion: ImageData,
  transform: FillTransform,
  _fillOffsetX: number,
  _fillOffsetY: number,
  _naturalWidth: number,
  _naturalHeight: number,
): ImageData {
  let result = filledRegion;
  if (transform.crop) {
    // offset adjusted by crop origin
  }

  if (transform.flipH || transform.flipV) {
    const flipped = new ImageData(result.width, result.height);
    for (let y = 0; y < result.height; y++) {
      for (let x = 0; x < result.width; x++) {
        const sx = transform.flipH ? result.width - 1 - x : x;
        const sy = transform.flipV ? result.height - 1 - y : y;
        const si = (sy * result.width + sx) * 4;
        const di = (y * result.width + x) * 4;
        flipped.data[di] = result.data[si]!;
        flipped.data[di + 1] = result.data[si + 1]!;
        flipped.data[di + 2] = result.data[si + 2]!;
        flipped.data[di + 3] = result.data[si + 3]!;
      }
    }
    result = flipped;
  }

  return result;
}

export function computeFillOffset(
  maskOffsetX: number,
  maskOffsetY: number,
  contextOffsetX: number,
  contextOffsetY: number,
): { x: number; y: number } {
  return {
    x: contextOffsetX + maskOffsetX,
    y: contextOffsetY + maskOffsetY,
  };
}
