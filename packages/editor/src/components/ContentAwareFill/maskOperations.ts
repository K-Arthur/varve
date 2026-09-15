/**
 * Pixel-space operations for the generative edit mask.
 *
 * These stay outside the dialog component so the mask contract is testable
 * without a browser and so the controls cannot accidentally mutate the
 * source-image buffer used by a running job.
 */

export interface MaskDimensions {
  width: number;
  height: number;
}

export interface MaskPoint {
  x: number;
  y: number;
}

function validDimensions({ width, height }: MaskDimensions): boolean {
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0 &&
    width * height <= 16_777_216
  );
}

/**
 * A source mask may be larger than the bounded interactive preview. Resizing
 * samples it directly and does not allocate another source-sized buffer, so
 * the preview allocation limit must not reject an otherwise valid source
 * mask. The exact typed-array length check below remains the memory boundary.
 */
function validSourceDimensions({ width, height }: MaskDimensions): boolean {
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0 &&
    Number.isSafeInteger(width * height)
  );
}

function distanceSquaredToSegment(point: MaskPoint, start: MaskPoint, end: MaskPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= Number.EPSILON) {
    const offsetX = point.x - start.x;
    const offsetY = point.y - start.y;
    return offsetX * offsetX + offsetY * offsetY;
  }
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  const nearestX = start.x + t * dx;
  const nearestY = start.y + t * dy;
  const offsetX = point.x - nearestX;
  const offsetY = point.y - nearestY;
  return offsetX * offsetX + offsetY * offsetY;
}

/**
 * Rasterize one hard brush dab or the continuous segment between two pointer
 * samples. Pointer events are allowed to be coalesced by the browser, so a
 * UI that only paints at event coordinates can silently turn a fast drag into
 * two unrelated dots and send the wrong edit region to inference.
 */
export function rasterizeMaskStroke(
  dimensions: MaskDimensions,
  start: MaskPoint | null,
  end: MaskPoint,
  brushRadius: number,
): Uint8Array {
  if (!validDimensions(dimensions)) throw new Error('Generative mask dimensions are invalid');
  if (
    !Number.isFinite(end.x) ||
    !Number.isFinite(end.y) ||
    (start && (!Number.isFinite(start.x) || !Number.isFinite(start.y)))
  ) {
    throw new Error('Generative mask coordinates are invalid');
  }
  if (!Number.isFinite(brushRadius) || brushRadius <= 0) {
    throw new Error('Generative brush radius is invalid');
  }

  const { width, height } = dimensions;
  const clampedEnd = {
    x: Math.max(0, Math.min(width - 1, end.x)),
    y: Math.max(0, Math.min(height - 1, end.y)),
  };
  const clampedStart = start
    ? {
        x: Math.max(0, Math.min(width - 1, start.x)),
        y: Math.max(0, Math.min(height - 1, start.y)),
      }
    : clampedEnd;
  const radius = Math.max(0.5, brushRadius);
  const coverage = new Uint8Array(width * height);
  const minX = Math.max(0, Math.floor(Math.min(clampedStart.x, clampedEnd.x) - radius));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(clampedStart.x, clampedEnd.x) + radius));
  const minY = Math.max(0, Math.floor(Math.min(clampedStart.y, clampedEnd.y) - radius));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(clampedStart.y, clampedEnd.y) + radius));
  const radiusSquared = radius * radius;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (
        distanceSquaredToSegment({ x: x + 0.5, y: y + 0.5 }, clampedStart, clampedEnd) <=
        radiusSquared
      ) {
        coverage[y * width + x] = 255;
      }
    }
  }
  return coverage;
}

function maxFilterRows(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius === 0) return mask.slice();
  const result = new Uint8Array(mask.length);
  const deque = new Int32Array(width);

  for (let y = 0; y < height; y += 1) {
    let head = 0;
    let tail = 0;
    const add = (x: number) => {
      const value = mask[y * width + x]!;
      while (tail > head && mask[y * width + deque[tail - 1]!]! <= value) tail -= 1;
      deque[tail++] = x;
    };
    for (let x = 0; x <= Math.min(width - 1, radius); x += 1) add(x);
    for (let x = 0; x < width; x += 1) {
      if (x > 0 && x + radius < width) add(x + radius);
      const left = x - radius;
      while (tail > head && deque[head]! < left) head += 1;
      result[y * width + x] = head < tail ? mask[y * width + deque[head]!]! : mask[y * width + x]!;
    }
  }
  return result;
}

function maxFilterColumns(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius === 0) return mask.slice();
  const result = new Uint8Array(mask.length);
  const deque = new Int32Array(height);

  for (let x = 0; x < width; x += 1) {
    let head = 0;
    let tail = 0;
    const add = (y: number) => {
      const value = mask[y * width + x]!;
      while (tail > head && mask[deque[tail - 1]! * width + x]! <= value) tail -= 1;
      deque[tail++] = y;
    };
    for (let y = 0; y <= Math.min(height - 1, radius); y += 1) add(y);
    for (let y = 0; y < height; y += 1) {
      if (y > 0 && y + radius < height) add(y + radius);
      const top = y - radius;
      while (tail > head && deque[head]! < top) head += 1;
      result[y * width + x] = head < tail ? mask[deque[head]! * width + x]! : mask[y * width + x]!;
    }
  }
  return result;
}

function minFilterRows(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius === 0) return mask.slice();
  const result = new Uint8Array(mask.length);
  const deque = new Int32Array(width);

  for (let y = 0; y < height; y += 1) {
    let head = 0;
    let tail = 0;
    const add = (x: number) => {
      const value = mask[y * width + x]!;
      while (tail > head && mask[y * width + deque[tail - 1]!]! >= value) tail -= 1;
      deque[tail++] = x;
    };
    for (let x = 0; x <= Math.min(width - 1, radius); x += 1) add(x);
    for (let x = 0; x < width; x += 1) {
      if (x < radius || x + radius >= width) {
        result[y * width + x] = 0;
        continue;
      }
      if (x > 0 && x + radius < width) add(x + radius);
      const left = x - radius;
      while (tail > head && deque[head]! < left) head += 1;
      result[y * width + x] = head < tail ? mask[y * width + deque[head]!]! : mask[y * width + x]!;
    }
  }
  return result;
}

function minFilterColumns(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius === 0) return mask.slice();
  const result = new Uint8Array(mask.length);
  const deque = new Int32Array(height);

  for (let x = 0; x < width; x += 1) {
    let head = 0;
    let tail = 0;
    const add = (y: number) => {
      const value = mask[y * width + x]!;
      while (tail > head && mask[deque[tail - 1]! * width + x]! >= value) tail -= 1;
      deque[tail++] = y;
    };
    for (let y = 0; y <= Math.min(height - 1, radius); y += 1) add(y);
    for (let y = 0; y < height; y += 1) {
      if (y < radius || y + radius >= height) {
        result[y * width + x] = 0;
        continue;
      }
      if (y > 0 && y + radius < height) add(y + radius);
      const top = y - radius;
      while (tail > head && deque[head]! < top) head += 1;
      result[y * width + x] = head < tail ? mask[deque[head]! * width + x]! : mask[y * width + x]!;
    }
  }
  return result;
}

function blurRows(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    let left = 0;
    let right = Math.min(width - 1, radius);
    for (let x = left; x <= right; x += 1) sum += mask[y * width + x]!;
    for (let x = 0; x < width; x += 1) {
      result[y * width + x] = Math.round(sum / (right - left + 1));
      const leaving = x - radius;
      const entering = x + radius + 1;
      if (leaving >= 0) {
        sum -= mask[y * width + leaving]!;
        left = leaving + 1;
      }
      if (entering < width) {
        sum += mask[y * width + entering]!;
        right = entering;
      }
    }
  }
  return result;
}

function blurColumns(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const result = new Uint8Array(mask.length);
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    let top = 0;
    let bottom = Math.min(height - 1, radius);
    for (let y = top; y <= bottom; y += 1) sum += mask[y * width + x]!;
    for (let y = 0; y < height; y += 1) {
      result[y * width + x] = Math.round(sum / (bottom - top + 1));
      const leaving = y - radius;
      const entering = y + radius + 1;
      if (leaving >= 0) {
        sum -= mask[leaving * width + x]!;
        top = leaving + 1;
      }
      if (entering < height) {
        sum += mask[entering * width + x]!;
        bottom = entering;
      }
    }
  }
  return result;
}

/** Return a detached mask with expansion and feathering applied in pixels. */
export function refineGenerativeMask(
  mask: Uint8Array,
  dimensions: MaskDimensions,
  options: { expansion?: number; feather?: number } = {},
): Uint8Array {
  if (!validDimensions(dimensions) || mask.length !== dimensions.width * dimensions.height) {
    throw new Error('Generative mask dimensions are invalid');
  }
  const expansion = Math.max(-64, Math.min(64, Math.round(options.expansion ?? 0)));
  const feather = Math.max(0, Math.min(64, Math.round(options.feather ?? 0)));
  let refined = mask.slice() as Uint8Array;
  if (expansion > 0) {
    refined = maxFilterColumns(
      maxFilterRows(refined, dimensions.width, dimensions.height, expansion),
      dimensions.width,
      dimensions.height,
      expansion,
    );
  } else if (expansion < 0) {
    const radius = Math.abs(expansion);
    refined = minFilterColumns(
      minFilterRows(refined, dimensions.width, dimensions.height, radius),
      dimensions.width,
      dimensions.height,
      radius,
    );
  }
  if (feather > 0) {
    refined = blurColumns(
      blurRows(refined, dimensions.width, dimensions.height, feather),
      dimensions.width,
      dimensions.height,
      feather,
    );
  }
  return refined;
}

export type MaskCombineOperation = 'replace' | 'add' | 'subtract' | 'intersect';

/** Combine two aligned soft masks without destroying fractional coverage. */
export function combineMaskCoverage(
  current: Uint8Array,
  incoming: Uint8Array,
  operation: MaskCombineOperation,
): Uint8Array {
  if (current.length !== incoming.length) throw new Error('Mask dimensions are invalid');
  const result = new Uint8Array(current.length);
  for (let index = 0; index < result.length; index += 1) {
    const left = current[index]!;
    const right = incoming[index]!;
    result[index] =
      operation === 'replace'
        ? right
        : operation === 'add'
          ? Math.max(left, right)
          : operation === 'subtract'
            ? Math.round((left * (255 - right)) / 255)
            : Math.min(left, right);
  }
  return result;
}

/** Read the coverage channel used by both selection masks and RGBA PNG masks. */
export function maskCoverageFromRgba(data: Uint8ClampedArray): Uint8Array {
  if (data.length % 4 !== 0) throw new Error('RGBA mask data is invalid');
  let hasTransparentAlpha = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) {
      hasTransparentAlpha = true;
      break;
    }
  }
  const coverage = new Uint8Array(data.length / 4);
  for (let i = 0, offset = 0; i < coverage.length; i += 1, offset += 4) {
    coverage[i] = hasTransparentAlpha ? data[offset + 3]! : data[offset]!;
  }
  return coverage;
}

/** Resize coverage with nearest-neighbour sampling when a legacy mask differs from the source. */
export function resizeMaskCoverage(
  coverage: Uint8Array,
  source: MaskDimensions,
  target: MaskDimensions,
): Uint8Array {
  if (
    !validSourceDimensions(source) ||
    !validDimensions(target) ||
    coverage.length !== source.width * source.height
  ) {
    throw new Error('Generative mask dimensions are invalid');
  }
  if (source.width === target.width && source.height === target.height) return coverage.slice();
  const resized = new Uint8Array(target.width * target.height);
  for (let y = 0; y < target.height; y += 1) {
    const sourceY = Math.min(source.height - 1, Math.floor((y * source.height) / target.height));
    for (let x = 0; x < target.width; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor((x * source.width) / target.width));
      resized[y * target.width + x] = coverage[sourceY * source.width + sourceX]!;
    }
  }
  return resized;
}

/** Put one-channel coverage into the opaque RGBA canvas used by the dialog. */
export function putMaskCoverage(
  context: CanvasRenderingContext2D,
  coverage: Uint8Array,
  dimensions: MaskDimensions,
): void {
  if (!validDimensions(dimensions) || coverage.length !== dimensions.width * dimensions.height) {
    throw new Error('Generative mask dimensions are invalid');
  }
  const imageData = context.createImageData(dimensions.width, dimensions.height);
  for (let i = 0, offset = 0; i < coverage.length; i += 1, offset += 4) {
    const value = coverage[i]!;
    imageData.data[offset] = value;
    imageData.data[offset + 1] = value;
    imageData.data[offset + 2] = value;
    imageData.data[offset + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
}
