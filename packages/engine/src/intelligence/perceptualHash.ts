/**
 * Perceptual hashing for visual similarity search.
 *
 * All operations are deterministic image analysis (not ML).
 * No models, no network, no downloads.
 *
 * Research basis: pHash (DCT-based perceptual hash),
 * dHash (gradient-based difference hash).
 */

/**
 * Compute a difference hash (dHash) for an image.
 * dHash is a fast, scale-invariant perceptual hash.
 * Returns a hex string hash of the given bit length.
 */
export function dHash(
  imageData: ImageData,
  bits = 64,
): string {
  const size = Math.ceil(Math.sqrt(bits));
  const small = resizeToGrayscale(imageData, size + 1, size);

  const hash: number[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const left = small[y * (size + 1) + x]!;
      const right = small[y * (size + 1) + x + 1]!;
      hash.push(left > right ? 1 : 0);
    }
  }

  return bitsToHex(hash, bits);
}

/**
 * Compute a perceptual hash (pHash) using DCT.
 * More robust than dHash but slower.
 * Returns a hex string hash of the given bit length.
 */
export function pHash(
  imageData: ImageData,
  bits = 64,
): string {
  const size = 32;
  const gray = resizeToGrayscale(imageData, size, size);
  const dct = computeDCT(gray, size);

  // Extract top-left (bits) DCT coefficients (low frequencies)
  const dctSize = Math.ceil(Math.sqrt(bits));
  const coefficients: number[] = [];
  for (let y = 0; y < dctSize; y++) {
    for (let x = 0; x < dctSize; x++) {
      coefficients.push(dct[y * size + x]!);
    }
  }

  const median = computeMedian(coefficients);
  const hash = coefficients.map((c) => (c > median ? 1 : 0));

  return bitsToHex(hash, bits);
}

/**
 * Compute Hamming distance between two hex hash strings.
 * Returns the number of differing bits.
 */
export function hammingDistance(hashA: string, hashB: string): number {
  const maxLen = Math.max(hashA.length, hashB.length);
  let distance = 0;

  for (let i = 0; i < maxLen; i++) {
    const a = Number.parseInt(hashA[i] ?? '0', 16);
    const b = Number.parseInt(hashB[i] ?? '0', 16);
    let xor = a ^ b;
    while (xor > 0) {
      distance += xor & 1;
      xor >>= 1;
    }
  }

  return distance;
}

/**
 * Rank images by similarity to a query hash.
 * Returns an array of { id, distance } sorted by increasing distance.
 */
export function rankBySimilarity(
  queryHash: string,
  hashes: Array<{ id: string; hash: string }>,
): Array<{ id: string; distance: number }> {
  return hashes
    .map((h) => ({ id: h.id, distance: hammingDistance(queryHash, h.hash) }))
    .sort((a, b) => a.distance - b.distance);
}

// ── Helpers ────────────────────────────────────────────────

function resizeToGrayscale(
  imageData: ImageData,
  targetW: number,
  targetH: number,
): Float64Array {
  const { data, width, height } = imageData;
  const result = new Float64Array(targetW * targetH);

  const xRatio = width / targetW;
  const yRatio = height / targetH;

  for (let ty = 0; ty < targetH; ty++) {
    for (let tx = 0; tx < targetW; tx++) {
      const sx = Math.min(Math.floor(tx * xRatio), width - 1);
      const sy = Math.min(Math.floor(ty * yRatio), height - 1);
      const srcIdx = (sy * width + sx) * 4;
      // BT.601 luma
      const gray =
        0.299 * data[srcIdx]! + 0.587 * data[srcIdx + 1]! + 0.114 * data[srcIdx + 2]!;
      result[ty * targetW + tx] = gray;
    }
  }

  return result;
}

function computeDCT(data: Float64Array, size: number): Float64Array {
  const result = new Float64Array(size * size);
  const PI = Math.PI;

  for (let u = 0; u < size; u++) {
    for (let v = 0; v < size; v++) {
      let sum = 0;
      for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
          const cosX = Math.cos(((2 * x + 1) * u * PI) / (2 * size));
          const cosY = Math.cos(((2 * y + 1) * v * PI) / (2 * size));
          sum += data[y * size + x]! * cosX * cosY;
        }
      }
      const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
      const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
      result[v * size + u] = (2 / size) * cu * cv * sum;
    }
  }

  return result;
}

function computeMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function bitsToHex(bits: number[], count: number): string {
  const hex: string[] = [];
  for (let i = 0; i < count; i += 4) {
    let nibble = 0;
    for (let j = 0; j < 4; j++) {
      if (i + j < bits.length) {
        nibble = (nibble << 1) | (bits[i + j] ?? 0);
      }
    }
    hex.push(nibble.toString(16));
  }
  return hex.join('');
}
