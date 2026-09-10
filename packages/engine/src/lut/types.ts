/**
 * LUT (lookup-table) colour transform types.
 *
 * Supports 1D LUTs (per-channel curves), 3D LUTs (full RGB→RGB cross-talk),
 * and combined shaper+3D-LUT pipelines. Designed to integrate with the
 * existing nondestructive FilterIR adjustment pipeline.
 *
 * Research basis: Adobe .cube spec, Autodesk .3dl, DaVinci Resolve .cube
 * extensions, ACES CLF/CTF, OpenColorIO, GPU Gems 2 ch.24 (Selan).
 */

export type LutType = '1d' | '3d' | 'shaper3d';

export type LutInterpolation = 'nearest' | 'trilinear' | 'tetrahedral';

export type LutInputSpace =
  | 'sRGB'
  | 'linear'
  | 'rec709'
  | 'rec2020'
  | 'displayP3'
  | 'adobeRGB'
  | 'aces2065-1'
  | 'acescg'
  | 'acescct'
  | 'arriLogC3'
  | 'arriLogC4'
  | 'sonySLog3'
  | 'redLog3G10'
  | 'panasonicVLog'
  | 'canonCLog2'
  | 'canonCLog3'
  | 'nconlog'
  | 'davinciWideGamut'
  | 'custom';

export type LutExportDomain = 'extend' | 'clip' | 'mirror';

export interface LutMetadata {
  title?: string;
  author?: string;
  description?: string;
  copyright?: string;
  /** Original source format, e.g. 'cube', '3dl' */
  sourceFormat?: string;
  /** UUID or stable content hash for asset tracking */
  assetId?: string;
  /** When embedded in a Document, the serialized original for round-trip fidelity */
  originalData?: string;
}

export interface Lut1D {
  kind: '1d';
  /** Size per channel (number of entries in each R/G/B curve) */
  size: number;
  /** Per-channel curves as Float64Array of length `size`. Domain [0, 1]. */
  r: Float64Array;
  g: Float64Array;
  b: Float64Array;
  /** Input domain minimum (default [0,0,0]) */
  inputMin: [number, number, number];
  /** Input domain maximum (default [1,1,1]) */
  inputMax: [number, number, number];
  metadata: LutMetadata;
}

export interface Lut3D {
  kind: '3d';
  /** Grid size per axis. Total entries = size^3 */
  size: number;
  /**
   * Flat Float64Array of length size^3 * 3.
   * Order: R varies fastest, then G, then B.
   * For grid position (r,g,b), index = ((b * size + g) * size + r) * 3
   */
  data: Float64Array;
  /** Input domain minimum (default [0,0,0]) */
  inputMin: [number, number, number];
  /** Input domain maximum (default [1,1,1]) */
  inputMax: [number, number, number];
  metadata: LutMetadata;
}

export interface Shaper3D {
  kind: 'shaper3d';
  /** Shaper is a 1D LUT applied before the 3D LUT */
  shaper: Lut1D;
  /** The 3D LUT */
  lut3d: Lut3D;
  metadata: LutMetadata;
}

export type LutTransform = Lut1D | Lut3D | Shaper3D;

export interface LutAdjustmentParams {
  /** The embedded or resolved LUT transform */
  transform: LutTransform;
  /** Assumed input colour space */
  inputSpace: LutInputSpace;
  /** Output colour space (typically sRGB or the document colour space) */
  outputSpace?: LutInputSpace;
  /** Interpolation method */
  interpolation: LutInterpolation;
  /** Mix amount (0..1, default 1) */
  intensity: number;
  /** Whether to apply in linear light (default false — apply directly) */
  linearize: boolean;
}

export const DEFAULT_LUT_INTERPOLATION: LutInterpolation = 'tetrahedral';

export const LUT_SUPPORTED_EXTENSIONS = ['cube', '3dl'] as const;

export const LUT_FORMAT_LABELS: Record<string, string> = {
  cube: 'Adobe Cube LUT',
  '3dl': 'Autodesk 3D LUT',
};

export const LUT_INPUT_SPACE_LABELS: Record<LutInputSpace, string> = {
  sRGB: 'sRGB (IEC 61966-2-1)',
  linear: 'Linear sRGB',
  rec709: 'Rec. 709',
  rec2020: 'Rec. 2020',
  displayP3: 'Display P3',
  adobeRGB: 'Adobe RGB (1998)',
  'aces2065-1': 'ACES 2065-1 (AP0)',
  acescg: 'ACEScg (AP1)',
  acescct: 'ACEScct',
  arriLogC3: 'ARRI LogC3',
  arriLogC4: 'ARRI LogC4',
  sonySLog3: 'Sony S-Log3',
  redLog3G10: 'RED Log3G10',
  panasonicVLog: 'Panasonic V-Log',
  canonCLog2: 'Canon C-Log 2',
  canonCLog3: 'Canon C-Log 3',
  nconlog: 'Nikon N-Log',
  davinciWideGamut: 'DaVinci Wide Gamut',
  custom: 'Custom / Unknown',
};

export function lutFormatSupports(extension: string): 'full' | 'limitations' | 'unsupported' {
  switch (extension.toLowerCase()) {
    case 'cube':
      return 'full';
    case '3dl':
      return 'limitations';
    default:
      return 'unsupported';
  }
}

export function makeIdentityLut3D(size: number, metadata?: LutMetadata): Lut3D {
  const count = size * size * size;
  const data = new Float64Array(count * 3);
  const step = 1.0 / (size - 1);
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const idx = ((b * size + g) * size + r) * 3;
        data[idx] = r * step;
        data[idx + 1] = g * step;
        data[idx + 2] = b * step;
      }
    }
  }
  return {
    kind: '3d',
    size,
    data,
    inputMin: [0, 0, 0],
    inputMax: [1, 1, 1],
    metadata: metadata ?? {},
  };
}

export function makeIdentityLut1D(size: number, metadata?: LutMetadata): Lut1D {
  const r = new Float64Array(size);
  const g = new Float64Array(size);
  const b = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const v = i / (size - 1);
    r[i] = v;
    g[i] = v;
    b[i] = v;
  }
  return {
    kind: '1d',
    size,
    r,
    g,
    b,
    inputMin: [0, 0, 0],
    inputMax: [1, 1, 1],
    metadata: metadata ?? {},
  };
}
