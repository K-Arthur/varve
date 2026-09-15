/**
 * DTCG specification-version registry (2025.10 family).
 *
 * The 2025.10 family is the authoritative implementation baseline:
 * - "Design Tokens Format Module 2025.10" — Draft Community Group Report
 * - "Design Tokens Color Module 2025.10" — Final Community Group Report
 * - "Design Tokens Resolver Module 2025.10" — Community Group Report
 *
 * None of these are W3C Recommendations; none are on the W3C Standards
 * Track. Varve must never label them otherwise (ADR-0100 standards policy).
 *
 * Future draft support is gated behind an experimental adapter and must
 * never silently alter stable serialization.
 */
import type { TokenTypeKind } from './types';

export type DtcgSpecificationVersion = '2025.10';

export const STABLE_DTCG_SPECIFICATION_VERSION: DtcgSpecificationVersion = '2025.10';

export interface DtcgCapabilities {
  version: DtcgSpecificationVersion;
  supportsFormatModule: boolean;
  supportsColorModule: boolean;
  supportsResolverModule: boolean;
  supportedTokenTypes: ReadonlySet<TokenTypeKind>;
  supportedReferenceForms: ReadonlySet<'curly-brace' | 'json-pointer'>;
  supportedColorSpaces: ReadonlySet<string>;
}

const STABLE_TOKEN_TYPES: readonly TokenTypeKind[] = [
  'color',
  'dimension',
  'number',
  'duration',
  'cubicBezier',
  'fontFamily',
  'fontWeight',
  'strokeStyle',
  'border',
  'transition',
  'shadow',
  'gradient',
  'typography',
];

/** Color spaces per the Color module 2025.10, section 4.2. */
const STABLE_COLOR_SPACES = [
  'srgb',
  'srgb-linear',
  'hsl',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'display-p3',
  'a98-rgb',
  'prophoto-rgb',
  'rec2020',
  'xyz-d65',
  'xyz-d50',
] as const;

export function dtcgCapabilities(
  version: DtcgSpecificationVersion = STABLE_DTCG_SPECIFICATION_VERSION,
): DtcgCapabilities {
  switch (version) {
    case '2025.10':
      return {
        version,
        supportsFormatModule: true,
        supportsColorModule: true,
        supportsResolverModule: true,
        supportedTokenTypes: new Set(STABLE_TOKEN_TYPES),
        supportedReferenceForms: new Set(['curly-brace', 'json-pointer']),
        supportedColorSpaces: new Set(STABLE_COLOR_SPACES),
      };
  }
}

export function isStableTokenType(type: string): type is TokenTypeKind {
  return (STABLE_TOKEN_TYPES as readonly string[]).includes(type);
}

export function isStableColorSpace(colorSpace: string): boolean {
  return (STABLE_COLOR_SPACES as readonly string[]).includes(colorSpace);
}

/** Component cardinality and range policy per color space (Color module 4.2). */
export interface ColorSpaceSpec {
  name: string;
  componentCount: number;
  /** [min, max] per component; unbounded endpoints are Infinity.
   * maxExclusive marks exclusive maxima (e.g. hue [0, 360)). */
  ranges: ReadonlyArray<{ min: number; max: number; maxExclusive: boolean }>;
  allowsNone: boolean;
}

const rgbRanges = (): ReadonlyArray<{ min: number; max: number; maxExclusive: boolean }> => [
  { min: 0, max: 1, maxExclusive: false },
  { min: 0, max: 1, maxExclusive: false },
  { min: 0, max: 1, maxExclusive: false },
];

const polarHueRanges = (): ReadonlyArray<{ min: number; max: number; maxExclusive: boolean }> => [
  { min: 0, max: 360, maxExclusive: true },
  { min: 0, max: 100, maxExclusive: false },
  { min: 0, max: 100, maxExclusive: false },
];

const labRanges = (): ReadonlyArray<{ min: number; max: number; maxExclusive: boolean }> => [
  { min: 0, max: 100, maxExclusive: false },
  { min: -Infinity, max: Infinity, maxExclusive: false },
  { min: -Infinity, max: Infinity, maxExclusive: false },
];

const lchRanges = (): ReadonlyArray<{ min: number; max: number; maxExclusive: boolean }> => [
  { min: 0, max: 100, maxExclusive: false },
  { min: 0, max: Infinity, maxExclusive: false },
  { min: 0, max: 360, maxExclusive: true },
];

const oklabRanges = (): ReadonlyArray<{ min: number; max: number; maxExclusive: boolean }> => [
  { min: 0, max: 1, maxExclusive: false },
  { min: -Infinity, max: Infinity, maxExclusive: false },
  { min: -Infinity, max: Infinity, maxExclusive: false },
];

const oklchRanges = (): ReadonlyArray<{ min: number; max: number; maxExclusive: boolean }> => [
  { min: 0, max: 1, maxExclusive: false },
  { min: 0, max: Infinity, maxExclusive: false },
  { min: 0, max: 360, maxExclusive: true },
];

export const COLOR_SPACE_SPECS: Readonly<Record<string, ColorSpaceSpec>> = {
  srgb: { name: 'srgb', componentCount: 3, ranges: rgbRanges(), allowsNone: true },
  'srgb-linear': { name: 'srgb-linear', componentCount: 3, ranges: rgbRanges(), allowsNone: true },
  hsl: { name: 'hsl', componentCount: 3, ranges: polarHueRanges(), allowsNone: true },
  hwb: { name: 'hwb', componentCount: 3, ranges: polarHueRanges(), allowsNone: true },
  lab: { name: 'lab', componentCount: 3, ranges: labRanges(), allowsNone: true },
  lch: { name: 'lch', componentCount: 3, ranges: lchRanges(), allowsNone: true },
  oklab: { name: 'oklab', componentCount: 3, ranges: oklabRanges(), allowsNone: true },
  oklch: { name: 'oklch', componentCount: 3, ranges: oklchRanges(), allowsNone: true },
  'display-p3': { name: 'display-p3', componentCount: 3, ranges: rgbRanges(), allowsNone: true },
  'a98-rgb': { name: 'a98-rgb', componentCount: 3, ranges: rgbRanges(), allowsNone: true },
  'prophoto-rgb': {
    name: 'prophoto-rgb',
    componentCount: 3,
    ranges: rgbRanges(),
    allowsNone: true,
  },
  rec2020: { name: 'rec2020', componentCount: 3, ranges: rgbRanges(), allowsNone: true },
  'xyz-d65': { name: 'xyz-d65', componentCount: 3, ranges: rgbRanges(), allowsNone: true },
  'xyz-d50': { name: 'xyz-d50', componentCount: 3, ranges: rgbRanges(), allowsNone: true },
};
