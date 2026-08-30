import { getFilterProperties } from './adjustmentPipeline';
import { getEffectContract } from './effectContract';
import {
  ADJUSTMENT_KINDS,
  type AdjustmentKind,
  adjustmentDefaults,
  filterKindDisplayName,
  isKnownAdjustmentKind,
} from './filters';

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

  return {
    id: kind,
    schemaVersion: 1,
    displayNameKey: `effect.${kind}.name`,
    descriptionKey: `effect.${kind}.description`,
    displayName: name,
    description,
    categoryId,
    tags,
    supportedTargets: ['shape', 'text', 'path', 'frame', 'group', 'rasterLayer'],
    supportedScopes: ['object', 'adjustment-layer'],
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
