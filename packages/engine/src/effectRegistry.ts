import { getFilterProperties } from './adjustmentPipeline';
import { getEffectContract } from './effectContract';
import {
  ADJUSTMENT_KINDS,
  type AdjustmentKind,
  adjustmentDefaults,
  filterKindDisplayName,
  isKnownAdjustmentKind,
} from './filters';
import { IMAGE_TREATMENT_KINDS } from './imageTreatments';

/** Stable, intent-oriented Effect Studio categories. */
export const EFFECT_CATEGORIES = [
  { id: 'essentials', label: 'Essentials' },
  { id: 'light-tone', label: 'Light & Tone' },
  { id: 'colour', label: 'Colour' },
  { id: 'focus-detail', label: 'Focus & Detail' },
  { id: 'surface-grain', label: 'Surface & Grain' },
  { id: 'edge-illustration', label: 'Edge & Illustration' },
  { id: 'atmosphere-light', label: 'Atmosphere & Light' },
  { id: 'print-pattern', label: 'Print & Pattern' },
] as const;

export type EffectCategoryId = (typeof EFFECT_CATEGORIES)[number]['id'];
export const EFFECT_STUDIO_CATEGORIES = [
  {
    id: 'artistic-media',
    label: 'Artistic Media',
    description: 'Reduce, remap, and reinterpret an object as a designed image.',
  },
  {
    id: 'print-strokes',
    label: 'Print Strokes',
    description: 'Turn tone into marks, dots, and deliberate print structure.',
  },
  {
    id: 'distort',
    label: 'Distort',
    description: 'Bend, split, and refract the rendered object result.',
  },
  {
    id: 'sketch-poster',
    label: 'Sketch & Poster',
    description: 'Push an object toward graphic, posterized, or hand-made abstraction.',
  },
  {
    id: 'stylize',
    label: 'Stylize',
    description: 'Add luminous, electronic, and cinematic visual signatures.',
  },
  {
    id: 'texture-tape',
    label: 'Texture & Tape',
    description: 'Add a surface language that reads as material, tape, or signal.',
  },
] as const;

export type EffectStudioCategoryId = (typeof EFFECT_STUDIO_CATEGORIES)[number]['id'];
export type EffectSurface = 'effect-studio' | 'image-tuning' | 'adjustment-layer' | 'object-filter';

export interface EffectSurfaceGuidance {
  id: EffectSurface;
  label: string;
  scope: string;
  rasterBehavior: string;
  vectorBehavior: string;
}

/** Product contract for how each discovery surface treats raster and vector content. */
export const EFFECT_SURFACE_GUIDANCE: Readonly<Record<EffectSurface, EffectSurfaceGuidance>> = {
  'effect-studio': {
    id: 'effect-studio',
    label: 'Effect Studio',
    scope: 'Object-local creative effect',
    rasterBehavior:
      'Processes the rendered image object while preserving its source fill, placement, and crop.',
    vectorBehavior:
      'Renders the vector object to a temporary effect surface; the original geometry, fill, and text stay editable.',
  },
  'image-tuning': {
    id: 'image-tuning',
    label: 'Image Tuning',
    scope: 'Image-local photographic adjustment',
    rasterBehavior:
      'Tunes image pixels in a batch-friendly photographic workflow, with source pixels and placement preserved.',
    vectorBehavior:
      'Not offered for vector selections; use Object Filters for rendered-object treatments or Effect Studio for creative effects.',
  },
  'adjustment-layer': {
    id: 'adjustment-layer',
    label: 'Adjustment Filters',
    scope: 'Backdrop-scoped tonal and colour correction',
    rasterBehavior:
      'Applies to the rendered raster content below the layer and can be limited with the layer scope and mask.',
    vectorBehavior:
      'Applies after vector content is rendered into the backdrop; vector geometry remains unchanged and editable.',
  },
  'object-filter': {
    id: 'object-filter',
    label: 'Object Filters',
    scope: 'Advanced ordered object-local stack',
    rasterBehavior:
      'Filters the selected image result with per-entry order, opacity, blend, and mask controls.',
    vectorBehavior:
      'Filters the rendered vector result with per-entry order, opacity, blend, and mask controls; source geometry remains editable.',
  },
};

/** Creative, object-oriented effects surfaced by Effect Studio. */
export const EFFECT_STUDIO_KINDS = [
  'duotone',
  'tritone',
  'paletteSnap',
  'colorHalftone',
  'rgbSplit',
  'caustics',
  'dither',
  'bloom',
  'lightShafts',
  'lensFlare',
  'lightLeak',
  'crt',
  'vhs',
] as const satisfies readonly AdjustmentKind[];

/** Image-only photographic controls; the curated Image Tuning surface owns these. */
export const IMAGE_TUNING_KINDS = [
  'exposure',
  'contrast',
  'shadowHighlight',
  'temperature',
  'tint',
  'vibrance',
  'saturation',
  ...IMAGE_TREATMENT_KINDS,
] as const satisfies readonly AdjustmentKind[];

/** Backdrop-scoped correction controls exposed when an Adjustment Layer is selected. */
export const ADJUSTMENT_LAYER_KINDS = [
  'brightness',
  'contrast',
  'exposure',
  'saturation',
  'hueSaturation',
  'hueRotate',
  'sepia',
  'grayscale',
  'invert',
  'temperature',
  'tint',
  'vibrance',
  'levels',
  'curves',
  'selectiveColor',
  'colorBalance',
  'channelMixer',
  'photoFilter',
  'shadowHighlight',
  'gradientMap',
  'halftone',
  'blackAndWhite',
  'posterize',
  'threshold',
  'lut',
] as const satisfies readonly AdjustmentKind[];

/** Full advanced object-local escape hatch, including photographic treatments. */
export const OBJECT_FILTER_KINDS = ADJUSTMENT_KINDS;

const STUDIO_CATEGORY_BY_KIND: Record<
  (typeof EFFECT_STUDIO_KINDS)[number],
  EffectStudioCategoryId
> = {
  duotone: 'artistic-media',
  tritone: 'artistic-media',
  paletteSnap: 'artistic-media',
  colorHalftone: 'print-strokes',
  rgbSplit: 'distort',
  caustics: 'distort',
  dither: 'sketch-poster',
  bloom: 'stylize',
  lightShafts: 'stylize',
  lensFlare: 'stylize',
  lightLeak: 'stylize',
  crt: 'stylize',
  vhs: 'texture-tape',
};
export type EffectTargetKind = 'shape' | 'text' | 'path' | 'frame' | 'group' | 'rasterLayer';
export type EffectScope = 'object' | 'adjustment-layer';
export type EffectParameterType = 'number' | 'boolean' | 'enum' | 'colour' | 'structured';

export interface EffectParameterDefinition {
  key: string;
  type: EffectParameterType;
  defaultValue: unknown;
  min?: number;
  max?: number;
  unit?: 'percent' | 'degrees' | 'pixels' | 'number';
  animatable: boolean;
  changesBounds: boolean;
  expensive: boolean;
}

export interface EffectDefinition {
  /** Stable, non-localized adjustment kind. */
  id: AdjustmentKind;
  schemaVersion: 1;
  displayNameKey: string;
  descriptionKey: string;
  /** Localized fallback used until the host translation catalog is present. */
  displayName: string;
  description: string;
  categoryId: EffectCategoryId;
  studioCategoryId?: EffectStudioCategoryId;
  /** Surface-specific discovery and scope; the renderer remains shared. */
  surfaces: readonly EffectSurface[];
  tags: readonly string[];
  supportedTargets: readonly EffectTargetKind[];
  supportedScopes: readonly EffectScope[];
  parameters: readonly EffectParameterDefinition[];
  renderCapabilities: {
    native: boolean;
    wasm: boolean;
    canvas2d: boolean;
    webgpu: boolean;
    svgExport: 'native' | 'rasterize';
    pdfExport: 'rasterize';
  };
  rendering: {
    colourDomain: 'linear-light' | 'perceptual' | 'effect-specific';
    alphaPolicy: 'preserve-source-alpha';
    boundsPolicy: 'source' | 'expanded';
    deterministic: boolean;
    previewPolicy: 'exact' | 'quality-tier';
    estimatedCost: 'low' | 'medium' | 'high';
  };
}

const CATEGORY_BY_KIND: Partial<Record<AdjustmentKind, EffectCategoryId>> = {
  brightness: 'essentials',
  contrast: 'essentials',
  exposure: 'light-tone',
  saturation: 'essentials',
  hueSaturation: 'colour',
  hueRotate: 'colour',
  sepia: 'colour',
  grayscale: 'colour',
  invert: 'colour',
  opacity: 'essentials',
  blur: 'focus-detail',
  sharpen: 'focus-detail',
  temperature: 'light-tone',
  tint: 'colour',
  vibrance: 'colour',
  levels: 'light-tone',
  curves: 'light-tone',
  selectiveColor: 'colour',
  colorBalance: 'colour',
  channelMixer: 'colour',
  photoFilter: 'colour',
  shadowHighlight: 'light-tone',
  halftone: 'print-pattern',
  gradientMap: 'colour',
  tritone: 'colour',
  colorHalftone: 'print-pattern',
  duotone: 'colour',
  blackAndWhite: 'colour',
  posterize: 'print-pattern',
  threshold: 'print-pattern',
  lut: 'colour',
  dither: 'print-pattern',
  paletteSnap: 'colour',
  bloom: 'atmosphere-light',
  rgbSplit: 'edge-illustration',
  crt: 'print-pattern',
  vhs: 'surface-grain',
  lightShafts: 'atmosphere-light',
  lensFlare: 'atmosphere-light',
  lightLeak: 'atmosphere-light',
  caustics: 'atmosphere-light',
  microDetail: 'focus-detail',
  definition: 'focus-detail',
  atmosphere: 'atmosphere-light',
  dehaze: 'atmosphere-light',
  edgeFalloff: 'edge-illustration',
  grain: 'surface-grain',
  softBloom: 'atmosphere-light',
};

const DESCRIPTION_BY_KIND: Partial<Record<AdjustmentKind, string>> = {
  brightness: 'Lift or lower the overall lightness of the selected artwork.',
  contrast: 'Separate light and dark values while keeping the source editable.',
  blur: 'Soften detail with a bounds-aware blur.',
  sharpen: 'Restore edge definition without replacing the source pixels.',
  grain: 'Add restrained material texture with a deterministic seed.',
  dither: 'Reduce tonal steps with a document-stable pattern.',
  paletteSnap: 'Bring colours toward a controlled palette.',
  bloom: 'Diffuse luminous areas into a soft glow.',
  rgbSplit: 'Separate colour channels for a controlled fringe.',
  edgeFalloff: 'Shape attention toward the centre with an editable falloff.',
  softBloom: 'Diffuse bright and mid-tone areas into a gentle glow.',
};

const TAGS_BY_KIND: Partial<Record<AdjustmentKind, readonly string[]>> = {
  blur: ['soften', 'focus', 'depth'],
  sharpen: ['detail', 'clarity'],
  grain: ['texture', 'film', 'noise'],
  dither: ['pixel', 'poster', 'quantize'],
  paletteSnap: ['palette', 'quantize', 'colour'],
  bloom: ['glow', 'light', 'diffusion'],
  rgbSplit: ['chromatic', 'aberration', 'glitch'],
  crt: ['screen', 'retro', 'scanlines'],
  vhs: ['tape', 'retro', 'glitch'],
  edgeFalloff: ['vignette', 'focus', 'edges'],
};

const COMMON_RANGES: Record<string, [number, number, EffectParameterDefinition['unit']?]> = {
  value: [-100, 100, 'number'],
  amount: [-100, 100, 'number'],
  strength: [-100, 100, 'number'],
  intensity: [0, 1, 'number'],
  opacity: [0, 1, 'number'],
  radius: [0, 4096, 'pixels'],
  blur: [0, 4096, 'pixels'],
  angle: [-180, 180, 'degrees'],
  direction: [-180, 180, 'degrees'],
  density: [0, 1, 'number'],
  threshold: [0, 1, 'number'],
  seed: [0, 4_294_967_295, 'number'],
};

function parameterType(value: unknown): EffectParameterType {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'enum';
  if (Array.isArray(value) && value.every((channel) => typeof channel === 'number')) {
    return value.length >= 3 ? 'colour' : 'structured';
  }
  return 'structured';
}

function parameterDefinitions(kind: AdjustmentKind): EffectParameterDefinition[] {
  const defaults = adjustmentDefaults(kind) as Record<string, unknown>;
  const contract = getEffectContract(kind);
  return Object.entries(defaults)
    .filter(([key]) => key !== 'visible' && key !== 'opacity' && key !== 'blendMode')
    .map(([key, defaultValue]) => {
      const range = COMMON_RANGES[key];
      return {
        key,
        type: parameterType(defaultValue),
        defaultValue,
        ...(range ? { min: range[0], max: range[1], unit: range[2] } : {}),
        animatable: key === 'time' || key === 'value' || key === 'amount',
        changesBounds: ['radius', 'blur', 'size', 'streakLength', 'scale'].includes(key),
        expensive: contract?.hasApproximatePreview ?? false,
      };
    });
}

function definitionFor(kind: AdjustmentKind): EffectDefinition {
  const contract = getEffectContract(kind);
  const properties = getFilterProperties(kind);
  const name = filterKindDisplayName(kind);
  const categoryId = CATEGORY_BY_KIND[kind] ?? 'essentials';
  const description =
    DESCRIPTION_BY_KIND[kind] ?? `Apply an editable ${name.toLocaleLowerCase()} treatment.`;
  const tags = [...new Set([kind, name.toLocaleLowerCase(), ...(TAGS_BY_KIND[kind] ?? [])])];
  const requiresExpandedBounds = parameterDefinitions(kind).some((parameter) =>
    ['radius', 'blur', 'size', 'streakLength'].includes(parameter.key),
  );
  const estimatedCost = contract?.hasApproximatePreview
    ? 'high'
    : properties?.hasCssPath
      ? 'low'
      : 'medium';
  const surfaces: EffectSurface[] = ['object-filter'];
  if ((EFFECT_STUDIO_KINDS as readonly string[]).includes(kind)) {
    surfaces.push('effect-studio');
  }
  if ((IMAGE_TUNING_KINDS as readonly string[]).includes(kind)) {
    surfaces.push('image-tuning');
  }
  if ((ADJUSTMENT_LAYER_KINDS as readonly string[]).includes(kind)) {
    surfaces.push('adjustment-layer');
  }

  return {
    id: kind,
    schemaVersion: 1,
    displayNameKey: `effect.${kind}.name`,
    descriptionKey: `effect.${kind}.description`,
    displayName: name,
    description,
    categoryId,
    ...(STUDIO_CATEGORY_BY_KIND[kind as (typeof EFFECT_STUDIO_KINDS)[number]]
      ? {
          studioCategoryId: STUDIO_CATEGORY_BY_KIND[kind as (typeof EFFECT_STUDIO_KINDS)[number]],
        }
      : {}),
    surfaces,
    tags,
    supportedTargets: ['shape', 'text', 'path', 'frame', 'group', 'rasterLayer'],
    supportedScopes: surfaces.includes('adjustment-layer')
      ? ['object', 'adjustment-layer']
      : ['object'],
    parameters: parameterDefinitions(kind),
    renderCapabilities: {
      native: contract?.nativeStatus === 'implemented',
      // The browser build uses the shared TypeScript FilterIR replay; no
      // separate WASM effect provider is currently exposed at this boundary.
      wasm: false,
      canvas2d: true,
      webgpu: contract?.gpuStatus === 'implemented' || contract?.gpuStatus === 'partial',
      svgExport: properties?.requiresRasterExport ? 'rasterize' : 'native',
      pdfExport: 'rasterize',
    },
    rendering: {
      colourDomain:
        contract?.workingSpace === 'linear-light'
          ? 'linear-light'
          : contract?.workingSpace === 'oklab'
            ? 'perceptual'
            : 'effect-specific',
      alphaPolicy: 'preserve-source-alpha',
      boundsPolicy: requiresExpandedBounds ? 'expanded' : 'source',
      deterministic: true,
      previewPolicy: contract?.hasApproximatePreview ? 'quality-tier' : 'exact',
      estimatedCost,
    },
  };
}

/** The one catalog consumed by Effect Studio and registry coverage tests. */
export const EFFECT_REGISTRY: Readonly<Record<AdjustmentKind, EffectDefinition>> = Object.freeze(
  Object.fromEntries(ADJUSTMENT_KINDS.map((kind) => [kind, definitionFor(kind)])) as Record<
    AdjustmentKind,
    EffectDefinition
  >,
);

export function getEffectDefinition(kind: string): EffectDefinition | undefined {
  return isKnownAdjustmentKind(kind) ? EFFECT_REGISTRY[kind] : undefined;
}

export function listEffectDefinitions(): EffectDefinition[] {
  return ADJUSTMENT_KINDS.map((kind) => EFFECT_REGISTRY[kind]);
}

export function listEffectStudioDefinitions(): EffectDefinition[] {
  return EFFECT_STUDIO_KINDS.map((kind) => EFFECT_REGISTRY[kind]);
}

export function searchEffectStudioDefinitions(
  query: string,
  categoryId?: EffectStudioCategoryId,
): EffectDefinition[] {
  const normalized = query.trim().toLocaleLowerCase();
  return listEffectStudioDefinitions().filter((definition) => {
    if (categoryId && definition.studioCategoryId !== categoryId) return false;
    if (!normalized) return true;
    return [definition.displayName, definition.description, ...definition.tags].some((value) =>
      value.toLocaleLowerCase().includes(normalized),
    );
  });
}

export function searchEffectDefinitions(
  query: string,
  categoryId?: EffectCategoryId,
): EffectDefinition[] {
  const normalized = query.trim().toLocaleLowerCase();
  return listEffectDefinitions().filter((definition) => {
    if (categoryId && definition.categoryId !== categoryId) return false;
    if (!normalized) return true;
    return [definition.displayName, definition.description, ...definition.tags].some((value) =>
      value.toLocaleLowerCase().includes(normalized),
    );
  });
}
