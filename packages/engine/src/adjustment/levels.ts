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

  const finiteClamp = (value: number, fallback: number): number =>
    Number.isFinite(value) ? Math.max(0, Math.min(255, value)) : fallback;
  const inputBlack = finiteClamp(p.inputBlack, DEFAULT_LEVELS.inputBlack);
  const inputWhite = finiteClamp(p.inputWhite, DEFAULT_LEVELS.inputWhite);
  const outputBlack = finiteClamp(p.outputBlack, DEFAULT_LEVELS.outputBlack);
  const outputWhite = finiteClamp(p.outputWhite, DEFAULT_LEVELS.outputWhite);
  const gamma = Number.isFinite(p.gamma) ? Math.max(0.01, Math.min(10, p.gamma)) : 1;

  // A collapsed or reversed input interval is still a valid edit. Normalize
  // it into a deterministic interval instead of allowing a negative range to
  // wrap through Uint8Array assignment or produce a hidden discontinuity.
  const inputLow = Math.min(inputBlack, inputWhite);
  const inputHigh = Math.max(inputBlack, inputWhite);
  const inRange = Math.max(1, inputHigh - inputLow);
  const outputLow = Math.min(outputBlack, outputWhite);
  const outputHigh = Math.max(outputBlack, outputWhite);
  const outRange = outputHigh - outputLow;

  for (let i = 0; i < 256; i++) {
    const normalized = Math.max(0, Math.min(1, (i - inputLow) / inRange));
    const gammaCorrected = gamma !== 1 ? normalized ** (1 / gamma) : normalized;
    lut[i] = Math.round(outputLow + gammaCorrected * outRange);
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
