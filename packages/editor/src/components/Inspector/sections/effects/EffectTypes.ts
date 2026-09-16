/**
 * EffectTypes — types, option catalogs, elevation presets, and helper utilities
 * for the Layer Effects inspector.
 */
import type {
  BlendMode,
  Effect,
  FrameNode,
  GroupNode,
  ManagedColor,
  PathNode,
  RasterLayerNode,
  SceneNode,
  ShapeNode,
  TableNode,
  TextNode,
} from '@varve/scene';
import { canHaveLayerEffects, layerEffectStage } from '@varve/scene';
import { managedColorToRgba } from '@varve/shared';
import type { IconName } from '@varve/ui';

export type EffectNode =
  | ShapeNode
  | TextNode
  | FrameNode
  | GroupNode
  | TableNode
  | PathNode
  | RasterLayerNode;

export function hasEffects(n: SceneNode): n is EffectNode {
  return canHaveLayerEffects(n);
}

export function getEffect(n: SceneNode, i: number): Effect | undefined {
  const sn = n as EffectNode;
  return sn.effects?.[i];
}

export function toSwatchBg(color: ManagedColor): string {
  const [r, g, b, a] = managedColorToRgba(color);
  return `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`;
}

export interface EffectTypeOption {
  value: Effect['type'];
  label: string;
  icon: IconName;
  description: string;
  stage: 'backdrop' | 'content' | 'appearance';
  disabled?: boolean;
}

export interface EffectCategoryGroup {
  id: string;
  label: string;
  options: EffectTypeOption[];
}

export const EFFECT_CATEGORIES: readonly EffectCategoryGroup[] = [
  {
    id: 'shadows-glows',
    label: 'Shadows & Glows',
    options: [
      {
        value: 'dropShadow',
        label: 'Drop Shadow',
        icon: 'SunDim',
        description: 'Cast an outer shadow behind content',
        stage: 'appearance',
      },
      {
        value: 'innerShadow',
        label: 'Inner Shadow',
        icon: 'CircleDot',
        description: 'Cast an inset shadow inside layer bounds',
        stage: 'appearance',
      },
      {
        value: 'outerGlow',
        label: 'Outer Glow',
        icon: 'Sparkles',
        description: 'Radiate light outwards from silhouette',
        stage: 'appearance',
      },
      {
        value: 'innerGlow',
        label: 'Inner Glow',
        icon: 'Aperture',
        description: 'Soft luminous glow within layer edges',
        stage: 'appearance',
      },
    ],
  },
  {
    id: 'surface-blur',
    label: 'Surface & Blur',
    options: [
      {
        value: 'layerBlur',
        label: 'Layer Blur',
        icon: 'CloudFog',
        description: 'Uniform softness applied across the layer',
        stage: 'content',
      },
      {
        value: 'backgroundBlur',
        label: 'Background Blur',
        icon: 'PanelTop',
        description: 'Blur elements situated behind this layer',
        stage: 'backdrop',
      },
      {
        value: 'gaussianBlur',
        label: 'Gaussian Blur',
        icon: 'CircleDashed',
        description: 'Independent X/Y sigma with boundary modes',
        stage: 'content',
      },
      {
        value: 'depthBlur',
        label: 'Depth Blur',
        icon: 'Disc3',
        description: 'Depth-map driven photographic defocus',
        stage: 'content',
        disabled: true,
      },
    ],
  },
  {
    id: 'blur-gallery',
    label: 'Photographic (Blur Gallery)',
    options: [
      {
        value: 'tiltShiftBlur',
        label: 'Tilt-Shift Blur',
        icon: 'Move3d',
        description: 'Miniaturization effect between sharp bands',
        stage: 'content',
      },
      {
        value: 'irisBlur',
        label: 'Iris Blur',
        icon: 'Scan',
        description: 'Elliptical focus ring with feathering',
        stage: 'content',
      },
      {
        value: 'fieldBlur',
        label: 'Field Blur',
        icon: 'Focus',
        description: 'Multi-pin weighted spatial blur fields',
        stage: 'content',
      },
      {
        value: 'spinBlur',
        label: 'Spin Blur',
        icon: 'Orbit',
        description: 'Rotational motion blur around a pivot',
        stage: 'content',
      },
      {
        value: 'pathBlur',
        label: 'Path Blur',
        icon: 'Workflow',
        description: 'Directional streak along editable spline paths',
        stage: 'content',
      },
    ],
  },
  {
    id: 'stylistic-distort',
    label: 'Stylistic & Distortion',
    options: [
      {
        value: 'glassMaterial',
        label: 'Glass Material',
        icon: 'GlassWater',
        description: 'Physical frosted glass with tint & specular edge',
        stage: 'backdrop',
      },
      {
        value: 'chromaticAberration',
        label: 'Chromatic Aberration',
        icon: 'Rainbow',
        description: 'RGB optical prism channel dispersion',
        stage: 'content',
      },
      {
        value: 'glitch',
        label: 'Glitch',
        icon: 'Zap',
        description: 'Digital horizontal slices, noise & displacement',
        stage: 'content',
      },
    ],
  },
] as const;

export const EFFECT_TYPE_OPTIONS: readonly {
  value: Effect['type'];
  label: string;
  icon?: IconName;
}[] = EFFECT_CATEGORIES.flatMap((cat) =>
  cat.options.map((opt) => ({
    value: opt.value,
    label: opt.label,
    icon: opt.icon,
  })),
);

export interface ElevationPreset {
  id: string;
  label: string;
  badge: string;
  description: string;
  x: number;
  y: number;
  blur: number;
  spread: number;
  opacity: number;
}

export const ELEVATION_PRESETS: readonly ElevationPreset[] = [
  {
    id: 'subtle',
    label: 'Subtle',
    badge: 'E1',
    description: 'Cards, buttons, rest state',
    x: 0,
    y: 1,
    blur: 3,
    spread: 0,
    opacity: 0.1,
  },
  {
    id: 'medium',
    label: 'Medium',
    badge: 'E2',
    description: 'Card hover, dropdown menus',
    x: 0,
    y: 4,
    blur: 8,
    spread: -1,
    opacity: 0.15,
  },
  {
    id: 'raised',
    label: 'Raised',
    badge: 'E3',
    description: 'Floating toolbars, popovers',
    x: 0,
    y: 10,
    blur: 20,
    spread: -3,
    opacity: 0.18,
  },
  {
    id: 'dramatic',
    label: 'Dramatic',
    badge: 'E4',
    description: 'Modals, prominent dialogs',
    x: 0,
    y: 20,
    blur: 32,
    spread: -4,
    opacity: 0.22,
  },
  {
    id: 'ambient',
    label: 'Ambient',
    badge: 'Halo',
    description: 'Soft omnidirectional glow',
    x: 0,
    y: 0,
    blur: 24,
    spread: 2,
    opacity: 0.25,
  },
  {
    id: 'graphic',
    label: 'Graphic',
    badge: 'Hard',
    description: 'Retro brutalist offset',
    x: 4,
    y: 4,
    blur: 0,
    spread: 0,
    opacity: 1.0,
  },
] as const;

export const QUICK_BLUR_PRESETS = [2, 4, 8, 16, 24, 48, 64] as const;

export const BLEND_OPTIONS: { value: BlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'colorDodge', label: 'Color Dodge' },
  { value: 'colorBurn', label: 'Color Burn' },
  { value: 'hardLight', label: 'Hard Light' },
  { value: 'softLight', label: 'Soft Light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'hue', label: 'Hue' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'color', label: 'Color' },
  { value: 'luminosity', label: 'Luminosity' },
];

export function matchingEffectIndex(
  effects: Effect[],
  rowIndex: number,
  reference: Effect | undefined,
  referenceStack: readonly Effect[] = effects,
): number {
  if (!reference) return -1;
  if (reference.id) {
    const byId = effects.findIndex((effect) => effect.id === reference.id);
    if (byId >= 0) return byId;
  }
  const stage = layerEffectStage(reference);
  const ordinal = referenceStack
    .slice(0, rowIndex)
    .filter(
      (effect) => effect.type === reference.type && layerEffectStage(effect) === stage,
    ).length;
  const candidates = effects.filter(
    (effect) => effect.type === reference.type && layerEffectStage(effect) === stage,
  );
  return candidates[ordinal] ? effects.indexOf(candidates[ordinal]!) : -1;
}

export function alignEffectRow(
  node: EffectNode,
  rowIndex: number,
  referenceStack: readonly Effect[],
): EffectNode {
  const effects = node.effects ?? [];
  const targetIndex = matchingEffectIndex(
    effects,
    rowIndex,
    referenceStack[rowIndex],
    referenceStack,
  );
  if (targetIndex < 0) return { ...node, effects: [] };
  if (targetIndex === rowIndex) return node;
  const aligned = [...effects];
  const displaced = aligned[rowIndex] ?? aligned[targetIndex];
  aligned[rowIndex] = aligned[targetIndex]!;
  aligned[targetIndex] = displaced!;
  return { ...node, effects: aligned };
}
