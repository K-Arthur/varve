/**
 * Built-in gradient-map presets.
 *
 * Deterministic ids (`gpreset-builtin-<key>`) and stable content so built-in
 * presets never collide with imported presets and dedup on content hash works
 * across sessions. These are NOT stored in the user library — they are
 * composed in at read time (see `useGradientPresetLibrary`).
 */
import type { GradientPreset } from '@strata/scene';
import { makeGradientPreset } from '@strata/scene';

export const GRADIENT_BUILTIN_KEYS = [
  'black-white',
  'neon',
  'sunset',
  'ocean',
  'fire',
  'mint',
  'gold',
  'noir',
  'sepia',
  'duotone-blue',
  'duotone-red',
  'acid',
] as const;

export type GradientBuiltinKey = (typeof GRADIENT_BUILTIN_KEYS)[number];

interface BuiltinSpec {
  key: GradientBuiltinKey;
  name: string;
  stops: [number, [number, number, number, number]][];
  opacityStops?: [number, number][];
  smoothness?: number;
}

const BUILTIN_SPECS: BuiltinSpec[] = [
  {
    key: 'black-white',
    name: 'Black & White',
    stops: [
      [0, [0, 0, 0, 255]],
      [1, [255, 255, 255, 255]],
    ],
  },
  {
    key: 'neon',
    name: 'Neon Pulse',
    stops: [
      [0, [10, 10, 40, 255]],
      [0.4, [0, 255, 200, 255]],
      [0.7, [200, 0, 255, 255]],
      [1, [255, 50, 100, 255]],
    ],
  },
  {
    key: 'sunset',
    name: 'Sunset',
    stops: [
      [0, [20, 10, 60, 255]],
      [0.4, [120, 40, 100, 255]],
      [0.7, [255, 120, 50, 255]],
      [1, [255, 200, 100, 255]],
    ],
  },
  {
    key: 'ocean',
    name: 'Ocean Depth',
    stops: [
      [0, [5, 10, 60, 255]],
      [0.3, [10, 60, 120, 255]],
      [0.7, [30, 160, 180, 255]],
      [1, [200, 240, 240, 255]],
    ],
  },
  {
    key: 'fire',
    name: 'Fire & Ice',
    stops: [
      [0, [0, 0, 80, 255]],
      [0.3, [80, 0, 80, 255]],
      [0.6, [255, 60, 20, 255]],
      [1, [255, 220, 120, 255]],
    ],
  },
  {
    key: 'mint',
    name: 'Mint Frost',
    stops: [
      [0, [10, 60, 70, 255]],
      [1, [180, 255, 230, 255]],
    ],
  },
  {
    key: 'gold',
    name: 'Gold Rush',
    stops: [
      [0, [60, 30, 0, 255]],
      [0.5, [255, 190, 80, 255]],
      [1, [255, 245, 210, 255]],
    ],
  },
  {
    key: 'noir',
    name: 'Noir',
    stops: [
      [0, [10, 10, 12, 255]],
      [0.5, [110, 110, 118, 255]],
      [1, [245, 245, 248, 255]],
    ],
  },
  {
    key: 'sepia',
    name: 'Sepia Tone',
    stops: [
      [0, [25, 15, 8, 255]],
      [0.5, [120, 82, 48, 255]],
      [1, [245, 230, 200, 255]],
    ],
  },
  {
    key: 'duotone-blue',
    name: 'Duotone Blue',
    stops: [
      [0, [8, 12, 40, 255]],
      [1, [120, 200, 255, 255]],
    ],
  },
  {
    key: 'duotone-red',
    name: 'Duotone Red',
    stops: [
      [0, [45, 5, 8, 255]],
      [1, [255, 120, 100, 255]],
    ],
  },
  {
    key: 'acid',
    name: 'Acid Wash',
    stops: [
      [0, [30, 60, 10, 255]],
      [0.5, [200, 255, 40, 255]],
      [1, [255, 40, 180, 255]],
    ],
  },
];

function toPreset(spec: BuiltinSpec): GradientPreset {
  return makeGradientPreset({
    id: `gpreset-builtin-${spec.key}`,
    name: spec.name,
    colorStops: spec.stops.map(([position, color]) => ({
      position,
      color: { space: 'rgb', r: color[0], g: color[1], b: color[2], a: color[3] },
    })),
    opacityStops: (spec.opacityStops ?? []).map(([position, opacity]) => ({ position, opacity })),
    ...(spec.smoothness !== undefined ? { smoothness: spec.smoothness } : {}),
    interpolation: 'oklab',
    source: { origin: 'builtin' },
  });
}

/** All built-in gradient presets (deterministic order). */
export const GRADIENT_BUILTIN_PRESETS: GradientPreset[] = BUILTIN_SPECS.map(toPreset);

/** Look up a built-in preset by key. */
export function getGradientBuiltinPreset(key: GradientBuiltinKey): GradientPreset | undefined {
  return GRADIENT_BUILTIN_PRESETS.find((p) => p.id === `gpreset-builtin-${key}`);
}
