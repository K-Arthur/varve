/**
 * Built-in preset registry, grouped by category. Curated, not exhaustive —
 * new categories/presets are added here as pure data; no UI component needs
 * to change to support them (see PresetPicker in @strata/ui, which renders
 * whatever groups it's given).
 *
 * Curatorial rule for anyone extending this file: 'paper' holds raw ISO/ANSI
 * stock sizes (reusable for a frame or a document, no forced color mode);
 * 'print' holds print-collateral presets (business card, poster, brochure,
 * postcard) that always carry dpi/cmyk/bleed, even where dimensions overlap
 * with 'paper'.
 */
import { simplifyRatio } from './presetAspectRatio';
import type { Preset, PresetCategory, PresetGroup, PresetOrientation } from './presetTypes';

type PresetInput = Omit<Preset, 'orientation' | 'aspectRatio'> & {
  /** Set false to omit a fixed aspect ratio, e.g. for scrollable web
   *  breakpoints where height is a starting point, not a fixed dimension.
   *  Defaults to true. */
  hasFixedRatio?: boolean;
  /** Override the derived orientation. Defaults to derived from width vs
   *  height (square if equal, landscape if wider, portrait if taller). */
  orientationOverride?: PresetOrientation;
};

function definePreset(input: PresetInput): Preset {
  const { hasFixedRatio = true, orientationOverride, ...rest } = input;
  const orientation: PresetOrientation =
    orientationOverride ??
    (rest.width === rest.height ? 'square' : rest.width > rest.height ? 'landscape' : 'portrait');
  return {
    ...rest,
    orientation,
    aspectRatio: hasFixedRatio ? simplifyRatio(rest.width, rest.height) : undefined,
  };
}

/** Standalone "start empty" affordance — not part of a group grid, since it's
 *  a single always-visible tile rather than a size choice among peers. */
export const BLANK_DOCUMENT_PRESET: Preset = definePreset({
  id: 'blank',
  name: 'Blank',
  category: 'blank',
  width: 1920,
  height: 1080,
  unit: 'px',
  colorMode: 'rgb',
  background: 'white',
  description: 'Start empty at any size. Add device/social frames later.',
});

const PHOTO_GROUP: PresetGroup = {
  category: 'photo',
  label: 'Photo',
  presets: [
    definePreset({
      id: 'photo-4x6',
      name: '4 × 6 in',
      category: 'photo',
      width: 4,
      height: 6,
      unit: 'in',
      dpi: 300,
      colorMode: 'rgb',
      background: 'white',
      workflowHint: 'Photo print',
    }),
    definePreset({
      id: 'photo-5x7',
      name: '5 × 7 in',
      category: 'photo',
      width: 5,
      height: 7,
      unit: 'in',
      dpi: 300,
      colorMode: 'rgb',
      background: 'white',
      workflowHint: 'Photo print',
    }),
    definePreset({
      id: 'photo-8x10',
      name: '8 × 10 in',
      category: 'photo',
      width: 8,
      height: 10,
      unit: 'in',
      dpi: 300,
      colorMode: 'rgb',
      background: 'white',
      workflowHint: 'Photo print',
    }),
    definePreset({
      id: 'photo-11x14',
      name: '11 × 14 in',
      category: 'photo',
      width: 11,
      height: 14,
      unit: 'in',
      dpi: 300,
      colorMode: 'rgb',
      background: 'white',
      workflowHint: 'Photo print',
    }),
    definePreset({
      id: 'photo-8x8-square',
      name: 'Square Print 8 × 8 in',
      category: 'photo',
      width: 8,
      height: 8,
      unit: 'in',
      dpi: 300,
      colorMode: 'rgb',
      background: 'white',
      workflowHint: 'Photo print',
    }),
  ],
};

const PRINT_GROUP: PresetGroup = {
  category: 'print',
  label: 'Print',
  presets: [
    definePreset({
      id: 'business-card-us',
      name: 'Business Card (US)',
      category: 'print',
      width: 88.9,
      height: 50.8,
      unit: 'mm',
      dpi: 300,
      colorMode: 'cmyk',
      bleed: { value: 3, unit: 'mm' },
      workflowHint: 'Print & mail',
    }),
    definePreset({
      id: 'business-card-eu',
      name: 'Business Card (EU/ISO)',
      category: 'print',
      width: 85,
      height: 55,
      unit: 'mm',
      dpi: 300,
      colorMode: 'cmyk',
      bleed: { value: 3, unit: 'mm' },
      workflowHint: 'Print & mail',
    }),
    definePreset({
      id: 'postcard-us',
      name: 'Postcard (6 × 4 in)',
      category: 'print',
      width: 152,
      height: 102,
      unit: 'mm',
      dpi: 300,
      colorMode: 'cmyk',
      bleed: { value: 3, unit: 'mm' },
      workflowHint: 'Print & mail',
    }),
    definePreset({
      id: 'flyer-letter',
      name: 'Flyer (8.5 × 11 in)',
      category: 'print',
      width: 215.9,
      height: 279.4,
      unit: 'mm',
      dpi: 300,
      colorMode: 'cmyk',
      bleed: { value: 3, unit: 'mm' },
      workflowHint: 'Print & distribute',
    }),
    definePreset({
      id: 'trifold-brochure',
      name: 'Trifold Brochure (flat)',
      category: 'print',
      width: 279.4,
      height: 215.9,
      unit: 'mm',
      dpi: 300,
      colorMode: 'cmyk',
      bleed: { value: 3, unit: 'mm' },
      workflowHint: 'Print & fold',
    }),
    definePreset({
      id: 'poster-small',
      name: 'Poster (18 × 24 in)',
      category: 'print',
      width: 457,
      height: 610,
      unit: 'mm',
      dpi: 150,
      colorMode: 'cmyk',
      bleed: { value: 5, unit: 'mm' },
      workflowHint: 'Large-format print',
    }),
    definePreset({
      id: 'poster-large',
      name: 'Poster (24 × 36 in)',
      category: 'print',
      width: 610,
      height: 914,
      unit: 'mm',
      dpi: 150,
      colorMode: 'cmyk',
      bleed: { value: 5, unit: 'mm' },
      workflowHint: 'Large-format print',
    }),
  ],
};

const WEB_GROUP: PresetGroup = {
  category: 'web',
  label: 'Web',
  presets: (
    [
      ['web-sm', 'Web — Small (sm)', 640],
      ['web-md', 'Web — Medium (md)', 768],
      ['web-lg', 'Web — Large (lg)', 1024],
      ['web-xl', 'Web — X-Large (xl)', 1280],
      ['web-2xl', 'Web — 2X-Large (2xl)', 1536],
    ] as const
  ).map(([id, name, width]) =>
    definePreset({
      id,
      name,
      category: 'web',
      width,
      height: 900,
      unit: 'px',
      colorMode: 'rgb',
      background: 'white',
      hasFixedRatio: false,
      orientationOverride: 'any',
      description: 'Common responsive breakpoint. Height is a starting point — content scrolls.',
      workflowHint: 'Responsive web design',
    }),
  ),
};

const DESKTOP_GROUP: PresetGroup = {
  category: 'desktop',
  label: 'Desktop',
  presets: [
    definePreset({
      id: 'desktop-hd',
      name: 'Desktop HD',
      category: 'desktop',
      width: 1920,
      height: 1080,
      unit: 'px',
      colorMode: 'rgb',
    }),
    definePreset({
      id: 'desktop-qhd',
      name: 'Desktop QHD',
      category: 'desktop',
      width: 2560,
      height: 1440,
      unit: 'px',
      colorMode: 'rgb',
    }),
    definePreset({
      id: 'desktop-4k-uhd',
      name: 'Desktop 4K UHD',
      category: 'desktop',
      width: 3840,
      height: 2160,
      unit: 'px',
      colorMode: 'rgb',
    }),
    definePreset({
      id: 'macbook-pro-16',
      name: 'MacBook Pro 16"',
      category: 'desktop',
      width: 1728,
      height: 1117,
      unit: 'px',
      colorMode: 'rgb',
    }),
    definePreset({
      id: 'macbook-air-13',
      name: 'MacBook Air 13"',
      category: 'desktop',
      width: 1280,
      height: 832,
      unit: 'px',
      colorMode: 'rgb',
    }),
  ],
};

const MOBILE_TABLET_GROUP: PresetGroup = {
  category: 'mobile-tablet',
  label: 'Mobile & Tablet',
  presets: [
    definePreset({
      id: 'iphone-15-pro',
      name: 'iPhone 15 Pro',
      category: 'mobile-tablet',
      width: 393,
      height: 852,
      unit: 'px',
      colorMode: 'rgb',
    }),
    definePreset({
      id: 'iphone-15-pro-max',
      name: 'iPhone 15 Pro Max',
      category: 'mobile-tablet',
      width: 430,
      height: 932,
      unit: 'px',
      colorMode: 'rgb',
    }),
    definePreset({
      id: 'iphone-se',
      name: 'iPhone SE',
      category: 'mobile-tablet',
      width: 375,
      height: 667,
      unit: 'px',
      colorMode: 'rgb',
    }),
    definePreset({
      id: 'android-compact',
      name: 'Android Compact',
      category: 'mobile-tablet',
      width: 412,
      height: 917,
      unit: 'px',
      colorMode: 'rgb',
    }),
    definePreset({
      id: 'ipad-air',
      name: 'iPad Air',
      category: 'mobile-tablet',
      width: 820,
      height: 1180,
      unit: 'px',
      colorMode: 'rgb',
    }),
    definePreset({
      id: 'ipad-pro-11',
      name: 'iPad Pro 11"',
      category: 'mobile-tablet',
      width: 834,
      height: 1194,
      unit: 'px',
      colorMode: 'rgb',
    }),
    definePreset({
      id: 'surface-pro',
      name: 'Surface Pro 8',
      category: 'mobile-tablet',
      width: 1440,
      height: 960,
      unit: 'px',
      colorMode: 'rgb',
    }),
  ],
};

const SOCIAL_GROUP: PresetGroup = {
  category: 'social',
  label: 'Social',
  presets: [
    definePreset({
      id: 'ig-post',
      name: 'Instagram Post',
      category: 'social',
      width: 1080,
      height: 1080,
      unit: 'px',
      colorMode: 'rgb',
      tags: ['instagram'],
    }),
    definePreset({
      id: 'ig-story',
      name: 'Instagram Story / Reel',
      category: 'social',
      width: 1080,
      height: 1920,
      unit: 'px',
      colorMode: 'rgb',
      tags: ['instagram'],
    }),
    definePreset({
      id: 'ig-portrait',
      name: 'Instagram Portrait',
      category: 'social',
      width: 1080,
      height: 1350,
      unit: 'px',
      colorMode: 'rgb',
      tags: ['instagram'],
    }),
    definePreset({
      id: 'fb-cover',
      name: 'Facebook Cover',
      category: 'social',
      width: 1640,
      height: 624,
      unit: 'px',
      colorMode: 'rgb',
      tags: ['facebook'],
    }),
    definePreset({
      id: 'fb-post',
      name: 'Facebook Post',
      category: 'social',
      width: 1200,
      height: 630,
      unit: 'px',
      colorMode: 'rgb',
      tags: ['facebook'],
    }),
    definePreset({
      id: 'x-post',
      name: 'X Post',
      category: 'social',
      width: 1600,
      height: 900,
      unit: 'px',
      colorMode: 'rgb',
      tags: ['x', 'twitter'],
    }),
    definePreset({
      id: 'x-header',
      name: 'X Header',
      category: 'social',
      width: 1500,
      height: 500,
      unit: 'px',
      colorMode: 'rgb',
      tags: ['x', 'twitter'],
    }),
    definePreset({
      id: 'linkedin-post',
      name: 'LinkedIn Post',
      category: 'social',
      width: 1200,
      height: 627,
      unit: 'px',
      colorMode: 'rgb',
      tags: ['linkedin'],
    }),
    definePreset({
      id: 'youtube-thumbnail',
      name: 'YouTube Thumbnail',
      category: 'social',
      width: 1280,
      height: 720,
      unit: 'px',
      colorMode: 'rgb',
      tags: ['youtube'],
    }),
    definePreset({
      id: 'pinterest-pin',
      name: 'Pinterest Pin',
      category: 'social',
      width: 1000,
      height: 1500,
      unit: 'px',
      colorMode: 'rgb',
      tags: ['pinterest'],
    }),
  ],
};

const VIDEO_MOTION_GROUP: PresetGroup = {
  category: 'video-motion',
  label: 'Video & Motion',
  presets: [
    definePreset({
      id: 'video-hd-1080p',
      name: 'HD 1080p',
      category: 'video-motion',
      width: 1920,
      height: 1080,
      unit: 'px',
      colorMode: 'rgb',
      pixelAspectRatio: 1,
      fps: 30,
      durationSeconds: 15,
    }),
    definePreset({
      id: 'video-4k-uhd',
      name: '4K UHD',
      category: 'video-motion',
      width: 3840,
      height: 2160,
      unit: 'px',
      colorMode: 'rgb',
      pixelAspectRatio: 1,
      fps: 30,
      durationSeconds: 15,
    }),
    definePreset({
      id: 'video-cinema-4k-dci',
      name: 'Cinema 4K (DCI)',
      category: 'video-motion',
      width: 4096,
      height: 2160,
      unit: 'px',
      colorMode: 'rgb',
      pixelAspectRatio: 1,
      fps: 24,
      workflowHint: 'Cinema/broadcast delivery',
    }),
    definePreset({
      id: 'video-vertical-reels',
      name: 'Vertical Video / Reels',
      category: 'video-motion',
      width: 1080,
      height: 1920,
      unit: 'px',
      colorMode: 'rgb',
      pixelAspectRatio: 1,
      fps: 30,
      durationSeconds: 15,
      workflowHint: 'Short-form social video',
    }),
    definePreset({
      id: 'video-ntsc-dv',
      name: 'NTSC DV (4:3)',
      category: 'video-motion',
      width: 720,
      height: 480,
      unit: 'px',
      colorMode: 'rgb',
      pixelAspectRatio: 0.9091,
      fps: 29.97,
      description:
        'Legacy standard-definition format with non-square pixels — displays at 4:3 despite a 3:2 frame buffer.',
      hasFixedRatio: false,
    }),
  ],
};

const PRESENTATION_GROUP: PresetGroup = {
  category: 'presentation',
  label: 'Presentation',
  presets: [
    definePreset({
      id: 'slide-16-9',
      name: 'Slide 16:9',
      category: 'presentation',
      width: 1920,
      height: 1080,
      unit: 'px',
      colorMode: 'rgb',
    }),
    definePreset({
      id: 'slide-4-3',
      name: 'Slide 4:3',
      category: 'presentation',
      width: 1024,
      height: 768,
      unit: 'px',
      colorMode: 'rgb',
    }),
    definePreset({
      id: 'slide-vertical-9-16',
      name: 'Vertical Slide 9:16',
      category: 'presentation',
      width: 1080,
      height: 1920,
      unit: 'px',
      colorMode: 'rgb',
      workflowHint: 'Social carousel / vertical deck',
    }),
  ],
};

const PAPER_GROUP: PresetGroup = {
  category: 'paper',
  label: 'Paper',
  presets: [
    definePreset({
      id: 'a4',
      name: 'A4',
      category: 'paper',
      width: 210,
      height: 297,
      unit: 'mm',
    }),
    definePreset({
      id: 'a3',
      name: 'A3',
      category: 'paper',
      width: 297,
      height: 420,
      unit: 'mm',
    }),
    definePreset({
      id: 'a5',
      name: 'A5',
      category: 'paper',
      width: 148,
      height: 210,
      unit: 'mm',
    }),
    definePreset({
      id: 'us-letter',
      name: 'US Letter',
      category: 'paper',
      width: 215.9,
      height: 279.4,
      unit: 'mm',
    }),
    definePreset({
      id: 'us-legal',
      name: 'US Legal',
      category: 'paper',
      width: 215.9,
      height: 355.6,
      unit: 'mm',
    }),
    definePreset({
      id: 'us-tabloid',
      name: 'US Tabloid / Ledger',
      category: 'paper',
      width: 279.4,
      height: 431.8,
      unit: 'mm',
    }),
  ],
};

const ICON_ASSET_GROUP: PresetGroup = {
  category: 'icon-asset',
  label: 'Icon & Asset',
  presets: [
    definePreset({
      id: 'favicon-32',
      name: 'Favicon (32×32)',
      category: 'icon-asset',
      width: 32,
      height: 32,
      unit: 'px',
      colorMode: 'rgb',
      background: 'transparent',
      tags: ['favicon'],
    }),
    definePreset({
      id: 'ui-icon-24',
      name: 'UI Icon (24×24)',
      category: 'icon-asset',
      width: 24,
      height: 24,
      unit: 'px',
      colorMode: 'rgb',
      background: 'transparent',
      tags: ['icon'],
    }),
    definePreset({
      id: 'export-icon-256',
      name: 'Export Icon (256×256)',
      category: 'icon-asset',
      width: 256,
      height: 256,
      unit: 'px',
      colorMode: 'rgb',
      background: 'transparent',
      tags: ['icon', 'export'],
    }),
    definePreset({
      id: 'app-icon-android',
      name: 'App Icon — Android (512×512)',
      category: 'icon-asset',
      width: 512,
      height: 512,
      unit: 'px',
      colorMode: 'rgb',
      background: 'transparent',
      tags: ['app-icon', 'android'],
    }),
    definePreset({
      id: 'social-avatar-400',
      name: 'Social Avatar (400×400)',
      category: 'icon-asset',
      width: 400,
      height: 400,
      unit: 'px',
      colorMode: 'rgb',
      background: 'white',
      tags: ['avatar'],
    }),
    definePreset({
      id: 'app-icon-ios',
      name: 'App Icon — iOS (1024×1024)',
      category: 'icon-asset',
      width: 1024,
      height: 1024,
      unit: 'px',
      colorMode: 'rgb',
      background: 'white',
      tags: ['app-icon', 'ios'],
    }),
  ],
};

/**
 * All built-in preset groups, in the order they should be presented in the
 * picker UI. Extending the app's presets should only ever mean adding to (or
 * editing) this array — no consuming component needs to change.
 */
export const BUILTIN_PRESET_GROUPS: PresetGroup[] = [
  PHOTO_GROUP,
  PRINT_GROUP,
  WEB_GROUP,
  MOBILE_TABLET_GROUP,
  DESKTOP_GROUP,
  SOCIAL_GROUP,
  VIDEO_MOTION_GROUP,
  PRESENTATION_GROUP,
  PAPER_GROUP,
  ICON_ASSET_GROUP,
];

/** Flatten every built-in preset (excluding the standalone blank preset) into
 *  a single list, e.g. for search/lookup. */
export function flattenBuiltinPresets(): Preset[] {
  return BUILTIN_PRESET_GROUPS.flatMap((group) => group.presets);
}

/** Find a built-in preset by id, including the standalone blank preset. */
export function findBuiltinPreset(id: string): Preset | undefined {
  if (id === BLANK_DOCUMENT_PRESET.id) return BLANK_DOCUMENT_PRESET;
  return flattenBuiltinPresets().find((preset) => preset.id === id);
}

/** All categories that currently have at least one built-in group. */
export function builtinCategories(): PresetCategory[] {
  return BUILTIN_PRESET_GROUPS.map((group) => group.category);
}
