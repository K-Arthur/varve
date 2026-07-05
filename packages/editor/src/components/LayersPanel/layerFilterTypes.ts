import type { BlendMode, LayerColor, SceneNode } from '@strata/scene';

/** Filter by node kind (e.g., 'shape', 'text', 'frame', etc.) */
export type NodeKindFilter = SceneNode['kind'][];

/** Filter by attribute state */
export interface AttributeFilter {
  locked?: boolean;
  visible?: boolean;
  hasChildren?: boolean;
  isComponent?: boolean;
  isInstance?: boolean;
  hasEffects?: boolean;
  isMasked?: boolean;
  /** Filter nodes by their color tag value (or null for uncolored). */
  layerColor?: LayerColor;
}

/** Filter by blend mode */
export type BlendModeFilter = BlendMode[];

/** Combined layer filter specification */
export interface LayerFilterSpec {
  /** Search text (name filter) */
  search: string;
  /** Filter by node kinds */
  kinds: NodeKindFilter;
  /** Filter by attribute states */
  attributes: AttributeFilter;
  /** Filter by blend mode */
  blendModes: BlendModeFilter;
}

export const DEFAULT_FILTER: LayerFilterSpec = {
  search: '',
  kinds: [],
  attributes: {},
  blendModes: [],
};

/** Returns true when at least one filter dimension is active. */
export function isFiltering(spec: LayerFilterSpec): boolean {
  return (
    spec.search !== '' ||
    spec.kinds.length > 0 ||
    Object.values(spec.attributes).some((v) => v !== undefined) ||
    spec.blendModes.length > 0
  );
}

/** Check if a node matches the filter specification */
export function nodeMatchesFilter(node: SceneNode, filter: LayerFilterSpec): boolean {
  if (filter.search) {
    const term = filter.search.toLowerCase();
    if (!node.name.toLowerCase().includes(term)) return false;
  }

  if (filter.kinds.length > 0) {
    const effectiveKind =
      node.kind === 'frame' && 'componentId' in node && (node as any).componentId != null
        ? 'component'
        : node.kind;
    if (!filter.kinds.includes(effectiveKind as any) && !filter.kinds.includes(node.kind))
      return false;
  }

  const attr = filter.attributes;
  if (attr.locked !== undefined && node.locked !== attr.locked) return false;
  if (attr.visible !== undefined && node.visible !== attr.visible) return false;
  if (attr.hasChildren !== undefined) {
    const hasCh = 'children' in node && (node as any).children?.length > 0;
    if (hasCh !== attr.hasChildren) return false;
  }
  if (attr.isComponent !== undefined) {
    const isComp =
      node.kind === 'frame' && 'componentId' in node && (node as any).componentId != null;
    if (isComp !== attr.isComponent) return false;
  }
  if (attr.isInstance !== undefined) {
    const isInst =
      node.kind === 'frame' && 'componentId' in node && (node as any).componentId != null;
    if (isInst !== attr.isInstance) return false;
  }
  if (attr.hasEffects !== undefined) {
    const hasFx = 'effects' in node && (node as any).effects?.length > 0;
    if (hasFx !== attr.hasEffects) return false;
  }
  if (attr.isMasked !== undefined) {
    const isMasked = 'mask' in node && (node as any).mask != null;
    if (isMasked !== attr.isMasked) return false;
  }
  if (attr.layerColor !== undefined) {
    if (node.layerColor !== attr.layerColor) return false;
  }

  if (filter.blendModes.length > 0) {
    if (!filter.blendModes.includes(node.blendMode!)) return false;
  }

  return true;
}
