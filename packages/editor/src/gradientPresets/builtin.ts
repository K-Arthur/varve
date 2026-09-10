/**
 * Built-in gradient-map presets.
 *
 * Deterministic ids (`gpreset-builtin-<key>`) and stable content so built-in
 * presets never collide with imported presets and dedup on content hash works
 * across sessions. These are NOT stored in the user library — they are
 * composed in at read time (see `useGradientPresetLibrary`).
 */
import type { GradientMapPresetSettings, GradientPreset } from '@varve/scene';
import { makeGradientPreset } from '@varve/scene';

export const GRADIENT_BUILTIN_KEYS = [
  'film-noir',
  'warm-matte',
  'cool-steel',
  'split-tone',
  'high-contrast',
  'fade',
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
  'infrared',
  'moonlight',
  'autumn',
  'arctic',
  'vintage-fade',
  'cyberpunk',
  'rose-gold',
  'forest',
  'lavender',
  'duotone-teal-orange',
  'tri-tone-warm',
  'tri-tone-cool',
] as const;

export type GradientBuiltinKey = (typeof GRADIENT_BUILTIN_KEYS)[number];

interface BuiltinSpec {
  key: GradientBuiltinKey;
  name: string;
  stops: [number, [number, number, number, number]][];
  opacityStops?: [number, number][];
  smoothness?: number;
  category?: string;
  tags?: string[];
  description?: string;
  limitations?: string[];
  mapSettings?: GradientMapPresetSettings;
}

const BUILTIN_SPECS: BuiltinSpec[] = [
  {
    key: 'film-noir',
    name: 'Film Noir',
    category: 'Cinematic',
    tags: ['monochrome', 'portrait', 'dramatic'],
    description: 'Deep blacks and lifted silver highlights for a cinematic monochrome grade.',
    limitations: ['Can hide detail in already-underexposed shadows.'],
    stops: [
      [0, [3, 4, 7, 255]],
      [0.28, [24, 27, 32, 255]],
      [0.68, [132, 137, 140, 255]],
      [1, [244, 240, 228, 255]],
    ],
    mapSettings: { preserveLuminosity: true, intensity: 0.92, dither: true },
  },
  {
    key: 'warm-matte',
    name: 'Warm Matte',
    category: 'Cinematic',
    tags: ['warm', 'matte', 'skin tones'],
    description: 'A restrained amber-brown curve for soft editorial warmth.',
    limitations: ['Warm highlights may shift neutral whites.'],
    stops: [
      [0, [22, 15, 12, 255]],
      [0.35, [92, 62, 46, 255]],
      [0.72, [194, 154, 118, 255]],
      [1, [244, 225, 190, 255]],
    ],
    mapSettings: { preserveLuminosity: true, intensity: 0.86, luminanceMode: 'relative-luminance' },
  },
  {
    key: 'cool-steel',
    name: 'Cool Steel',
    category: 'Cinematic',
    tags: ['cool', 'blue', 'architecture'],
    description: 'A crisp blue-steel grade that keeps bright areas clean and controlled.',
    limitations: ['Blue shadows can exaggerate chroma noise.'],
    stops: [
      [0, [8, 14, 24, 255]],
      [0.32, [38, 62, 82, 255]],
      [0.72, [146, 170, 184, 255]],
      [1, [238, 244, 246, 255]],
    ],
    mapSettings: { preserveLuminosity: true, intensity: 0.88 },
  },
  {
    key: 'split-tone',
    name: 'Split Tone',
    category: 'Cinematic',
    tags: ['teal', 'orange', 'split-toning'],
    description: 'Teal shadows and warm highlights for a classic split-toned finish.',
    limitations: ['Strongly saturated source colors may clip sooner.'],
    stops: [
      [0, [9, 38, 48, 255]],
      [0.5, [42, 70, 74, 255]],
      [1, [245, 166, 76, 255]],
    ],
    mapSettings: { preserveLuminosity: false, intensity: 0.9, reverse: false },
  },
  {
    key: 'high-contrast',
    name: 'High Contrast',
    category: 'Utility',
    tags: ['contrast', 'black and white', 'graphic'],
    description: 'A graphic black-and-white map with a hard tonal separation.',
    limitations: ['Midtone detail is intentionally compressed.'],
    stops: [
      [0, [0, 0, 0, 255]],
      [0.42, [0, 0, 0, 255]],
      [0.58, [255, 255, 255, 255]],
      [1, [255, 255, 255, 255]],
    ],
    mapSettings: { dither: false, preserveLuminosity: false, intensity: 1 },
  },
  {
    key: 'fade',
    name: 'Fade',
    category: 'Utility',
    tags: ['soft', 'low contrast', 'film'],
    description: 'Lifted blacks and gentle highlights for a faded print-like finish.',
    limitations: ['Does not restore clipped source detail.'],
    stops: [
      [0, [35, 30, 26, 255]],
      [0.38, [112, 100, 88, 255]],
      [0.72, [198, 188, 172, 255]],
      [1, [238, 232, 220, 255]],
    ],
    opacityStops: [
      [0, 0.92],
      [1, 0.82],
    ],
    mapSettings: { preserveLuminosity: true, intensity: 0.8, preserveSourceAlpha: true },
  },
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
  {
    key: 'infrared',
    name: 'Infrared',
    stops: [
      [0, [20, 0, 30, 255]],
      [0.3, [120, 0, 80, 255]],
      [0.6, [220, 40, 100, 255]],
      [1, [255, 200, 180, 255]],
    ],
  },
  {
    key: 'moonlight',
    name: 'Moonlight',
    stops: [
      [0, [5, 8, 20, 255]],
      [0.4, [30, 50, 90, 255]],
      [0.7, [80, 120, 160, 255]],
      [1, [180, 200, 220, 255]],
    ],
  },
  {
    key: 'autumn',
    name: 'Autumn',
    stops: [
      [0, [40, 15, 5, 255]],
      [0.35, [160, 60, 20, 255]],
      [0.65, [220, 140, 40, 255]],
      [1, [250, 220, 160, 255]],
    ],
  },
  {
    key: 'arctic',
    name: 'Arctic',
    stops: [
      [0, [10, 20, 40, 255]],
      [0.5, [100, 160, 200, 255]],
      [1, [220, 240, 250, 255]],
    ],
  },
  {
    key: 'vintage-fade',
    name: 'Vintage Fade',
    stops: [
      [0, [30, 25, 20, 255]],
      [0.3, [120, 95, 70, 255]],
      [0.7, [190, 170, 140, 255]],
      [1, [235, 225, 210, 255]],
    ],
  },
  {
    key: 'cyberpunk',
    name: 'Cyberpunk',
    stops: [
      [0, [10, 5, 30, 255]],
      [0.3, [200, 0, 100, 255]],
      [0.6, [0, 220, 255, 255]],
      [1, [255, 255, 100, 255]],
    ],
  },
  {
    key: 'rose-gold',
    name: 'Rose Gold',
    stops: [
      [0, [40, 20, 25, 255]],
      [0.4, [180, 120, 110, 255]],
      [0.7, [230, 190, 170, 255]],
      [1, [250, 235, 225, 255]],
    ],
  },
  {
    key: 'forest',
    name: 'Forest',
    stops: [
      [0, [10, 20, 10, 255]],
      [0.4, [40, 90, 40, 255]],
      [0.7, [100, 160, 80, 255]],
      [1, [200, 230, 180, 255]],
    ],
  },
  {
    key: 'lavender',
    name: 'Lavender',
    stops: [
      [0, [25, 15, 40, 255]],
      [0.5, [120, 90, 170, 255]],
      [1, [220, 200, 240, 255]],
    ],
  },
  {
    key: 'duotone-teal-orange',
    name: 'Teal & Orange',
    stops: [
      [0, [10, 40, 50, 255]],
      [1, [240, 160, 60, 255]],
    ],
  },
  {
    key: 'tri-tone-warm',
    name: 'Warm Tri-tone',
    stops: [
      [0, [30, 10, 5, 255]],
      [0.5, [160, 80, 40, 255]],
      [1, [250, 230, 200, 255]],
    ],
  },
  {
    key: 'tri-tone-cool',
    name: 'Cool Tri-tone',
    stops: [
      [0, [5, 10, 30, 255]],
      [0.5, [40, 100, 150, 255]],
      [1, [200, 225, 245, 255]],
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
    ...(spec.category ? { category: spec.category } : {}),
    ...(spec.tags ? { tags: spec.tags } : {}),
    ...(spec.description ? { description: spec.description } : {}),
    ...(spec.limitations ? { limitations: spec.limitations } : {}),
    ...(spec.mapSettings ? { mapSettings: spec.mapSettings } : {}),
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
