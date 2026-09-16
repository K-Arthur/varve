import type { AdjustmentBlendMode, AdjustmentKind } from '@varve/engine';
import { filterKindDisplayName } from '@varve/engine';
import { SMART_FILTER_KINDS } from '@varve/scene';
import type { SelectOptionGroup, SolidIconName } from '@varve/ui';

const COLOR_TONE_KINDS: readonly AdjustmentKind[] = [
  'brightness',
  'contrast',
  'exposure',
  'levels',
  'curves',
  'saturation',
  'hueSaturation',
  'hueRotate',
  'vibrance',
  'colorBalance',
  'temperature',
  'tint',
  'selectiveColor',
  'invert',
  'blackAndWhite',
  'grayscale',
  'sepia',
  'opacity',
  'threshold',
];

const BLUR_DETAIL_KINDS: readonly AdjustmentKind[] = [
  'blur',
  'motionBlur',
  'sharpen',
  'surfaceSmooth',
  'microDetail',
  'definition',
];

const TEXTURE_FINISHING_KINDS: readonly AdjustmentKind[] = [
  'grain',
  'edgeFalloff',
  'softBloom',
  'halftone',
  'colorHalftone',
  'dither',
  'posterize',
  'mosaic',
  'edgeInk',
  'paletteSnap',
];

const ATMOSPHERE_OPTICS_KINDS: readonly AdjustmentKind[] = [
  'bloom',
  'rgbSplit',
  'lightShafts',
  'lensFlare',
  'lightLeak',
  'caustics',
  'atmosphere',
  'dehaze',
  'crt',
  'vhs',
];

const COLOR_GRADING_KINDS: readonly AdjustmentKind[] = [
  'gradientMap',
  'duotone',
  'tritone',
  'channelMixer',
  'photoFilter',
  'shadowHighlight',
  'lut',
];

function createGroup(label: string, kinds: readonly AdjustmentKind[]): SelectOptionGroup {
  return {
    label,
    options: kinds.map((kind) => ({
      value: kind,
      label: filterKindDisplayName(kind),
    })),
  };
}

export function buildSmartFilterGroups(
  kinds: readonly AdjustmentKind[] = SMART_FILTER_KINDS,
): SelectOptionGroup[] {
  const kindSet = new Set(kinds);

  const filterIncluded = (list: readonly AdjustmentKind[]) =>
    list.filter((kind) => kindSet.has(kind));

  const knownAssigned = new Set<AdjustmentKind>([
    ...COLOR_TONE_KINDS,
    ...BLUR_DETAIL_KINDS,
    ...TEXTURE_FINISHING_KINDS,
    ...ATMOSPHERE_OPTICS_KINDS,
    ...COLOR_GRADING_KINDS,
  ]);

  const groups: SelectOptionGroup[] = [
    createGroup('Color & Tone', filterIncluded(COLOR_TONE_KINDS)),
    createGroup('Blur & Detail', filterIncluded(BLUR_DETAIL_KINDS)),
    createGroup('Texture & Finishing', filterIncluded(TEXTURE_FINISHING_KINDS)),
    createGroup('Atmosphere & Optics', filterIncluded(ATMOSPHERE_OPTICS_KINDS)),
    createGroup('Color Grading', filterIncluded(COLOR_GRADING_KINDS)),
  ].filter((group) => group.options.length > 0);

  // Safety fallback for any future or unassigned filter kinds:
  const remainder = kinds.filter((kind) => !knownAssigned.has(kind));
  if (remainder.length > 0) {
    groups.push(createGroup('Other Effects', remainder));
  }

  return groups;
}

export const SMART_FILTER_GROUPS: readonly SelectOptionGroup[] = buildSmartFilterGroups();

export function filterKindIcon(kind: AdjustmentKind): SolidIconName {
  switch (kind) {
    case 'blur':
    case 'motionBlur':
    case 'surfaceSmooth':
      return 'Drop';
    case 'sharpen':
    case 'microDetail':
    case 'definition':
      return 'Crosshair';
    case 'grain':
    case 'halftone':
    case 'colorHalftone':
    case 'dither':
    case 'mosaic':
      return 'GridFour';
    case 'edgeFalloff':
    case 'softBloom':
    case 'bloom':
    case 'lightShafts':
    case 'lensFlare':
    case 'lightLeak':
    case 'caustics':
      return 'Sparkle';
    case 'gradientMap':
    case 'duotone':
    case 'tritone':
    case 'channelMixer':
    case 'photoFilter':
    case 'lut':
      return 'Palette';
    case 'blackAndWhite':
    case 'grayscale':
    case 'sepia':
    case 'invert':
    case 'threshold':
      return 'CircleHalf';
    default:
      return 'Faders';
  }
}

export function blendModeDisplayName(mode: AdjustmentBlendMode): string {
  switch (mode) {
    case 'normal':
      return 'Normal';
    case 'darken':
      return 'Darken';
    case 'multiply':
      return 'Multiply';
    case 'colorBurn':
      return 'Color Burn';
    case 'lighten':
      return 'Lighten';
    case 'screen':
      return 'Screen';
    case 'colorDodge':
      return 'Color Dodge';
    case 'overlay':
      return 'Overlay';
    case 'softLight':
      return 'Soft Light';
    case 'hardLight':
      return 'Hard Light';
    case 'difference':
      return 'Difference';
    case 'exclusion':
      return 'Exclusion';
    case 'hue':
      return 'Hue';
    case 'saturation':
      return 'Saturation';
    case 'color':
      return 'Color';
    case 'luminosity':
      return 'Luminosity';
    case 'passThrough':
      return 'Pass Through';
    default:
      return String(mode);
  }
}
