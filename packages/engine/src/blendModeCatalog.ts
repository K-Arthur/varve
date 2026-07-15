/**
 * Research basis: W3C Compositing and Blending Level 1; this product
 * applicability catalog makes each engine blend mode's editable domains and
 * interoperable CSS/PDF names explicit.
 */

import type { BlendMode } from './types';

export type BlendDomain = 'object' | 'group' | 'fill' | 'stroke' | 'effect';

export type BlendCategory =
  | 'normal'
  | 'darken'
  | 'lighten'
  | 'contrast'
  | 'comparative'
  | 'component';

export interface BlendModeDefinition {
  readonly id: BlendMode;
  readonly label: string;
  readonly category: BlendCategory;
  readonly kind: 'blend' | 'group-policy' | 'composite' | 'legacy';
  readonly css: string | null;
  readonly pdf: string | null;
  readonly editableIn: readonly BlendDomain[];
}

const ALL_DOMAINS = ['object', 'group', 'fill', 'stroke', 'effect'] as const;
const PAINT_DOMAINS = ['object', 'fill', 'stroke', 'effect'] as const;

const DEFINITIONS_BY_ID: Readonly<Record<BlendMode, BlendModeDefinition>> = {
  passThrough: {
    id: 'passThrough',
    label: 'Pass Through',
    category: 'normal',
    kind: 'group-policy',
    css: null,
    pdf: null,
    editableIn: ['group'],
  },
  normal: {
    id: 'normal',
    label: 'Normal',
    category: 'normal',
    kind: 'blend',
    css: 'normal',
    pdf: 'Normal',
    editableIn: ALL_DOMAINS,
  },
  multiply: {
    id: 'multiply',
    label: 'Multiply',
    category: 'darken',
    kind: 'blend',
    css: 'multiply',
    pdf: 'Multiply',
    editableIn: ALL_DOMAINS,
  },
  screen: {
    id: 'screen',
    label: 'Screen',
    category: 'lighten',
    kind: 'blend',
    css: 'screen',
    pdf: 'Screen',
    editableIn: ALL_DOMAINS,
  },
  overlay: {
    id: 'overlay',
    label: 'Overlay',
    category: 'contrast',
    kind: 'blend',
    css: 'overlay',
    pdf: 'Overlay',
    editableIn: ALL_DOMAINS,
  },
  darken: {
    id: 'darken',
    label: 'Darken',
    category: 'darken',
    kind: 'blend',
    css: 'darken',
    pdf: 'Darken',
    editableIn: ALL_DOMAINS,
  },
  lighten: {
    id: 'lighten',
    label: 'Lighten',
    category: 'lighten',
    kind: 'blend',
    css: 'lighten',
    pdf: 'Lighten',
    editableIn: ALL_DOMAINS,
  },
  colorDodge: {
    id: 'colorDodge',
    label: 'Color Dodge',
    category: 'lighten',
    kind: 'blend',
    css: 'color-dodge',
    pdf: 'ColorDodge',
    editableIn: ALL_DOMAINS,
  },
  colorBurn: {
    id: 'colorBurn',
    label: 'Color Burn',
    category: 'darken',
    kind: 'blend',
    css: 'color-burn',
    pdf: 'ColorBurn',
    editableIn: ALL_DOMAINS,
  },
  hardLight: {
    id: 'hardLight',
    label: 'Hard Light',
    category: 'contrast',
    kind: 'blend',
    css: 'hard-light',
    pdf: 'HardLight',
    editableIn: ALL_DOMAINS,
  },
  softLight: {
    id: 'softLight',
    label: 'Soft Light',
    category: 'contrast',
    kind: 'blend',
    css: 'soft-light',
    pdf: 'SoftLight',
    editableIn: ALL_DOMAINS,
  },
  difference: {
    id: 'difference',
    label: 'Difference',
    category: 'comparative',
    kind: 'blend',
    css: 'difference',
    pdf: 'Difference',
    editableIn: ALL_DOMAINS,
  },
  exclusion: {
    id: 'exclusion',
    label: 'Exclusion',
    category: 'comparative',
    kind: 'blend',
    css: 'exclusion',
    pdf: 'Exclusion',
    editableIn: ALL_DOMAINS,
  },
  hue: {
    id: 'hue',
    label: 'Hue',
    category: 'component',
    kind: 'blend',
    css: 'hue',
    pdf: 'Hue',
    editableIn: ALL_DOMAINS,
  },
  saturation: {
    id: 'saturation',
    label: 'Saturation',
    category: 'component',
    kind: 'blend',
    css: 'saturation',
    pdf: 'Saturation',
    editableIn: ALL_DOMAINS,
  },
  color: {
    id: 'color',
    label: 'Color',
    category: 'component',
    kind: 'blend',
    css: 'color',
    pdf: 'Color',
    editableIn: ALL_DOMAINS,
  },
  luminosity: {
    id: 'luminosity',
    label: 'Luminosity',
    category: 'component',
    kind: 'blend',
    css: 'luminosity',
    pdf: 'Luminosity',
    editableIn: ALL_DOMAINS,
  },
  plusDarker: {
    id: 'plusDarker',
    label: 'Plus Darker',
    category: 'darken',
    kind: 'legacy',
    css: null,
    pdf: null,
    editableIn: [],
  },
  plusLighter: {
    id: 'plusLighter',
    label: 'Plus Lighter',
    category: 'lighten',
    kind: 'composite',
    css: 'lighter',
    pdf: null,
    editableIn: PAINT_DOMAINS,
  },
};

export const BLEND_MODE_CATALOG: readonly BlendModeDefinition[] = Object.values(DEFINITIONS_BY_ID);

export function blendModeDefinition(id: string): BlendModeDefinition | null {
  if (!Object.hasOwn(DEFINITIONS_BY_ID, id)) return null;
  return DEFINITIONS_BY_ID[id as BlendMode];
}

export function blendModesForDomain(domain: BlendDomain): readonly BlendModeDefinition[] {
  return BLEND_MODE_CATALOG.filter((definition) => definition.editableIn.includes(domain));
}
