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
  assertOccurrencesInScope,
  buildPlacedScene,
  type Document,
  isImageShape,
  multipageRootNodes,
  type NodeId,
  type ResolvedEditorSceneScope,
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
import { occurrenceGeometry } from '../../scene/occurrenceGeometry';
import { committedParentIndex } from '../../scene/parentIndexCache';
import { nodeWorldBounds } from '../../scene/world';

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

/** A single entry in the minimap scene — the simplified representation of one node. */
export interface MinimapEntry {
  /** Qualified occurrence id. */
  id: NodeId;
  /** Authored node id, used for selection state and commands. */
  nodeId?: NodeId;
  kind: SceneNode['kind'];
  /**
   * How this entry is drawn in the overview.
   *
   * Deliberately coarser than `kind`: the overview distinguishes structural
   * containers from content masses, and a 2 px mark cannot carry the full
   * Layers-panel category palette (WCAG 1.4.1 — no colour-only cues). The
   * component/instance split is absent because it needs a document-wide
   * component index; both are frames here.
   */
  paint: MinimapEntryPaint;
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
  /**
   * Whether `name` is worth rendering as a label. Auto-generated names
   * ("Rectangle 3") carry no orientation value and are omitted.
   */
  labelWorthy: boolean;
  /** Depth in the tree (0 = root level). */
  depth: number;
}

/** Overview paint class for one entry. See `MinimapEntry.paint`. */
export type MinimapEntryPaint =
  | 'frame'
  | 'group'
  | 'text'
  | 'image'
  | 'shape'
  | 'ellipse'
  | 'adjustment';

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
  /** Current editor surface represented by this scene, when resolved. */
  surfaceKey?: string;
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
  /** Shared current-surface projection. Preferred for editor minimaps. */
  sceneScope?: ResolvedEditorSceneScope;
  /** Font/placement revision for the shared occurrence-geometry snapshot. */
  geometryRevision?: string | number;
}

type ResolvedMinimapLayoutOptions = Omit<
  Required<MinimapLayoutOptions>,
  'sceneScope' | 'geometryRevision'
> & {
  sceneScope?: ResolvedEditorSceneScope;
  geometryRevision?: string | number;
};

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
/** Floor for the map stage height, so a thin document still has a usable map. */
const MIN_STAGE_HEIGHT = 48;
/** Stage aspect (width ÷ height) used before any document bounds exist. */
const DEFAULT_STAGE_ASPECT = 1.5;

/**
 * Smallest viewfinder rectangle the overview will draw, in CSS px.
 *
 * A high zoom ratio collapses the true projected rectangle to a sub-pixel
 * sliver that cannot be seen or grabbed — the long-standing failure reported
 * against QGIS (`the red overview square is nearly invisible at the statewide
 * scale`) and identified as the scalability limit of zoomable overviews
 * (Chittaro et al., MOBHCI 2008: "the viewfinder may shrink too much in size
 * and make its manipulation more difficult for users"). The drawn rectangle is
 * inflated to this floor, and interaction uses the same inflated polygon plus
 * `VIEWFINDER_HIT_TOLERANCE_PX`, so the effective target is ~34 CSS px and
 * clears WCAG 2.5.8's 24×24 minimum.
 */
export const MIN_VIEWFINDER_CSS_PX = 14;

/** Extra hit area around the drawn viewfinder rectangle, in CSS px. */
const VIEWFINDER_HIT_TOLERANCE_PX = 10;

/**
 * Auto-generated names carry no orientation value. Mirrors the auto-namer's
 * default-name shape (`DEFAULT_NAME_RE` in `intelligence/autoNamer.ts`) but
 * asks a different question — "would this name help someone find the frame?"
 * rather than "is this name still the default?".
 */
const AUTO_GENERATED_NAME_RE =
  /^(?:Rectangle|Rect|Ellipse|Circle|Line|Polygon|Star|Frame|Panel|Group|Text|Image|Adjustment)\s*\d*$/i;

/** Whether a node name is worth spending label pixels on. */
export function isOrientationLabelWorthy(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 2) return false;
  return !AUTO_GENERATED_NAME_RE.test(trimmed);
}

/* -------------------------------------------------------------------------- */
/*  Minimap scene builder                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Overview paint class for a node.
 *
 * Uses the canonical `isImageShape` predicate from `@varve/scene` rather than
 * a local fill test, so the overview agrees with the Layers panel and the
 * Inspector about what an image is.
 */
function minimapPaintFor(node: SceneNode): MinimapEntryPaint {
  switch (node.kind) {
    case 'frame':
      return 'frame';
    case 'group':
      return 'group';
    case 'text':
      return 'text';
    // A table reads as a text mass at overview scale.
    case 'table':
      return 'text';
    case 'rasterLayer':
      return 'image';
    case 'adjustment':
      return 'adjustment';
    case 'shape': {
      // Form wins over hue: an ellipse's silhouette is the single most
      // recognisable thing about it, and drawing its bounding box instead
      // turned every circle into a square.
      if (isEllipseLikeShape(node)) return 'ellipse';
      return isImageShape(node) ? 'image' : 'shape';
    }
    default:
      return isImageShape(node) ? 'image' : 'shape';
  }
}

/** True for shapes the overview draws as an ellipse rather than a box. */
function isEllipseLikeShape(node: SceneNode): boolean {
  if (node.kind !== 'shape') return false;
  const kind = node.shape?.kind;
  return kind === 'ellipse' || kind === 'circle';
}

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
  opts: ResolvedMinimapLayoutOptions,
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
      paint: minimapPaintFor(node),
      bounds: bounds ?? { x: 0, y: 0, w: 0, h: 0 },
      visible: isVisible,
      locked: isLocked,
      isFrame,
      isContainer,
      selected: selectedIds.has(id),
      name: node.name || '',
      labelWorthy: isOrientationLabelWorthy(node.name || ''),
      depth,
    };

    entries.push(entry);

    // Recurse into children
    if (children.length > 0) {
      collectEntries(doc, children, selectedIds, entries, depth + 1, opts, parentIndex);
    }
  }
}

/** Collect minimap entries from the renderer's qualified occurrence snapshot. */
function collectOccurrenceEntries(
  doc: Document,
  occurrences: ResolvedEditorSceneScope['occurrences'],
  selectedIds: Set<NodeId>,
  entries: MinimapEntry[],
  opts: ResolvedMinimapLayoutOptions,
  boundsByInstanceId: ReadonlyMap<string, Rect | null>,
): void {
  for (const occurrence of occurrences) {
    if (occurrence.depth > opts.maxDepth) continue;
    const node = doc.nodes[occurrence.nodeId];
    if (!node) continue;
    const isVisible = node.visible !== false;
    const isLocked = node.locked === true;
    if (!isVisible && !opts.includeHidden) continue;
    if (isLocked && !opts.includeLocked) continue;

    const rawBounds = boundsByInstanceId.get(occurrence.instanceId) ?? null;
    if (!rawBounds && node.kind !== 'frame' && node.kind !== 'group') continue;
    const bounds = normalizeBounds(rawBounds);
    if (!bounds) continue;

    const isFrame = node.kind === 'frame';
    const isContainer = isFrame || node.kind === 'group';
    entries.push({
      id: occurrence.instanceId,
      nodeId: occurrence.nodeId,
      kind: node.kind,
      paint: minimapPaintFor(node),
      bounds,
      visible: isVisible,
      locked: isLocked,
      isFrame,
      isContainer,
      selected: selectedIds.has(occurrence.nodeId),
      name: node.name || '',
      labelWorthy: isOrientationLabelWorthy(node.name || ''),
      depth: occurrence.depth,
    });
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
  const options: ResolvedMinimapLayoutOptions = {
    includeHidden: false,
    includeLocked: true,
    maxDepth: Infinity,
    outlierFactor: 100,
    scope: 'canvas',
    designCanvasId: null,
    ...opts,
  };

  // The editor renderer uses the shared occurrence snapshot. Traversing the
  // same snapshot keeps the minimap and canvas in agreement about page
  // placement, Design Canvas ownership, visibility, isolation, and masters.
  const placedScene = buildPlacedScene(doc);
  const resolvedDesignCanvasId =
    options.scope === 'activePage' || options.scope === 'pasteboard'
      ? null
      : options.designCanvasId;
  const entries: MinimapEntry[] = [];
  if (options.sceneScope) {
    const geometry = occurrenceGeometry(doc, options.sceneScope, {
      revision: options.geometryRevision ?? 0,
    });
    collectOccurrenceEntries(
      doc,
      options.sceneScope.occurrences,
      selectedIds,
      entries,
      options,
      geometry.boundsByInstanceId,
    );
    assertOccurrencesInScope(
      options.sceneScope,
      entries.map((entry) => entry.id),
    );
  } else {
    const parentIndex = committedParentIndex(doc);
    let rootIds: NodeId[];
    if (options.scope === 'activePage' && doc.pages?.length && doc.activePageId) {
      const activePage = doc.pages.find((p) => p.id === doc.activePageId);
      rootIds = activePage
        ? [...(doc.globalChildren ?? []), activePage.contentRoot]
        : multipageRootNodes(doc, { designCanvasId: null });
    } else {
      rootIds = multipageRootNodes(doc, { designCanvasId: resolvedDesignCanvasId });
    }
    collectEntries(doc, rootIds, selectedIds, entries, 0, options, parentIndex);
  }

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
  const placedPages = options.sceneScope
    ? options.sceneScope.context.base.kind === 'publishing'
      ? placedScene.pages
      : []
    : options.scope === 'activePage'
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
    ...(options.sceneScope ? { surfaceKey: options.sceneScope.surfaceKey } : {}),
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

/**
 * Compute the map **stage** size for a document.
 *
 * The stage fills the available width and takes its height from the content
 * aspect, clamped to `maxHeight`. Previous behaviour shrank the canvas to hug
 * the content instead, which left roughly half of the panel card empty on a
 * normal sidebar (a 120 px map inside a 302 px card) while the card's border
 * still claimed the whole area. A stage that tracks the content aspect keeps
 * the map's own framing honest without wasting the width.
 */
export function computeMinimapSize(
  contentBounds: Rect,
  maxWidth: number = MAX_MM_WIDTH,
  maxHeight: number = MAX_MM_HEIGHT,
): { width: number; height: number } {
  const safeMaxWidth = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : MAX_MM_WIDTH;
  const safeMaxHeight = Number.isFinite(maxHeight) && maxHeight > 0 ? maxHeight : MAX_MM_HEIGHT;

  const usable =
    [contentBounds.x, contentBounds.y, contentBounds.w, contentBounds.h].every(Number.isFinite) &&
    contentBounds.w > 0 &&
    contentBounds.h > 0;

  const paddedW = contentBounds.w + CONTENT_PADDING * 2;
  const paddedH = contentBounds.h + CONTENT_PADDING * 2;
  const aspect = usable && paddedW > 0 && paddedH > 0 ? paddedW / paddedH : DEFAULT_STAGE_ASPECT;

  const height = Math.min(safeMaxHeight, safeMaxWidth / aspect);
  return {
    width: safeMaxWidth,
    height: Math.max(MIN_STAGE_HEIGHT, Number.isFinite(height) ? height : safeMaxHeight),
  };
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

/**
 * Scale a footprint about its centroid. Preserves the projected quad's shape
 * and rotation, unlike growing an axis-aligned box.
 */
function scaleFootprint(footprint: MinimapFootprint, scale: number): MinimapFootprint {
  const factor = Number.isFinite(scale) && scale > 0 ? scale : 1;
  if (factor === 1) return footprint;
  const cx = footprint.bounds.x + footprint.bounds.w / 2;
  const cy = footprint.bounds.y + footprint.bounds.h / 2;
  const points = footprint.points.map(
    ([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor] as Point,
  );
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    points,
    bounds: { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY },
  };
}

/**
 * Grow a footprint until its bounding box is at least `minPx` on both axes.
 *
 * This is the minimum *drawn* size of the viewport rectangle. The renderer and
 * the interaction surface both consume the inflated polygon, so the rectangle
 * a user sees as grabbable is the rectangle that is grabbable.
 */
export function inflateFootprintToMinimum(
  footprint: MinimapFootprint,
  minPx: number,
): MinimapFootprint {
  const { w, h } = footprint.bounds;
  if (!Number.isFinite(w) || !Number.isFinite(h) || minPx <= 0) return footprint;
  const needed = Math.max(w > 0 ? minPx / w : 1, h > 0 ? minPx / h : 1);
  // The relative float guard keeps the floor exact: scaling points about a
  // centroid loses low-order bits, which otherwise lands a hair under the
  // floor (13.99999999999996 for a 14 px minimum).
  const scale = Math.max(1, needed * (1 + 1e-12));
  return scaleFootprint(footprint, scale);
}

/**
 * The interaction surface for the viewport rectangle: the drawn minimum-size
 * polygon plus a pointer tolerance, which lifts the effective target above
 * WCAG 2.5.8's 24×24 CSS px minimum even at the minimum drawn size.
 */
export function expandFootprintForHitTest(
  footprint: MinimapFootprint,
  padPx: number = VIEWFINDER_HIT_TOLERANCE_PX,
): MinimapFootprint {
  const drawn = inflateFootprintToMinimum(footprint, MIN_VIEWFINDER_CSS_PX);
  const { w, h } = drawn.bounds;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return drawn;
  return scaleFootprint(drawn, Math.max((w + padPx * 2) / w, (h + padPx * 2) / h));
}

/** Clip a convex polygon to an axis-aligned rectangle (Sutherland–Hodgman). */
function clipPointsToRect(points: Point[], x: number, y: number, w: number, h: number): Point[] {
  const edges: Array<{
    inside: (point: Point) => boolean;
    intersect: (a: Point, b: Point) => Point;
  }> = [
    {
      inside: ([px]) => px >= x,
      intersect: (a, b) => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])],
    },
    {
      inside: ([px]) => px <= x + w,
      intersect: (a, b) => [x + w, a[1] + ((b[1] - a[1]) * (x + w - a[0])) / (b[0] - a[0])],
    },
    {
      inside: ([, py]) => py >= y,
      intersect: (a, b) => [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]), y],
    },
    {
      inside: ([, py]) => py <= y + h,
      intersect: (a, b) => [a[0] + ((b[0] - a[0]) * (y + h - a[1])) / (b[1] - a[1]), y + h],
    },
  ];

  let output = points;
  for (const edge of edges) {
    const input = output;
    if (input.length === 0) return [];
    output = [];
    for (let i = 0; i < input.length; i++) {
      const current = input[i]!;
      const previous = input[(i + input.length - 1) % input.length]!;
      const currentInside = edge.inside(current);
      const previousInside = edge.inside(previous);
      if (currentInside) {
        if (!previousInside) output.push(edge.intersect(previous, current));
        output.push(current);
      } else if (previousInside) {
        output.push(edge.intersect(previous, current));
      }
    }
  }
  return output;
}

/**
 * The portion of a footprint that is inside the map stage.
 *
 * Returns `null` when the viewport misses the stage entirely, which the
 * renderer turns into a "you are off the map" pointer instead of a stray
 * outline. Clamping matters: while panning near a document's edge the true
 * projected rectangle runs off the map, and its surviving half is two bare
 * lines through the artwork rather than a recognisable viewfinder.
 */
export function clipFootprintToStage(
  footprint: MinimapFootprint,
  stageWidth: number,
  stageHeight: number,
): MinimapFootprint | null {
  if (!Number.isFinite(stageWidth) || !Number.isFinite(stageHeight)) return footprint;
  const points = clipPointsToRect(
    footprint.points,
    0,
    0,
    Math.max(1, stageWidth),
    Math.max(1, stageHeight),
  );
  if (points.length < 3) return null;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    points,
    bounds: { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY },
  };
}
