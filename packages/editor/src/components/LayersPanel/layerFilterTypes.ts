import type { BlendMode, FrameNode, LayerColor, SceneNode } from '@strata/scene';
import { isContainer } from '@strata/scene';

/** Filter by node kind (e.g., 'shape', 'text', 'frame', etc.) */
export type NodeKindFilter = Array<SceneNode['kind'] | 'component'>;

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

function isComponentFrame(node: SceneNode): node is FrameNode {
  return node.kind === 'frame' && node.componentId != null;
}

function hasEffects(node: SceneNode): boolean {
  return ((node as unknown as { effects?: unknown[] }).effects?.length ?? 0) > 0;
}

function hasMask(node: SceneNode): boolean {
  return (node as SceneNode & { mask?: unknown }).mask != null;
}

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
    const effectiveKind: SceneNode['kind'] | 'component' = isComponentFrame(node)
      ? 'component'
      : node.kind;
    if (!filter.kinds.includes(effectiveKind) && !filter.kinds.includes(node.kind)) return false;
  }

  const attr = filter.attributes;
  if (attr.locked !== undefined && node.locked !== attr.locked) return false;
  if (attr.visible !== undefined && node.visible !== attr.visible) return false;
  if (attr.hasChildren !== undefined) {
    const hasCh = isContainer(node) && node.children.length > 0;
    if (hasCh !== attr.hasChildren) return false;
  }
  if (attr.isComponent !== undefined) {
    const isComp = isComponentFrame(node);
    if (isComp !== attr.isComponent) return false;
  }
  if (attr.isInstance !== undefined) {
    const isInst = isComponentFrame(node);
    if (isInst !== attr.isInstance) return false;
  }
  if (attr.hasEffects !== undefined) {
    const hasFx = hasEffects(node);
    if (hasFx !== attr.hasEffects) return false;
  }
  if (attr.isMasked !== undefined) {
    const isMasked = hasMask(node);
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
