/**
 * DTCG color values → Varve value bridge (ADR-0106 D3, Color module 2025.10).
 *
 * The canonical token store keeps the DTCG color value (space, components,
 * alpha) untouched. `dtcgColorToManagedColor` projects float channels into
 * the existing managed-color renderer without clamping or byte quantization.
 * Missing components require an explicit interpolation context.
 * `dtcgColorToVarve` is the older, lossy hex-preview adapter; artwork bindings
 * use the managed projection. Display gamut conversion belongs to the renderer.
 */
import {
  labToXyz,
  lchToLab,
  linearToSrgb,
  linearToSrgbUnit,
  oklabToLinearSrgb,
  oklchToOkLab,
  rgbToHex,
  rgbToLab,
  srgbToLinear,
  xyzD50ToLinearRgbPrimaries,
  xyzD65ToLinearRgb,
} from '@varve/shared';
import { COLOR_SPACE_SPECS } from '@varve/tokens';
import type { ManagedColor } from '../colorManagement';

export interface DtcgColor {
  colorSpace: string;
  components: Array<number | 'none'>;
  alpha?: number;
  hex?: string;
}

/** Precise artwork projection; source channels stay authored in the token store. */
export function dtcgColorToManagedColor(color: DtcgColor): ManagedColor {
  if (!COLOR_SPACE_SPECS[color.colorSpace] || color.components.length !== 3) {
    throw new Error(`Unsupported color space or component count: ${color.colorSpace}`);
  }
  if (color.components.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error('Color components containing none need a color interpolation context.');
  }
  const alpha = color.alpha ?? 1;
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new Error('Color alpha cannot be bound outside the range 0 to 1.');
  }
  const values = color.components as [number, number, number];
  const profiles: Record<string, string> = {
    srgb: 'srgb',
    'display-p3': 'display-p3',
    'a98-rgb': 'adobe-rgb-1998',
    'prophoto-rgb': 'pro-photo-rgb',
    rec2020: 'rec2020',
  };
  const profile = profiles[color.colorSpace];
  if (profile) return floatRgb(values, alpha, profile);
  if (color.colorSpace === 'hsl') return floatRgb(hslChannels(values), alpha);
  if (color.colorSpace === 'hwb') return floatRgb(hwbChannels(values), alpha);
  const channels = linearColorChannels(color.colorSpace, values).map(linearToSrgbUnit) as [
    number,
    number,
    number,
  ];
  return floatRgb(channels, alpha);
}

function floatRgb(
  channels: [number, number, number],
  alpha: number,
  profile = 'srgb',
): ManagedColor {
  return {
    space: 'rgb',
    bitDepth: 'float32',
    profile,
    r: channels[0],
    g: channels[1],
    b: channels[2],
    a: alpha,
  };
}

function linearColorChannels(
  space: string,
  channels: [number, number, number],
): [number, number, number] {
  switch (space) {
    case 'srgb-linear':
      return channels;
    case 'lab':
      return xyzD65ToLinearRgb(labToXyz(channels));
    case 'lch':
      return xyzD65ToLinearRgb(labToXyz(lchToLab(channels)));
    case 'oklab':
      return oklabToLinearSrgb(channels);
    case 'oklch':
      return oklabToLinearSrgb(oklchToOkLab(channels));
    case 'xyz-d65':
      return xyzD65ToLinearRgb(channels);
    case 'xyz-d50': {
      const converted = xyzD50ToLinearRgbPrimaries('srgb', channels);
      if (!converted) throw new Error('The renderer cannot project XYZ D50 to sRGB.');
      return converted;
    }
    default:
      throw new Error(`No managed-color projection for ${space}`);
  }
}

function hslChannels([hue, saturation, lightness]: [number, number, number]): [
  number,
  number,
  number,
] {
  const h = (((hue % 360) + 360) % 360) / 30;
  const l = lightness / 100;
  const a = (saturation / 100) * Math.min(l, 1 - l);
  const channel = (offset: number) => {
    const k = (offset + h) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0), channel(8), channel(4)];
}

function hwbChannels([hue, white, black]: [number, number, number]): [number, number, number] {
  const w = white / 100;
  const b = black / 100;
  if (w + b >= 1) return [w / (w + b), w / (w + b), w / (w + b)];
  return hslChannels([hue, 100, 50]).map((value) => value * (1 - w - b) + w) as [
    number,
    number,
    number,
  ];
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

  const hex = rgbToHex(clamped[0], clamped[1], clamped[2]);

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
