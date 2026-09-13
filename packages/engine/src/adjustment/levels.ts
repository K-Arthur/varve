/**
 * Levels adjustment engine.
 *
 * Research basis: Photoshop Levels — maps input [black, white] to output
 * [black, white] with gamma correction in between. Each channel can have
 * independent settings; RGB mode applies the same curve to all channels.
 *
 * Architecture: compute a 256-entry LUT from input black/white/gamma/output
 * black/white parameters, then apply to image data.
 */

export interface LevelParams {
  inputBlack: number;
  inputWhite: number;
  gamma: number;
  outputBlack: number;
  outputWhite: number;
}

const DEFAULT_LEVELS: LevelParams = {
  inputBlack: 0,
  inputWhite: 255,
  gamma: 1,
  outputBlack: 0,
  outputWhite: 255,
};

export function buildLevelsLUT(params: Partial<LevelParams>): Uint8Array {
  const p = { ...DEFAULT_LEVELS, ...params };
  const lut = new Uint8Array(256);

  const inRange = Math.max(1, p.inputWhite - p.inputBlack);
  const outRange = p.outputWhite - p.outputBlack;

  for (let i = 0; i < 256; i++) {
    const normalized = Math.max(0, Math.min(1, (i - p.inputBlack) / inRange));
    const gammaCorrected = p.gamma !== 1 ? normalized ** (1 / Math.max(0.01, p.gamma)) : normalized;
    lut[i] = Math.round(p.outputBlack + gammaCorrected * outRange);
  }

  return lut;
}

export function applyLevels(
  imageData: ImageData,
  channel: 'rgb' | 'red' | 'green' | 'blue',
  params: Partial<LevelParams>,
): ImageData {
  const lut = buildLevelsLUT(params);
  const w = imageData.width;
  const h = imageData.height;
  const result = new ImageData(w, h);
  const src = imageData.data;
  const dst = result.data;

  for (let i = 0; i < w * h; i++) {
    const off = i * 4;
    const alpha = src[off + 3]!;
    dst[off + 3] = alpha;
    if (alpha === 0) {
      dst[off] = src[off]!;
      dst[off + 1] = src[off + 1]!;
      dst[off + 2] = src[off + 2]!;
      continue;
    }
    if (channel === 'rgb' || channel === 'red') dst[off] = lut[src[off]!]!;
    else dst[off] = src[off]!;
    if (channel === 'rgb' || channel === 'green') dst[off + 1] = lut[src[off + 1]!]!;
    else dst[off + 1] = src[off + 1]!;
    if (channel === 'rgb' || channel === 'blue') dst[off + 2] = lut[src[off + 2]!]!;
    else dst[off + 2] = src[off + 2]!;
  }

  return result;
}
