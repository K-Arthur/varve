import type { Color } from './types';

export interface GradientPreset {
  id: string;
  name: string;
  description: string;
  stops: { position: number; color: Color }[];
}

export interface TritonePreset {
  id: string;
  name: string;
  description: string;
  shadowColor: Color;
  midtoneColor: Color;
  highlightColor: Color;
  shadowPoint: number;
  highlightPoint: number;
}

export const GRADIENT_MAP_PRESETS: GradientPreset[] = [
  {
    id: 'bw',
    name: 'Black & White',
    description: 'Standard monochrome luminance map',
    stops: [
      { position: 0, color: [0, 0, 0, 255] },
      { position: 1, color: [255, 255, 255, 255] },
    ],
  },
  {
    id: 'neon',
    name: 'Neon Pulse',
    description: 'Electric cyan to magenta — nightlife, tech, gaming',
    stops: [
      { position: 0, color: [10, 10, 40, 255] },
      { position: 0.4, color: [0, 255, 200, 255] },
      { position: 0.7, color: [200, 0, 255, 255] },
      { position: 1, color: [255, 50, 100, 255] },
    ],
  },
  {
    id: 'sunset',
    name: 'Sunset',
    description: 'Deep indigo to warm orange — travel, lifestyle, food',
    stops: [
      { position: 0, color: [20, 10, 60, 255] },
      { position: 0.4, color: [120, 40, 100, 255] },
      { position: 0.7, color: [255, 120, 50, 255] },
      { position: 1, color: [255, 200, 100, 255] },
    ],
  },
  {
    id: 'ocean',
    name: 'Ocean Depth',
    description: 'Deep blue to teal — finance, healthcare, nature',
    stops: [
      { position: 0, color: [5, 10, 60, 255] },
      { position: 0.3, color: [10, 60, 120, 255] },
      { position: 0.7, color: [30, 160, 180, 255] },
      { position: 1, color: [200, 240, 240, 255] },
    ],
  },
  {
    id: 'fire',
    name: 'Fire & Ice',
    description: 'Bold red-to-blue contrast — sport, action, editorial',
    stops: [
      { position: 0, color: [0, 0, 80, 255] },
      { position: 0.3, color: [80, 0, 80, 255] },
      { position: 0.6, color: [255, 60, 0, 255] },
      { position: 1, color: [255, 220, 50, 255] },
    ],
  },
  {
    id: 'mint',
    name: 'Mint to Rose',
    description: 'Fresh green to soft pink — beauty, wellness, fashion',
    stops: [
      { position: 0, color: [10, 50, 40, 255] },
      { position: 0.5, color: [100, 200, 180, 255] },
      { position: 1, color: [240, 180, 190, 255] },
    ],
  },
  {
    id: 'gold',
    name: 'Gold Rush',
    description: 'Warm amber tones — luxury, premium, editorial',
    stops: [
      { position: 0, color: [40, 20, 5, 255] },
      { position: 0.3, color: [140, 80, 20, 255] },
      { position: 0.6, color: [220, 170, 60, 255] },
      { position: 1, color: [255, 230, 160, 255] },
    ],
  },
  {
    id: 'noir',
    name: 'Film Noir',
    description: 'High-contrast monochrome with crushed blacks',
    stops: [
      { position: 0, color: [0, 0, 0, 255] },
      { position: 0.15, color: [20, 20, 20, 255] },
      { position: 0.5, color: [140, 140, 140, 255] },
      { position: 1, color: [255, 255, 255, 255] },
    ],
  },
  {
    id: 'sepia',
    name: 'Vintage Sepia',
    description: 'Classic warm-toned monochrome — retro, heritage',
    stops: [
      { position: 0, color: [30, 20, 10, 255] },
      { position: 0.5, color: [140, 110, 70, 255] },
      { position: 1, color: [240, 220, 180, 255] },
    ],
  },
  {
    id: 'duotone-blue',
    name: 'Duotone Blue',
    description: 'Brand-safe dark blue to cyan — corporate, clean',
    stops: [
      { position: 0, color: [10, 15, 50, 255] },
      { position: 0.5, color: [30, 80, 140, 255] },
      { position: 1, color: [160, 220, 255, 255] },
    ],
  },
  {
    id: 'duotone-red',
    name: 'Duotone Red',
    description: 'Bold dark red to warm pink — impact, campaign',
    stops: [
      { position: 0, color: [50, 5, 5, 255] },
      { position: 0.5, color: [180, 30, 40, 255] },
      { position: 1, color: [255, 180, 160, 255] },
    ],
  },
  {
    id: 'acid',
    name: 'Acid Wash',
    description: 'Neon green to purple — underground, music, streetwear',
    stops: [
      { position: 0, color: [10, 5, 30, 255] },
      { position: 0.3, color: [100, 0, 180, 255] },
      { position: 0.6, color: [0, 255, 100, 255] },
      { position: 1, color: [255, 255, 0, 255] },
    ],
  },
];

export const TRITONE_PRESETS: TritonePreset[] = [
  {
    id: 'cool-warm',
    name: 'Cool to Warm',
    description: 'Blue shadows, neutral midtones, warm highlights',
    shadowColor: [20, 30, 80, 255],
    midtoneColor: [180, 160, 140, 255],
    highlightColor: [255, 245, 220, 255],
    shadowPoint: 0.35,
    highlightPoint: 0.65,
  },
  {
    id: 'night-ember',
    name: 'Night Ember',
    description: 'Deep navy, charcoal, ember orange',
    shadowColor: [10, 10, 50, 255],
    midtoneColor: [100, 90, 80, 255],
    highlightColor: [255, 140, 40, 255],
    shadowPoint: 0.3,
    highlightPoint: 0.7,
  },
  {
    id: 'arctic-fire',
    name: 'Arctic Fire',
    description: 'Deep cold blue, icy white, fire red highlights',
    shadowColor: [5, 10, 60, 255],
    midtoneColor: [100, 140, 200, 255],
    highlightColor: [255, 100, 50, 255],
    shadowPoint: 0.4,
    highlightPoint: 0.75,
  },
  {
    id: 'forest-gold',
    name: 'Forest & Gold',
    description: 'Deep forest green, amber, gold highlights',
    shadowColor: [10, 30, 10, 255],
    midtoneColor: [60, 100, 60, 255],
    highlightColor: [240, 190, 60, 255],
    shadowPoint: 0.35,
    highlightPoint: 0.7,
  },
  {
    id: 'rose-slate',
    name: 'Rose on Slate',
    description: 'Charcoal, dusty rose, warm cream',
    shadowColor: [40, 35, 45, 255],
    midtoneColor: [140, 100, 120, 255],
    highlightColor: [240, 210, 200, 255],
    shadowPoint: 0.3,
    highlightPoint: 0.7,
  },
  {
    id: 'vintage-fade',
    name: 'Vintage Fade',
    description: 'Crushed black, warm brown, faded paper',
    shadowColor: [25, 20, 15, 255],
    midtoneColor: [150, 120, 90, 255],
    highlightColor: [240, 225, 200, 255],
    shadowPoint: 0.35,
    highlightPoint: 0.65,
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    description: 'Deep purple, electric cyan, hot pink',
    shadowColor: [20, 5, 40, 255],
    midtoneColor: [60, 60, 160, 255],
    highlightColor: [255, 60, 200, 255],
    shadowPoint: 0.3,
    highlightPoint: 0.6,
  },
  {
    id: 'desert-dusk',
    name: 'Desert Dusk',
    description: 'Dusty purple, sand, golden orange',
    shadowColor: [50, 30, 60, 255],
    midtoneColor: [180, 140, 100, 255],
    highlightColor: [255, 190, 80, 255],
    shadowPoint: 0.3,
    highlightPoint: 0.65,
  },
];
