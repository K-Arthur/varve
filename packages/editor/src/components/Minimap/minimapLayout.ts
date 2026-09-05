/**
 * Minimap layout engine — canonical document-bounds calculation and
 * minimap-to-world coordinate transforms.
 *
 * Single source of truth for the minimap's spatial model. All rendering,
 * navigation, and hit-testing imports from here instead of duplicating math.
 *
 * Design decisions:
 * - Recursive DFS traversal of the scene tree (not just rootChildren).
 * - Exceptional objects are flagged for discovery but remain in the overview;
 *   the minimap never silently hides legitimate pasteboard content.
 * - Groups use the union of their children's world bounds (not a hardcoded box).
 * - Frames, shapes, text, images, adjustments, and raster layers all have
 *   proper bounds via nodeWorldBounds from the canonical world module.
 * - Layout is a pure function of (doc, activePageId, options) and returns
 *   a immutable snapshot that the renderer consumes.
 */

import {
  buildParentIndexMap,
  buildPlacedScene,
  type Document,
  multipageRootNodes,
  type NodeId,
  type SceneNode,
} from '@varve/scene';
import {
  type Camera,
  computeFloatingOrigin,
  type Point,
  type Rect,
  screenToWorld,
  type Viewport,
  worldToScreen,
} from '@varve/shared';
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
  /** Union of all entry and page bounds. */
  contentBounds: Rect;
  /** Entries whose scale is exceptional relative to their siblings. */
  outliers: MinimapEntry[];
  /** Placed publishing pages visible in the overview. */
  pages: MinimapPage[];
  /** Number of total nodes traversed. */
  totalNodes: number;
}

/** A publishing page outline. Pages are not selectable scene objects. */
export interface MinimapPage {
  id: NodeId;
  name: string;
  bounds: Rect;
  active: boolean;
}

/** Options for computing the minimap layout. */
export interface MinimapLayoutOptions {
  /** If true, include hidden nodes as dim outlines. Default: false. */
  includeHidden?: boolean;
  /** If true, include locked nodes. Default: true. */
  includeLocked?: boolean;
  /** Maximum depth to traverse. Infinity = unlimited. Default: Infinity. */
  maxDepth?: number;
  /** Outlier multiplier used for diagnostics/markers. Default: 100. */
  outlierFactor?: number;
  /** Overview scope. The rendered canvas is the default. */
  scope?: 'canvas' | 'activePage' | 'pasteboard';
  /** Active design canvas, or null to force publishing-pasteboard traversal. */
  designCanvasId?: NodeId | null;
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

/** The exact visible canvas footprint projected into minimap CSS pixels. */
export interface MinimapFootprint {
  /** Four corners in clockwise screen order, expressed in minimap CSS px. */
  points: Point[];
  /** AABB retained for diagnostics and coarse hit testing. */
  bounds: Rect;
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

const MAX_MM_WIDTH = 160;
const MAX_MM_HEIGHT = 120;
const CONTENT_PADDING = 24;
const DEGENERATE_WORLD_SIZE = 1;

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
  parentIndex: Map<NodeId, NodeId>,
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

    // Compute world bounds. nodeWorldBounds falls back to an O(n) linear
    // scan (getParent) per call when no parentIndex is passed; called once
    // per node in this recursive traversal, that made the whole minimap
    // rebuild O(n^2) in node count.
    const rawBounds = nodeWorldBounds(doc, id, parentIndex);
    if (!rawBounds) {
      // Containers may have no own geometry, but a container without a
      // computed child union has nothing useful to show in the overview.
      if (node.kind !== 'frame' && node.kind !== 'group') continue;
      if (!('children' in node) || !node.children.length) continue;
    }
    const bounds = normalizeBounds(rawBounds);
    if (!bounds) continue;

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
      collectEntries(doc, children, selectedIds, entries, depth + 1, opts, parentIndex);
    }
  }
}

/** Keep lines and point-like paths discoverable without distorting normal
 * geometry. The one-unit minimum is a display affordance in world units; it
 * is never used for navigation or document bounds outside the minimap. */
function normalizeBounds(bounds: Rect | null): Rect | null {
  if (!bounds) return null;
  if (![bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite)) return null;
  if (bounds.w < 0 || bounds.h < 0) return null;
  return {
    x: bounds.x,
    y: bounds.y,
    w: Math.max(bounds.w, DEGENERATE_WORLD_SIZE),
    h: Math.max(bounds.h, DEGENERATE_WORLD_SIZE),
  };
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
    scope: 'canvas',
    designCanvasId: null,
    ...opts,
  };

  // The editor renderer uses the shared multipage scene. Traversing the same
  // roots keeps the minimap and canvas in agreement about page placement,
  // pasteboard objects, globals, and design-canvas ownership.
  const placedScene = buildPlacedScene(doc);
  const resolvedDesignCanvasId =
    options.scope === 'activePage' || options.scope === 'pasteboard'
      ? null
      : options.designCanvasId;
  let rootIds: NodeId[];
  if (options.scope === 'activePage' && doc.pages?.length && doc.activePageId) {
    const activePage = doc.pages.find((p) => p.id === doc.activePageId);
    rootIds = activePage
      ? [...(doc.globalChildren ?? []), activePage.contentRoot]
      : multipageRootNodes(doc, { designCanvasId: null });
  } else {
    rootIds = multipageRootNodes(doc, { designCanvasId: resolvedDesignCanvasId });
  }

  const entries: MinimapEntry[] = [];
  const parentIndex = buildParentIndexMap(doc);
  collectEntries(doc, rootIds, selectedIds, entries, 0, options, parentIndex);

  // Compute content bounds and detect exceptional scale. Outlier detection is
  // informational only: excluding a legitimate large frame made a distant
  // small object appear navigable while the frame itself disappeared.
  const median = medianArea(entries);
  const outlierThreshold = median * options.outlierFactor;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const outliers: MinimapEntry[] = [];

  for (const entry of entries) {
    const area = entry.bounds.w * entry.bounds.h;
    if (Number.isFinite(area) && area > outlierThreshold && entry.depth === 0) {
      outliers.push(entry);
    }
    if (
      Number.isFinite(entry.bounds.x) &&
      Number.isFinite(entry.bounds.y) &&
      Number.isFinite(entry.bounds.w) &&
      Number.isFinite(entry.bounds.h) &&
      entry.bounds.w >= 0 &&
      entry.bounds.h >= 0
    ) {
      minX = Math.min(minX, entry.bounds.x);
      minY = Math.min(minY, entry.bounds.y);
      maxX = Math.max(maxX, entry.bounds.x + entry.bounds.w);
      maxY = Math.max(maxY, entry.bounds.y + entry.bounds.h);
    }
  }

  // A page itself is visible even when it has no content. Add placed trim
  // boxes to the overview so empty pages and page gaps remain honest.
  const placedPages =
    options.scope === 'activePage'
      ? placedScene.pages.filter((page) => page.page.id === doc.activePageId)
      : resolvedDesignCanvasId === null
        ? placedScene.pages
        : [];
  for (const page of placedPages) {
    minX = Math.min(minX, page.bounds.x);
    minY = Math.min(minY, page.bounds.y);
    maxX = Math.max(maxX, page.bounds.x + page.bounds.w);
    maxY = Math.max(maxY, page.bounds.y + page.bounds.h);
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
    pages: placedPages.map((page) => ({
      id: page.page.id,
      name: page.page.name,
      bounds: page.bounds,
      active: page.page.id === doc.activePageId,
    })),
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
  const safeWidth = Number.isFinite(mmWidth) && mmWidth > 0 ? mmWidth : 1;
  const safeHeight = Number.isFinite(mmHeight) && mmHeight > 0 ? mmHeight : 1;
  if (
    !Number.isFinite(contentBounds.x) ||
    !Number.isFinite(contentBounds.y) ||
    !Number.isFinite(contentBounds.w) ||
    !Number.isFinite(contentBounds.h) ||
    contentBounds.w <= 0 ||
    contentBounds.h <= 0 ||
    !Number.isFinite(mmWidth) ||
    !Number.isFinite(mmHeight) ||
    mmWidth <= 0 ||
    mmHeight <= 0
  ) {
    return {
      scale: 1,
      offsetX: safeWidth / 2,
      offsetY: safeHeight / 2,
      contentBounds,
      mmWidth: safeWidth,
      mmHeight: safeHeight,
    };
  }

  const paddedW = contentBounds.w + padding * 2;
  const paddedH = contentBounds.h + padding * 2;

  const scale = Math.min(mmWidth / paddedW, mmHeight / paddedH) * 0.92;
  if (!Number.isFinite(scale) || scale <= 0) {
    return {
      scale: 1,
      offsetX: safeWidth / 2,
      offsetY: safeHeight / 2,
      contentBounds,
      mmWidth: safeWidth,
      mmHeight: safeHeight,
    };
  }
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
  if (![wx, wy, tf.scale, tf.offsetX, tf.offsetY].every(Number.isFinite)) {
    return { x: tf.mmWidth / 2, y: tf.mmHeight / 2 };
  }
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
  if (!Number.isFinite(tf.scale) || tf.scale <= 0) {
    return { x: tf.contentBounds.x, y: tf.contentBounds.y };
  }
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
  const safeMaxWidth = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : MAX_MM_WIDTH;
  const safeMaxHeight = Number.isFinite(maxHeight) && maxHeight > 0 ? maxHeight : MAX_MM_HEIGHT;
  if (
    ![contentBounds.x, contentBounds.y, contentBounds.w, contentBounds.h].every(Number.isFinite) ||
    contentBounds.w <= 0 ||
    contentBounds.h <= 0
  ) {
    return { width: safeMaxWidth, height: safeMaxHeight };
  }

  const paddedW = contentBounds.w + CONTENT_PADDING * 2;
  const paddedH = contentBounds.h + CONTENT_PADDING * 2;

  if (paddedW <= 0 || paddedH <= 0) {
    return { width: safeMaxWidth, height: safeMaxHeight };
  }

  const aspect = paddedW / paddedH;
  let mmW = safeMaxWidth;
  let mmH = mmW / aspect;
  if (mmH > safeMaxHeight) {
    mmH = safeMaxHeight;
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
  return viewportWorldAabb(
    { pan, zoom, rotation: 0 },
    { width: canvasWidth, height: canvasHeight },
  );
}

/** Compute the viewport indicator rect in minimap-local coordinates. */
export function computeViewportMinimapRect(
  pan: { x: number; y: number },
  zoom: number,
  canvasWidth: number,
  canvasHeight: number,
  tf: MinimapTransform,
): Rect {
  return computeViewportMinimapFootprint(
    { pan, zoom, rotation: 0 },
    { width: canvasWidth, height: canvasHeight },
    tf,
  ).bounds;
}

/** Compute the world-space AABB of the actual canvas corners. */
function viewportWorldAabb(camera: Camera, viewport: Viewport): Rect {
  const corners = viewportCornersToWorld(camera, viewport);
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    w: Math.max(...xs) - minX,
    h: Math.max(...ys) - minY,
  };
}

function viewportCornersToWorld(camera: Camera, viewport: Viewport): Point[] {
  const origin = computeFloatingOrigin(camera, viewport);
  return [
    screenToWorld(camera, 0, 0, viewport, origin),
    screenToWorld(camera, viewport.width, 0, viewport, origin),
    screenToWorld(camera, viewport.width, viewport.height, viewport, origin),
    screenToWorld(camera, 0, viewport.height, viewport, origin),
  ];
}

/** Project the exact four canvas corners into minimap CSS coordinates. */
export function computeViewportMinimapFootprint(
  camera: Camera,
  viewport: Viewport,
  tf: MinimapTransform,
): MinimapFootprint {
  const worldCorners = viewportCornersToWorld(camera, viewport);
  const points = worldCorners.map(([x, y]) => {
    const mm = worldToMinimap(x, y, tf);
    return [mm.x, mm.y] as Point;
  });
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    points,
    bounds: {
      x: minX,
      y: minY,
      w: Math.max(...xs) - minX,
      h: Math.max(...ys) - minY,
    },
  };
}

/** World coordinate at the center of the canvas viewport. */
export function computeViewportWorldCenter(camera: Camera, viewport: Viewport): Point {
  const origin = computeFloatingOrigin(camera, viewport);
  return screenToWorld(camera, viewport.width / 2, viewport.height / 2, viewport, origin);
}

/** Pan that places a world point at the viewport's screen center. */
export function panForViewportCenter(
  camera: Camera,
  viewport: Viewport,
  world: Point,
): { x: number; y: number } {
  const base = worldToScreen({ ...camera, pan: { x: 0, y: 0 } }, world[0], world[1], viewport);
  return {
    x: viewport.width / 2 - base[0],
    y: viewport.height / 2 - base[1],
  };
}

/** Independent point-in-polygon test for the minimap interaction surface. */
export function pointInMinimapFootprint(point: Point, footprint: MinimapFootprint): boolean {
  let inside = false;
  for (let i = 0, j = footprint.points.length - 1; i < footprint.points.length; j = i++) {
    const a = footprint.points[i]!;
    const b = footprint.points[j]!;
    const crosses = a[1] > point[1] !== b[1] > point[1];
    if (crosses && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}
