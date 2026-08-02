import type { BitDepth, ColorMode } from '@strata/scene';
import { useMemo } from 'react';

export interface GamutWarningProps {
  r: number;
  g: number;
  b: number;
  /** Current color bit depth — used to warn about precision loss. */
  bitDepth?: BitDepth;
  /** Document color mode — when set, show gamut warnings relative to this mode. */
  documentColorMode?: ColorMode;
}

/**
 * Check whether an RGB colour falls outside the CMYK gamut.
 *
 * Uses a perceptual heuristic: colours with very high saturation AND very
 * high brightness that are NOT pure CMYK process colours are flagged.
 * Pure process colours (cyan, magenta, yellow) have at least one channel
 * at 0 AND at least one at 255 — they are the CMYK primaries and are
 * always in gamut.
 *
 * This replaces the previous naive heuristic (saturation > 85 && value > 15)
 * which falsely flagged pure process colours, and the round-trip approach
 * which couldn't detect gamut issues because the naive CMYK conversion
 * always round-trips perfectly.
 */
function isOutsideCmykGamut(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return false;

  const saturation = ((max - min) / max) * 100;
  const value = (max / 255) * 100;

  // The six CMYK-safe colours: pure primaries, black, and white.
  // These are always representable in CMYK regardless of brightness/saturation.
  const isCmykPrimary =
    (r === 0 && g === 255 && b === 255) || // cyan
    (r === 255 && g === 0 && b === 255) || // magenta
    (r === 255 && g === 255 && b === 0) || // yellow
    (r === 0 && g === 0 && b === 0) || // black
    (r === 255 && g === 255 && b === 255); // white
  if (isCmykPrimary) return false;

  // Very dark colours are always in gamut
  if (value < 15) return false;

  // Low saturation colours are always in gamut
  if (saturation < 50) return false;

  // High saturation + high brightness = likely out of CMYK gamut.
  // The threshold of 90% catches neon greens, electric blues, and similar
  // colours that CMYK ink on paper cannot reproduce.
  return saturation > 90 && value > 90;
}

/** Precision ordering — higher index = more precision. */
const BIT_DEPTH_PRECISION: Record<string, number> = {
  uint8: 0,
  uint16: 1,
  float16: 2,
  float32: 3,
};

/**
 * Check whether the color's bit depth exceeds what the target mode can
 * preserve. Returns true if saving in the target mode would lose precision.
 */
function hasPrecisionLoss(
  colorBitDepth: BitDepth | undefined,
  targetMode: ColorMode | undefined,
): boolean {
  if (!colorBitDepth || !targetMode) return false;
  // CMYK documents default to uint8; high-precision values would be truncated
  const targetPrecision = targetMode === 'cmyk' ? 0 : (BIT_DEPTH_PRECISION[colorBitDepth] ?? 0);
  const colorPrecision = BIT_DEPTH_PRECISION[colorBitDepth] ?? 0;
  return colorPrecision > targetPrecision;
}
export function GamutWarning({ r, g, b, bitDepth, documentColorMode }: GamutWarningProps) {
  const outOfGamut = useMemo(() => isOutsideCmykGamut(r, g, b), [r, g, b]);
  const precisionLoss = useMemo(
    () => hasPrecisionLoss(bitDepth, documentColorMode),
    [bitDepth, documentColorMode],
  );

  if (!outOfGamut && !precisionLoss) return null;

  const message = precisionLoss
    ? `Precision loss: ${bitDepth} exceeds document target`
    : 'Out of CMYK gamut';
  return (
    <div className="gamut-warning" role="status" aria-live="polite">
      <span aria-hidden className="gamut-warning__icon">
        !
      </span>
      <span>{message}</span>
    </div>
  );
}
