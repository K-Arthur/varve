/**
 * DTCG color values → Varve value bridge (ADR-0106 D3, Color module 2025.10).
 *
 * The canonical token store keeps the DTCG color value (space, components,
 * alpha) untouched. This bridge produces the display/binding representation:
 * a `#rrggbb` hex string plus an alpha modifier for Varve's existing
 * binding-modifier system.
 *
 * Conversion policy:
 * - srgb → hex: exact (lossless).
 * - srgb-linear, oklab, lab, xyz-d65, display-p3 → sRGB with the documented
 *   matrices; out-of-gamut results are reported, never silently assumed.
 * - hsl, hwb, lch, oklch, a98-rgb, prophoto-rgb, rec2020, xyz-d50:
 *   NOT converted by default — the caller receives null plus a warning and
 *   must decide (display preview vs canonical storage vs explicit export
 *   conversion).
 */
import {
  clampChannel,
  labToXyz,
  linearToSrgb,
  oklabToLinearSrgb,
  rgbToLab,
  srgbToLinear,
  xyzD65ToLinearRgb,
} from '@varve/shared';
import { COLOR_SPACE_SPECS } from '@varve/tokens';

export interface DtcgColor {
  colorSpace: string;
  components: Array<number | 'none'>;
  alpha?: number;
  hex?: string;
}

export interface ColorBridgeResult {
  /** `#rrggbb` hex for sRGB display/binding. */
  hex: string;
  /** Alpha in [0,1] (defaults to 1). */
  alpha: number;
  /** True when the conversion changed gamut or missing components. */
  converted: boolean;
  warnings: string[];
}

/** Display P3 → linear sRGB matrix (CSS Color 4, sRGB primaries in XYZ D65). */
const DISPLAY_P3_TO_LINEAR_SRGB = [
  [1.224940056613497, -0.22494008061172388, 0],
  [-0.0420569547582385, 1.0420571328447457, 0],
  [-0.01963755421794399, -0.07863604816864979, 1.0982735983791192],
] as const;

function componentsToLinearSrgb(
  colorSpace: string,
  components: Array<number | 'none'>,
): [number, number, number] | null {
  const values = components.map((c) => (c === 'none' ? 0 : c)) as number[];
  switch (colorSpace) {
    case 'srgb':
      // shared's srgbToLinear expects 0-255; DTCG components are 0-1.
      return [
        srgbToLinear(values[0]! * 255),
        srgbToLinear(values[1]! * 255),
        srgbToLinear(values[2]! * 255),
      ];
    case 'srgb-linear':
      return [values[0]!, values[1]!, values[2]!];
    case 'display-p3': {
      const m = DISPLAY_P3_TO_LINEAR_SRGB;
      const [r, g, b] = values;
      return [
        m[0][0]! * r! + m[0][1]! * g! + m[0][2]! * b!,
        m[1][0]! * r! + m[1][1]! * g! + m[1][2]! * b!,
        m[2][0]! * r! + m[2][1]! * g! + m[2][2]! * b!,
      ];
    }
    case 'xyz-d65':
      return xyzD65ToLinearRgb([values[0]!, values[1]!, values[2]!]);
    case 'lab': {
      const xyz = labToXyz([values[0]!, values[1]!, values[2]!]);
      return xyzD65ToLinearRgb(xyz);
    }
    case 'oklab': {
      const linear = oklabToLinearSrgb([values[0]!, values[1]!, values[2]!]);
      return linear;
    }
    default:
      return null;
  }
}

export function dtcgColorToVarve(color: DtcgColor): ColorBridgeResult {
  const warnings: string[] = [];
  const spec = COLOR_SPACE_SPECS[color.colorSpace];
  if (!spec) {
    return {
      hex: color.hex ?? '#000000',
      alpha: color.alpha ?? 1,
      converted: false,
      warnings: [`Unsupported color space "${color.colorSpace}"; using provided hex fallback`],
    };
  }

  const alpha = color.alpha ?? 1;
  const hasNone = color.components.includes('none');
  if (hasNone) {
    warnings.push('Missing "none" components were treated as 0 for display');
  }
  const linear = componentsToLinearSrgb(color.colorSpace, color.components);

  if (!linear) {
    return {
      hex: color.hex ?? '#000000',
      alpha,
      converted: false,
      warnings: [
        ...warnings,
        `Color space "${color.colorSpace}" is not convertible to sRGB without an explicit conversion command; using provided hex fallback`,
      ],
    };
  }

  const [lr, lg, lb] = linear;
  // linearToSrgb returns 0-255 sRGB values (shared transfer convention).
  const srgb: [number, number, number] = [linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb)];
  const clamped = srgb.map((c) => Math.max(0, Math.min(255, c))) as [number, number, number];
  const outOfGamut = srgb.some((c, i) => Math.abs(c - clamped[i]!) > 1);
  if (outOfGamut) {
    warnings.push(
      `Color in "${color.colorSpace}" is out of sRGB gamut; display conversion clamps it`,
    );
  }

  const toHex = (c: number): string => clampChannel(c, 'uint8').toString(16).padStart(2, '0');
  const hex = `#${toHex(clamped[0])}${toHex(clamped[1])}${toHex(clamped[2])}`;

  return { hex, alpha, converted: color.colorSpace !== 'srgb', warnings };
}

/** Round-trip helper: srgb hex → DTCG color value. */
export function hexToDtcgColor(hex: string): DtcgColor {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) throw new Error(`Not a 6-digit hex color: ${hex}`);
  const r = parseInt(match[1]!.slice(0, 2), 16) / 255;
  const g = parseInt(match[1]!.slice(2, 4), 16) / 255;
  const b = parseInt(match[1]!.slice(4, 6), 16) / 255;
  return { colorSpace: 'srgb', components: [r, g, b] };
}

/** Delta-E (CIE76 on Lab) between two DTCG colors after display conversion. */
export function dtcgColorDeltaE(a: DtcgColor, b: DtcgColor): number | undefined {
  const av = dtcgColorToVarve(a);
  const bv = dtcgColorToVarve(b);
  const labA = rgbToLab(
    parseHexChannel(av.hex, 0) * 255,
    parseHexChannel(av.hex, 1) * 255,
    parseHexChannel(av.hex, 2) * 255,
  );
  const labB = rgbToLab(
    parseHexChannel(bv.hex, 0) * 255,
    parseHexChannel(bv.hex, 1) * 255,
    parseHexChannel(bv.hex, 2) * 255,
  );
  const dL = labA[0] - labB[0];
  const da = labA[1] - labB[1];
  const db = labA[2] - labB[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

function parseHexChannel(hex: string, index: number): number {
  return parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
}
