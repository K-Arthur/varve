/**
 * Minimap layout engine — canonical document-bounds calculation and
 * minimap-to-world coordinate transforms.
 *
 * Single source of truth for the minimap's spatial model. All rendering,
 * navigation, and hit-testing imports from here instead of duplicating math.
 *
 * Design decisions:
 * - Recursive DFS traversal of the scene tree (not just rootChildren).
 * - Outlier culling: objects > 100× the median bounds are excluded from the
 *   overview and flagged, so a single distant object doesn't shrink everything.
 * - Groups use the union of their children's world bounds (not a hardcoded box).
 * - Frames, shapes, text, images, adjustments, and raster layers all have
 *   proper bounds via nodeWorldBounds from the canonical world module.
 * - Layout is a pure function of (doc, activePageId, options) and returns
 *   a immutable snapshot that the renderer consumes.
 */

import type { Document, NodeId, SceneNode } from '@strata/scene';
import type { Rect } from '@strata/shared';
import { nodeWorldBounds } from '../../scene/world';

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

/** A single entry in the minimap scene — the simplified representation of one node. */
export interface MinimapEntry {
  id: NodeId;
  kind: SceneNode['kind'];
  /** World-space axis-aligned bounding box. */
  bounds: Rect;
  /** Whether the node is visible in the scene. */
  visible: boolean;
  /** Whether the node is locked. */
  locked: boolean;
  /** Whether the node is a frame (used for visual differentiation). */
  isFrame: boolean;
  /** Whether the node has children (for expand indicator). */
  isContainer: boolean;
  /** Whether the node is selected. */
  selected: boolean;
  /** Node name for labels / tooltips. */
  name: string;
  /** Depth in the tree (0 = root level). */
  depth: number;
}

/** The full minimap scene — a snapshot of all renderable entries plus layout metadata. */
export interface MinimapScene {
  /** All entries, sorted in paint order (depth-first). */
  entries: MinimapEntry[];
  /** Union of all entry bounds (after outlier culling). */
  contentBounds: Rect;
  /** Outlier entries that were excluded from contentBounds. */
  outliers: MinimapEntry[];
  /** Number of total nodes traversed. */
  totalNodes: number;
}

/** Options for computing the minimap layout. */
export interface MinimapLayoutOptions {
  /** If true, include hidden nodes as dim outlines. Default: false. */
  includeHidden?: boolean;
  /** If true, include locked nodes. Default: true. */
  includeLocked?: boolean;
  /** Maximum depth to traverse. Infinity = unlimited. Default: Infinity. */
  maxDepth?: number;
  /** Outlier multiplier: nodes whose area > median × this are excluded. Default: 100. */
  outlierFactor?: number;
}

/** The minimap's transform state: maps world coords to minimap-local coords. */
export interface MinimapTransform {
  /** Scale factor: world units → minimap pixels. */
  scale: number;
  /** X offset in minimap pixels to add after scaling. */
  offsetX: number;
  /** Y offset in minimap pixels to add after scaling. */
  offsetY: number;
  /** Content bounds in world space (may be padded). */
  contentBounds: Rect;
  /** Minimap canvas CSS width. */
  mmWidth: number;
  /** Minimap canvas CSS height. */
  mmHeight: number;
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

const MAX_MM_WIDTH = 160;
const MAX_MM_HEIGHT = 120;
const CONTENT_PADDING = 24;
const OUTLIER_MIN_AREA = 1e8;

/* -------------------------------------------------------------------------- */
/*  Minimap scene builder                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Recursively collect minimap entries from a node subtree.
 * Uses nodeWorldBounds for proper world-space bounds including transforms.
 */
function collectEntries(
  doc: Document,
  nodeIds: NodeId[],
  selectedIds: Set<NodeId>,
  entries: MinimapEntry[],
  depth: number,
  opts: Required<MinimapLayoutOptions>,
): void {
  for (const id of nodeIds) {
    const node = doc.nodes[id];
    if (!node) continue;

    if (depth > opts.maxDepth) continue;

    const isVisible = node.visible !== false;
    const isLocked = node.locked === true;

    // Filter hidden nodes unless opted in
    if (!isVisible && !opts.includeHidden) continue;
    if (isLocked && !opts.includeLocked) continue;

    // Compute world bounds
    const bounds = nodeWorldBounds(doc, id);
    if (!bounds || bounds.w === 0 || bounds.h === 0) {
      // Skip zero-area nodes (e.g. adjustment nodes with no geometry)
      // unless they're containers — containers may have children
      if (node.kind !== 'frame' && node.kind !== 'group') continue;
      // For containers with no computed bounds, skip if they have no children
      if (node.kind === 'group' && (!('children' in node) || !node.children.length)) continue;
      if (node.kind === 'frame' && (!('children' in node) || !node.children.length)) continue;
    }

    const isFrame = node.kind === 'frame';
    const isContainer = isFrame || node.kind === 'group';
    const children =
      isContainer && 'children' in node ? (node as { children: NodeId[] }).children : [];

    const entry: MinimapEntry = {
      id,
      kind: node.kind,
      bounds: bounds ?? { x: 0, y: 0, w: 0, h: 0 },
      visible: isVisible,
      locked: isLocked,
      isFrame,
      isContainer,
      selected: selectedIds.has(id),
      name: node.name || '',
      depth,
    };

    entries.push(entry);

    // Recurse into children
    if (children.length > 0) {
      collectEntries(doc, children, selectedIds, entries, depth + 1, opts);
    }
  }
}

/**
 * Compute the median area of all entries for outlier detection.
 */
function medianArea(entries: MinimapEntry[]): number {
  if (entries.length === 0) return 1;
  const areas = entries
    .filter((e) => e.bounds.w > 0 && e.bounds.h > 0)
    .map((e) => e.bounds.w * e.bounds.h)
    .sort((a, b) => a - b);
  if (areas.length === 0) return 1;
  return areas[Math.floor(areas.length / 2)] || 1;
}

/**
 * Build a complete minimap scene from the document.
 *
 * Traverses the active page's content (or all rootChildren if no page model),
 * computes world-space bounds for every node, detects outliers, and returns
 * a snapshot the renderer can consume.
 */
export function buildMinimapScene(
  doc: Document,
  selectedIds: Set<NodeId>,
  opts: MinimapLayoutOptions = {},
): MinimapScene {
  const options: Required<MinimapLayoutOptions> = {
    includeHidden: false,
    includeLocked: true,
    maxDepth: Infinity,
    outlierFactor: 100,
    ...opts,
  };

  // Determine which root IDs to traverse
  let rootIds: NodeId[];
  if (doc.pages && doc.pages.length > 0 && doc.activePageId) {
    const activePage = doc.pages.find((p) => p.id === doc.activePageId);
    if (activePage) {
      // Use the active page's contentRoot + globalChildren
      rootIds = [...(doc.globalChildren ?? []), activePage.contentRoot];
    } else {
      rootIds = doc.rootChildren;
    }
  } else {
    rootIds = doc.rootChildren;
  }

  const entries: MinimapEntry[] = [];
  collectEntries(doc, rootIds, selectedIds, entries, 0, options);

  // Compute content bounds and detect outliers
  const median = medianArea(entries);
  const outlierThreshold = median * options.outlierFactor;
  const outlierMinArea = Math.max(outlierThreshold, OUTLIER_MIN_AREA);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const outliers: MinimapEntry[] = [];

  for (const entry of entries) {
    const area = entry.bounds.w * entry.bounds.h;
    if (area > outlierMinArea && entry.depth === 0) {
      outliers.push(entry);
      continue;
    }
    if (entry.bounds.w > 0 && entry.bounds.h > 0) {
      minX = Math.min(minX, entry.bounds.x);
      minY = Math.min(minY, entry.bounds.y);
      maxX = Math.max(maxX, entry.bounds.x + entry.bounds.w);
      maxY = Math.max(maxY, entry.bounds.y + entry.bounds.h);
    }
  }

  // Empty document fallback
  if (!Number.isFinite(minX)) {
    minX = -200;
    minY = -200;
    maxX = 200;
    maxY = 200;
  }

  return {
    entries,
    contentBounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    outliers,
    totalNodes: Object.keys(doc.nodes).length,
  };
}

/* -------------------------------------------------------------------------- */
/*  Minimap transform computation                                             */
/* -------------------------------------------------------------------------- */

/**
 * Compute the transform that maps world-space coordinates to minimap-local
 * pixel coordinates, given the minimap canvas dimensions and content bounds.
 */
export function computeMinimapTransform(
  contentBounds: Rect,
  mmWidth: number,
  mmHeight: number,
  padding: number = CONTENT_PADDING,
): MinimapTransform {
  if (contentBounds.w <= 0 || contentBounds.h <= 0) {
    return {
      scale: 1,
      offsetX: mmWidth / 2,
      offsetY: mmHeight / 2,
      contentBounds,
      mmWidth,
      mmHeight,
    };
  }

  const paddedW = contentBounds.w + padding * 2;
  const paddedH = contentBounds.h + padding * 2;

  const scale = Math.min(mmWidth / paddedW, mmHeight / paddedH) * 0.92;
  const offsetX = (mmWidth - contentBounds.w * scale) / 2;
  const offsetY = (mmHeight - contentBounds.h * scale) / 2;

  return { scale, offsetX, offsetY, contentBounds, mmWidth, mmHeight };
}

/** Convert a world-space point to minimap-local pixel coordinates. */
export function worldToMinimap(
  wx: number,
  wy: number,
  tf: MinimapTransform,
): { x: number; y: number } {
  return {
    x: tf.offsetX + (wx - tf.contentBounds.x) * tf.scale,
    y: tf.offsetY + (wy - tf.contentBounds.y) * tf.scale,
  };
}

/** Convert a minimap-local pixel coordinate to world-space. */
export function minimapToWorld(
  mmX: number,
  mmY: number,
  tf: MinimapTransform,
): { x: number; y: number } {
  return {
    x: (mmX - tf.offsetX) / tf.scale + tf.contentBounds.x,
    y: (mmY - tf.offsetY) / tf.scale + tf.contentBounds.y,
  };
}

/** Convert a world-space rect to minimap-local pixel coordinates. */
export function worldRectToMinimap(rect: Rect, tf: MinimapTransform): Rect {
  const tl = worldToMinimap(rect.x, rect.y, tf);
  const br = worldToMinimap(rect.x + rect.w, rect.y + rect.h, tf);
  return {
    x: tl.x,
    y: tl.y,
    w: Math.max(br.x - tl.x, 1),
    h: Math.max(br.y - tl.y, 1),
  };
}

/** Compute the minimap canvas dimensions to fit content bounds. */
export function computeMinimapSize(
  contentBounds: Rect,
  maxWidth: number = MAX_MM_WIDTH,
  maxHeight: number = MAX_MM_HEIGHT,
): { width: number; height: number } {
  if (contentBounds.w <= 0 || contentBounds.h <= 0) {
    return { width: maxWidth, height: maxHeight };
  }

  const paddedW = contentBounds.w + CONTENT_PADDING * 2;
  const paddedH = contentBounds.h + CONTENT_PADDING * 2;

  if (paddedW <= 0 || paddedH <= 0) {
    return { width: maxWidth, height: maxHeight };
  }

  const aspect = paddedW / paddedH;
  let mmW = maxWidth;
  let mmH = mmW / aspect;
  if (mmH > maxHeight) {
    mmH = maxHeight;
    mmW = mmH * aspect;
  }

  return { width: Math.max(mmW, 40), height: Math.max(mmH, 30) };
}

/** Compute the viewport indicator rect in world space from camera state. */
export function computeViewportWorldRect(
  pan: { x: number; y: number },
  zoom: number,
  canvasWidth: number,
  canvasHeight: number,
): Rect {
  const vpW = canvasWidth / zoom;
  const vpH = canvasHeight / zoom;
  const x = -pan.x / zoom;
  const y = -pan.y / zoom;
  return {
    x: x === 0 ? 0 : x,
    y: y === 0 ? 0 : y,
    w: vpW,
    h: vpH,
  };
}

/** Compute the viewport indicator rect in minimap-local coordinates. */
export function computeViewportMinimapRect(
  pan: { x: number; y: number },
  zoom: number,
  canvasWidth: number,
  canvasHeight: number,
  tf: MinimapTransform,
): Rect {
  const worldRect = computeViewportWorldRect(pan, zoom, canvasWidth, canvasHeight);
  return worldRectToMinimap(worldRect, tf);
}
