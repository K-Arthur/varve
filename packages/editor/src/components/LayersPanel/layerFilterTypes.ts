import type { BlendMode, Document, FrameNode, LayerColor, NodeId, SceneNode } from '@varve/scene';
import { isContainer } from '@varve/scene';

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
  /** Email: `emailSemantics.nodes[id].hideOnMobile === true`. */
  mobileHidden?: boolean;
  /** Email: `emailSemantics.nodes[id].hideOnDesktop === true`. */
  mobileOnly?: boolean;
  /** Print: a text node bound to a story thread (`storyBinding`). */
  threadedText?: boolean;
  /** Print/Codegen: a frame with `frameRole === 'exportRegion'`. */
  exportRegion?: boolean;
  /** Motion: the node has keyframes or animated media. Requires a match-id set. */
  animated?: boolean;
}

/** Filter by blend mode */
export type BlendModeFilter = BlendMode[];

/**
 * Extra inputs a filter predicate cannot read from the node alone.
 * `doc` is required for document-scoped semantics (email metadata); the
 * animated id set is computed once per document revision by the caller so the
 * predicate stays O(1) per node.
 */
export interface NodeFilterContext {
  doc?: Document;
  animatedIds?: ReadonlySet<NodeId>;
}

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

/**
 * Every dimension of a filter except the name search.
 *
 * Shared by the index-backed search path and the direct predicate so the two
 * can never drift: `flattenTree` previously carried its own copy of this
 * logic, which meant a new attribute had to be added in two places.
 */
export function nodeMatchesNonSearch(
  node: SceneNode,
  filter: LayerFilterSpec,
  ctx: NodeFilterContext = {},
): boolean {
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
  if (attr.layerColor !== undefined && node.layerColor !== attr.layerColor) return false;

  // Email semantics live on the document, not the node.
  if (attr.mobileHidden !== undefined) {
    const meta = ctx.doc?.emailSemantics?.nodes?.[node.id];
    if ((meta?.hideOnMobile === true) !== attr.mobileHidden) return false;
  }
  if (attr.mobileOnly !== undefined) {
    const meta = ctx.doc?.emailSemantics?.nodes?.[node.id];
    if ((meta?.hideOnDesktop === true) !== attr.mobileOnly) return false;
  }

  // Print stories: threaded text frames reference a document story.
  if (attr.threadedText !== undefined) {
    const threaded = node.kind === 'text' && node.storyBinding?.storyId != null;
    if (threaded !== attr.threadedText) return false;
  }

  // Export regions are frames the author marked for output.
  if (attr.exportRegion !== undefined) {
    const isRegion = node.kind === 'frame' && node.frameRole === 'exportRegion';
    if (isRegion !== attr.exportRegion) return false;
  }

  // Motion: membership comes from a caller-computed id set (one per revision).
  if (attr.animated !== undefined) {
    const animated = ctx.animatedIds?.has(node.id) === true;
    if (animated !== attr.animated) return false;
  }

  if (filter.blendModes.length > 0) {
    if (!filter.blendModes.includes(node.blendMode!)) return false;
  }

  return true;
}

/** Check if a node matches the filter specification */
export function nodeMatchesFilter(
  node: SceneNode,
  filter: LayerFilterSpec,
  ctx: NodeFilterContext = {},
): boolean {
  if (filter.search) {
    const term = filter.search.toLowerCase();
    if (!node.name.toLowerCase().includes(term)) return false;
  }
  return nodeMatchesNonSearch(node, filter, ctx);
}
