import { pageBoundsInWorld } from '@varve/scene';
import type { ResizeHandle, SelectionBox } from '@varve/shared';
import {
  boxSourceFeatures,
  findIsometricSnap,
  type IsometricSnapLock,
  type IsometricSnapTarget,
} from './isometricSnapping';

export type { IsometricSnapLock, IsometricSnapTarget } from './isometricSnapping';

export interface SnapGuide {
  axis: 'horizontal' | 'vertical';
  position: number;
  label?: string;
  distance?: number;
  /** Stable identity of the target that produced this guide. */
  targetId?: string;
  /** Source and target features used by the solver (for feedback/debugging). */
  sourceFeature?: string;
  targetFeature?: string;
  /** The space in which position and correction are expressed. */
  referenceSpace?: 'world';
  /** Signed movement correction applied to the raw proposal on this axis. */
  correction?: number;
  /**
   * World position of a point-target snap (isometric lattice intersections).
   * When present, overlays render a crosshair at this point instead of an
   * axis-aligned line; `axis`/`position` remain a legacy fallback.
   */
  point?: { x: number; y: number };
  type?:
    | 'guide'
    | 'layout-grid'
    | 'edge'
    | 'center'
    | 'midpoint'
    | 'spacing'
    | 'rotation'
    | 'size-match';
}

export interface GridSnapConfig {
  spacingX: number;
  spacingY: number;
  offsetX?: number;
  offsetY?: number;
  /** Rotation in radians around the configured grid origin. */
  rotation?: number;
}

export interface SnapBoxOptions {
  zoom?: number;
  /** Magnetic acquisition tolerance in CSS pixels. */
  tolerancePx?: number;
  otherBounds?: Array<{ x: number; y: number; w: number; h: number }>;
  /** Page, frame, and authored guide lines available to handle snapping. */
  lineTargets?: SnapLineTarget[];
  /** Handle that produced this box. Enables anchor-preserving resize snaps. */
  resizeHandle?: ResizeHandle;
  /** A centred resize has no fixed opposite edge. */
  resizeCentered?: boolean;
  /** Keep the aspect ratio selected by the resize policy while snapping. */
  resizeProportional?: boolean;
  grid?: number | GridSnapConfig;
  layoutGridStep?: number;
  pixelGridSnap?: boolean;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
  /** Structured matches retained for overlays, diagnostics, and invalidation. */
  matches?: SnapMatch[];
}

export interface SnapMatch {
  targetId: string;
  sourceFeature: string;
  targetFeature: string;
  referenceSpace: 'world';
  correction: { x: number; y: number };
  category: NonNullable<SnapGuide['type']>;
}

/** A single world-axis line that a selection edge or centre can acquire. */
export interface SnapLineTarget {
  axis: 'horizontal' | 'vertical';
  position: number;
  id?: string;
  type?: SnapGuide['type'];
}

export interface SnapTarget {
  id: string;
  bounds: { x: number; y: number; w: number; h: number };
  /** Optional hierarchy metadata used to make candidate scope explicit. */
  parentId?: string | null;
}

/** Sticky snap session — tracks active snap locks per axis (hysteresis). */
export interface SnapLock {
  guidePosition: number;
  snappedCoord: number;
  targetId?: string;
  sourceFeature?: string;
  targetFeature?: string;
  type?: SnapGuide['type'];
  referenceSpace?: 'world';
}

export interface SnapSession {
  stickyX: SnapLock | null;
  stickyY: SnapLock | null;
}

export interface SnapOptions {
  /** Current zoom for screen-pixel threshold scaling. Default 1. */
  zoom?: number;
  /** Magnetic acquisition/release tolerance in CSS pixels. */
  tolerancePx?: number;
  /** Prior sticky session for hysteresis. */
  session?: SnapSession | null;
  /** Unsnapped proposal for this sample. Required when a caller retains a corrected box. */
  rawIntent?: { x: number; y: number };
  /** Enable sticky (hysteresis) snap. Default true. */
  sticky?: boolean;
  /** Permanent ruler guides that objects can snap to. */
  guideTargets?: Array<{ axis: 'horizontal' | 'vertical'; position: number; id?: string }>;
  /** Layout grid cell size for frame grid snapping (world units). */
  layoutGridStep?: number;
  /** Authored frame layout-guide line targets in world coordinates. */
  layoutGridTargets?: Array<{ axis: 'horizontal' | 'vertical'; position: number; id?: string }>;
  /** Pixel grid snapping (snaps to integer pixel coordinates). */
  pixelGridSnap?: boolean;
  /**
   * Isometric lattice snapping. Applied as one joint 2-D translation so a
   * multi-object selection keeps its internal arrangement. Competes with the
   * winning Cartesian/guide/object candidates by distance; the closer target
   * wins and exact ties prefer the isometric grid.
   */
  isometric?: IsometricSnapTarget;
}

export const SNAP_RANGE_PX = 200;
export const DEFAULT_SNAP_TOLERANCE_PX = 8;
export const SNAP_TOLERANCE_MIN_PX = 1;
export const SNAP_TOLERANCE_MAX_PX = 32;

export type SnapTargetInput = { x: number; y: number; w: number; h: number } | SnapTarget;

interface NormalizedSnapTarget extends SnapTarget {
  originalIndex: number;
  explicitId: boolean;
}

export function snapTargetSearchRect(
  bounds: { x: number; y: number; w: number; h: number },
  zoom: number,
): { x: number; y: number; w: number; h: number } {
  const padding = SNAP_RANGE_PX / Math.max(0.001, zoom);
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    w: bounds.w + padding * 2,
    h: bounds.h + padding * 2,
  };
}

function resolvedTolerancePx(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_SNAP_TOLERANCE_PX;
  }
  return Math.min(SNAP_TOLERANCE_MAX_PX, Math.max(SNAP_TOLERANCE_MIN_PX, value));
}

function thresholdWorld(zoom: number, tolerancePx = DEFAULT_SNAP_TOLERANCE_PX): number {
  return resolvedTolerancePx(tolerancePx) / Math.max(0.001, zoom);
}

function releaseThresholdWorld(zoom: number, tolerancePx = DEFAULT_SNAP_TOLERANCE_PX): number {
  return thresholdWorld(zoom, tolerancePx) * 1.5;
}

/** Screen-space bounding box of a target (cx, cy, half-extent). */
function screenBounds(
  b: { x: number; y: number; w: number; h: number },
  camera: { zoom: number },
): { cx: number; cy: number; rx: number; ry: number } {
  return {
    cx: (b.x + b.w / 2) * camera.zoom,
    cy: (b.y + b.h / 2) * camera.zoom,
    rx: (b.w / 2) * camera.zoom,
    ry: (b.h / 2) * camera.zoom,
  };
}

function intersect(
  a: ReturnType<typeof screenBounds>,
  b: ReturnType<typeof screenBounds>,
): boolean {
  return (
    Math.abs(a.cx - b.cx) < a.rx + b.rx + SNAP_RANGE_PX &&
    Math.abs(a.cy - b.cy) < a.ry + b.ry + SNAP_RANGE_PX
  );
}

export function filterSnapTargets(
  draggedBounds: { x: number; y: number; w: number; h: number },
  camera: { zoom: number },
  allBounds: Array<{
    nodeId: string;
    bounds: { x: number; y: number; w: number; h: number };
  }>,
  parentIndex: Map<string, string | null>,
  draggedId: string,
  excludedIds?: ReadonlySet<string>,
  movingRootIds?: ReadonlySet<string>,
): Array<{ x: number; y: number; w: number; h: number }> {
  return filterSnapTargetEntries(
    draggedBounds,
    camera,
    allBounds,
    parentIndex,
    draggedId,
    excludedIds,
    movingRootIds,
  ).map((target) => target.bounds);
}

/**
 * Return identity-preserving snap candidates after broad-phase and hierarchy
 * filtering. The public bounds-only wrapper above remains for older tools and
 * tests; movement uses this richer form so a sticky lock can be invalidated
 * when its target changes.
 */
export function filterSnapTargetEntries(
  draggedBounds: { x: number; y: number; w: number; h: number },
  camera: { zoom: number },
  allBounds: Array<{
    nodeId: string;
    bounds: { x: number; y: number; w: number; h: number };
  }>,
  parentIndex: Map<string, string | null>,
  draggedId: string,
  excludedIds?: ReadonlySet<string>,
  movingRootIds?: ReadonlySet<string>,
): SnapTarget[] {
  const draggedParent = parentIndex.get(draggedId) ?? null;
  const draggedScreen = screenBounds(draggedBounds, camera);
  const results: Array<SnapTarget & { priority: number }> = [];
  const movingRoots = new Set(movingRootIds ?? (draggedId ? [draggedId] : []));

  for (const entry of allBounds) {
    // Semantic filter: the dragged object, every sibling moving in the same
    // selection, and any explicitly excluded node can never be a valid target.
    if (excludedIds?.has(entry.nodeId)) continue;
    if (isInMovingHierarchy(entry.nodeId, movingRoots, parentIndex)) continue;
    const targetScreen = screenBounds(entry.bounds, camera);
    if (!intersect(draggedScreen, targetScreen)) continue;
    const targetParent = parentIndex.get(entry.nodeId) ?? null;
    const priority = draggedParent !== null && targetParent === draggedParent ? 0 : 1;
    results.push({
      id: entry.nodeId,
      bounds: entry.bounds,
      parentId: targetParent,
      priority,
    });
  }

  results.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  return results.map(({ priority: _, ...target }) => target);
}

function isInMovingHierarchy(
  nodeId: string,
  movingRoots: ReadonlySet<string>,
  parentIndex: Map<string, string | null>,
): boolean {
  if (movingRoots.has(nodeId)) return true;

  // Exclude descendants: their bounds move with the selected root and are
  // self-referential snap targets. Also exclude ancestors because a frame's
  // aggregate bounds may depend on the moving child. Explicit frame/page
  // references are added separately by the canvas integration.
  let cursor: string | null = nodeId;
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    if (movingRoots.has(cursor)) return true;
    cursor = parentIndex.get(cursor) ?? null;
  }

  for (const root of movingRoots) {
    let child: string | null = root;
    const visitedRoot = new Set<string>();
    while (child && !visitedRoot.has(child)) {
      visitedRoot.add(child);
      const parent = parentIndex.get(child) ?? null;
      if (parent === nodeId) return true;
      child = parent;
    }
  }
  return false;
}

function isSnapTarget(value: SnapTargetInput): value is SnapTarget {
  return 'id' in value && 'bounds' in value && typeof value.id === 'string';
}

function normalizeSnapTargets(targets: SnapTargetInput[]): NormalizedSnapTarget[] {
  const normalized = targets.map((target, originalIndex) => {
    if (isSnapTarget(target)) {
      return { ...target, originalIndex, explicitId: true };
    }
    return {
      id: `legacy:${originalIndex}`,
      bounds: target,
      originalIndex,
      explicitId: false,
    };
  });

  // Preserve legacy array order for callers that do not provide identity, but
  // make identity-bearing candidates independent of spatial-index iteration
  // order. This gives the same document/settings/intent a deterministic winner
  // when coincident targets are returned in a different order.
  const hasExplicitIdentity = normalized.some((target) => target.explicitId);
  if (hasExplicitIdentity) {
    normalized.sort(
      (a, b) =>
        Number(!a.explicitId) - Number(!b.explicitId) ||
        a.id.localeCompare(b.id) ||
        a.originalIndex - b.originalIndex,
    );
  }
  return normalized;
}

function snapLockForGuide(guide: SnapGuide, snappedCoord: number): SnapLock {
  return {
    guidePosition: guide.position,
    snappedCoord,
    targetId: guide.targetId,
    sourceFeature: guide.sourceFeature,
    targetFeature: guide.targetFeature,
    type: guide.type,
    referenceSpace: guide.referenceSpace,
  };
}

function lockMatchesGuide(lock: SnapLock, guide: SnapGuide): boolean {
  if (lock.targetId !== undefined || guide.targetId !== undefined) {
    return (
      lock.targetId === guide.targetId &&
      lock.sourceFeature === guide.sourceFeature &&
      lock.targetFeature === guide.targetFeature &&
      lock.guidePosition === guide.position &&
      lock.referenceSpace === guide.referenceSpace
    );
  }
  return (
    lock.guidePosition === guide.position &&
    lock.sourceFeature === guide.sourceFeature &&
    lock.targetFeature === guide.targetFeature &&
    lock.type === guide.type
  );
}

function guideFromLock(axis: 'horizontal' | 'vertical', lock: SnapLock): SnapGuide {
  return {
    axis,
    position: lock.guidePosition,
    targetId: lock.targetId,
    sourceFeature: lock.sourceFeature,
    targetFeature: lock.targetFeature,
    type: lock.type,
    referenceSpace: lock.referenceSpace,
  };
}

function stickyTargetIsInScope(lock: SnapLock, activeTargets: NormalizedSnapTarget[]): boolean {
  const targetId = lock.targetId;
  if (!targetId) return true;
  if (
    targetId.startsWith('grid:') ||
    targetId.startsWith('layout-grid:') ||
    targetId.startsWith('pixel-grid:') ||
    targetId.startsWith('guide:')
  ) {
    return true;
  }
  if (targetId.startsWith('midpoint:')) {
    const ids = targetId.slice('midpoint:'.length).split(':');
    return ids.every((id) => activeTargets.some((target) => target.id === id));
  }
  return activeTargets.some((target) => target.id === targetId);
}

function tryStickyAxis(
  rawIntentCoord: number,
  proposedCoord: number,
  guide: SnapGuide,
  session: SnapSession['stickyX'],
  release: number,
  sticky: boolean,
): { coord: number; session: SnapSession['stickyX']; snapped: boolean } {
  if (sticky && session && lockMatchesGuide(session, guide)) {
    if (Math.abs(rawIntentCoord - session.snappedCoord) < release) {
      return { coord: session.snappedCoord, session, snapped: true };
    }
    return { coord: rawIntentCoord, session: null, snapped: false };
  }
  const lock = snapLockForGuide(guide, proposedCoord);
  return {
    coord: proposedCoord,
    session: lock,
    snapped: true,
  };
}

const SNAP_PRIORITY = {
  grid: 100,
  guide: 90,
  layoutGrid: 85,
  edge: 80,
  center: 70,
  midpoint: 50,
  spacing: 30,
} as const;

function formatSnapValue(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

/** Compete a new snap candidate; returns true if it wins (higher priority or same priority + closer). */
function compete(
  candidatePrio: number,
  candidateDiff: number,
  bestPrio: number,
  bestDiff: number,
): boolean {
  return candidatePrio > bestPrio || (candidatePrio === bestPrio && candidateDiff < bestDiff);
}

/**
 * Binary-search the index whose sorted value is closest to `target`, excluding
 * `exclude`. Ties resolve to the smallest original index, matching the
 * pair-scan iteration order of the canonical O(k²) evaluators this replaces.
 * Returns -1 when the only candidate is the excluded index itself.
 */
function findClosest(sorted: number[], order: number[], target: number, exclude: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  let best = -1;
  let bestDiff = Infinity;
  for (const idx of [lo - 1, lo]) {
    if (idx < 0 || idx >= sorted.length) continue;
    const orig = order[idx]!;
    if (orig === exclude) continue;
    const d = Math.abs(sorted[idx]! - target);
    if (best === -1 || d < bestDiff || (d === bestDiff && orig < order[best]!)) {
      best = idx;
      bestDiff = d;
    }
  }
  return best === -1 ? -1 : order[best]!;
}

/**
 * Find the partner index minimizing |sorted[idx] - target| among entries with
 * value strictly greater than `min` (used for gap snap candidates that must
 * straddle the moving center). Same tie-breaking as {@link findClosest}.
 */
function findClosestGap(
  sorted: number[],
  order: number[],
  target: number,
  exclude: number,
  min: number,
): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= min) lo = mid + 1;
    else hi = mid;
  }
  const start = lo;
  lo = start;
  hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  let best = -1;
  let bestDiff = Infinity;
  for (const idx of [lo - 1, lo]) {
    if (idx < start || idx >= sorted.length) continue;
    const orig = order[idx]!;
    if (orig === exclude) continue;
    const d = Math.abs(sorted[idx]! - target);
    if (best === -1 || d < bestDiff || (d === bestDiff && orig < order[best]!)) {
      best = idx;
      bestDiff = d;
    }
  }
  return best === -1 ? -1 : order[best]!;
}

function snapCoordToGrid(value: number, spacing: number, offset = 0): number {
  if (spacing <= 0) return value;
  return Math.round((value - offset) / spacing) * spacing + offset;
}

function snapPointToRotatedGrid(x: number, y: number, grid: GridSnapConfig): [number, number] {
  const rotation = Number.isFinite(grid.rotation) ? (grid.rotation ?? 0) : 0;
  if (rotation === 0) {
    return [
      snapCoordToGrid(x, grid.spacingX, grid.offsetX ?? 0),
      snapCoordToGrid(y, grid.spacingY, grid.offsetY ?? 0),
    ];
  }
  const originX = grid.offsetX ?? 0;
  const originY = grid.offsetY ?? 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const dx = x - originX;
  const dy = y - originY;
  const localX = dx * cos + dy * sin + originX;
  const localY = -dx * sin + dy * cos + originY;
  const snappedLocalX = snapCoordToGrid(localX, grid.spacingX, originX);
  const snappedLocalY = snapCoordToGrid(localY, grid.spacingY, originY);
  return [
    originX + (snappedLocalX - originX) * cos - (snappedLocalY - originY) * sin,
    originY + (snappedLocalX - originX) * sin + (snappedLocalY - originY) * cos,
  ];
}

interface LineSnapCandidate {
  axis: 'horizontal' | 'vertical';
  position: number;
  distance: number;
  snapped: number;
  guide: SnapGuide;
}

const VERTICAL_SOURCE_FEATURES = ['left', 'centerX', 'right'] as const;
const HORIZONTAL_SOURCE_FEATURES = ['top', 'centerY', 'bottom'] as const;

function closestLineSnapCandidate(
  x: number,
  y: number,
  w: number,
  h: number,
  target: { axis: 'horizontal' | 'vertical'; position: number; id?: string },
  threshold: number,
  type: SnapGuide['type'],
  label: string,
): LineSnapCandidate | null {
  const values =
    target.axis === 'vertical'
      ? ([x, x + w / 2, x + w] as const)
      : ([y, y + h / 2, y + h] as const);
  const sourceFeatures =
    target.axis === 'vertical' ? VERTICAL_SOURCE_FEATURES : HORIZONTAL_SOURCE_FEATURES;
  let bestValue = values[0]!;
  let bestSourceFeature = sourceFeatures[0]!;
  let bestDistance = Math.abs(bestValue - target.position);
  for (let index = 1; index < values.length; index++) {
    const value = values[index]!;
    const distance = Math.abs(value - target.position);
    if (distance < bestDistance) {
      bestValue = value;
      bestSourceFeature = sourceFeatures[index]!;
      bestDistance = distance;
    }
  }
  if (bestDistance >= threshold) return null;
  const metadata = target.id
    ? {
        targetId: target.id,
        sourceFeature: bestSourceFeature,
        targetFeature: type === 'guide' ? 'guide' : (type ?? 'target-line'),
        referenceSpace: 'world' as const,
        correction: -(bestValue - target.position),
      }
    : {};
  return {
    axis: target.axis,
    position: target.position,
    distance: bestDistance,
    snapped:
      target.axis === 'vertical'
        ? x - (bestValue - target.position)
        : y - (bestValue - target.position),
    guide: {
      axis: target.axis,
      position: target.position,
      distance: bestDistance,
      type,
      label,
      ...metadata,
    },
  };
}

export function snapPosition(
  x: number,
  y: number,
  w: number,
  h: number,
  otherBounds: SnapTargetInput[],
  grid?: number | GridSnapConfig,
  snapExcludedIds?: Set<string>,
  options: SnapOptions = {},
): SnapResult & { session: SnapSession; isometricLock?: IsometricSnapLock | null } {
  const zoom = options.zoom ?? 1;
  const sticky = options.sticky !== false;
  const thresh = thresholdWorld(zoom, options.tolerancePx);
  const release = releaseThresholdWorld(zoom, options.tolerancePx);
  let session: SnapSession = options.session ?? { stickyX: null, stickyY: null };

  // `x`/`y` are historically the current proposal. Callers that retain a
  // corrected box during a gesture can provide the raw proposal explicitly;
  // every candidate and hysteresis decision below then uses that intent. This
  // prevents a released lock from being re-acquired from its own correction.
  x = Number.isFinite(options.rawIntent?.x) ? options.rawIntent!.x : x;
  y = Number.isFinite(options.rawIntent?.y) ? options.rawIntent!.y : y;

  const normalizedTargets = normalizeSnapTargets(otherBounds);

  let snappedX = x;
  let snappedY = y;
  const guides: SnapGuide[] = [];

  const activeTargets =
    snapExcludedIds && snapExcludedIds.size > 0
      ? normalizedTargets.filter(
          (target) =>
            !snapExcludedIds.has(target.id) && !snapExcludedIds.has(String(target.originalIndex)),
        )
      : normalizedTargets;
  const activeBounds = activeTargets.map((target) => target.bounds);

  const cx = x + w / 2;
  const cy = y + h / 2;
  const edges = { left: x, right: x + w, centerX: cx, top: y, bottom: y + h, centerY: cy };

  let bestXDiff = Infinity;
  let bestXSnap = x;
  let bestXGuide: SnapGuide | null = null;
  let bestXPriority = -1;
  let bestYDiff = Infinity;
  let bestYSnap = y;
  let bestYGuide: SnapGuide | null = null;
  let bestYPriority = -1;
  let isoGuide: SnapGuide | null = null;
  let isoLock: IsometricSnapLock | null = null;

  // C1: Grid snap (highest priority)
  if (grid !== undefined && grid !== null) {
    const gridConfig = typeof grid === 'number' ? { spacingX: grid, spacingY: grid } : grid;
    if (gridConfig.spacingX > 0 && gridConfig.spacingY > 0) {
      const [gx, gy] = snapPointToRotatedGrid(x, y, gridConfig);
      const dx = Math.abs(gx - x);
      const dy = Math.abs(gy - y);
      const prio = SNAP_PRIORITY.grid;
      if (dx < thresh && compete(prio, dx, bestXPriority, bestXDiff)) {
        bestXDiff = dx;
        bestXSnap = gx;
        bestXGuide = {
          axis: 'vertical',
          position: gx,
          label: `${gx}px`,
          type: 'edge',
          targetId: 'grid:x',
          sourceFeature: 'left',
          targetFeature: 'grid',
          referenceSpace: 'world',
          correction: gx - x,
        };
        bestXPriority = prio;
      }
      if (dy < thresh && compete(prio, dy, bestYPriority, bestYDiff)) {
        bestYDiff = dy;
        bestYSnap = gy;
        bestYGuide = {
          axis: 'horizontal',
          position: gy,
          label: `${gy}px`,
          type: 'edge',
          targetId: 'grid:y',
          sourceFeature: 'top',
          targetFeature: 'grid',
          referenceSpace: 'world',
          correction: gy - y,
        };
        bestYPriority = prio;
      }
    }
  }

  // C2: Layout grid snap
  if (options.layoutGridStep && options.layoutGridStep > 0) {
    const step = options.layoutGridStep;
    const lx = Math.round(x / step) * step;
    const ly = Math.round(y / step) * step;
    const dx = Math.abs(lx - x);
    const dy = Math.abs(ly - y);
    const prio = SNAP_PRIORITY.layoutGrid;
    if (dx < thresh && compete(prio, dx, bestXPriority, bestXDiff)) {
      bestXDiff = dx;
      bestXSnap = lx;
      bestXGuide = {
        axis: 'vertical',
        position: lx,
        type: 'edge',
        targetId: 'layout-grid:x',
        sourceFeature: 'left',
        targetFeature: 'layout-grid',
        referenceSpace: 'world',
        correction: lx - x,
      };
      bestXPriority = prio;
    }
    if (dy < thresh && compete(prio, dy, bestYPriority, bestYDiff)) {
      bestYDiff = dy;
      bestYSnap = ly;
      bestYGuide = {
        axis: 'horizontal',
        position: ly,
        type: 'edge',
        targetId: 'layout-grid:y',
        sourceFeature: 'top',
        targetFeature: 'layout-grid',
        referenceSpace: 'world',
        correction: ly - y,
      };
      bestYPriority = prio;
    }
  }

  // Authored frame layout guides are line targets, not an auto-layout cell
  // step. Their lower priority preserves document-grid, ruler-guide, and
  // object-edge snaps when several candidates are close together.
  if (options.layoutGridTargets && options.layoutGridTargets.length > 0) {
    const prio = SNAP_PRIORITY.layoutGrid;
    let bestLayoutX: LineSnapCandidate | null = null;
    let bestLayoutY: LineSnapCandidate | null = null;
    for (const target of options.layoutGridTargets) {
      const candidate = closestLineSnapCandidate(
        x,
        y,
        w,
        h,
        target,
        thresh,
        'layout-grid',
        'layout guide',
      );
      if (!candidate) continue;
      if (candidate.axis === 'vertical') {
        if (!bestLayoutX || candidate.distance < bestLayoutX.distance) bestLayoutX = candidate;
      } else if (!bestLayoutY || candidate.distance < bestLayoutY.distance) {
        bestLayoutY = candidate;
      }
    }
    if (bestLayoutX && compete(prio, bestLayoutX.distance, bestXPriority, bestXDiff)) {
      bestXDiff = bestLayoutX.distance;
      bestXSnap = bestLayoutX.snapped;
      bestXGuide = bestLayoutX.guide;
      bestXPriority = prio;
    }
    if (bestLayoutY && compete(prio, bestLayoutY.distance, bestYPriority, bestYDiff)) {
      bestYDiff = bestLayoutY.distance;
      bestYSnap = bestLayoutY.snapped;
      bestYGuide = bestLayoutY.guide;
      bestYPriority = prio;
    }
  }

  // C3: Pixel grid snap (snaps to integer pixel coordinates)
  if (options.pixelGridSnap) {
    const px = Math.round(x);
    const py = Math.round(y);
    const dx = Math.abs(px - x);
    const dy = Math.abs(py - y);
    const prio = SNAP_PRIORITY.grid; // Use same priority as document grid
    if (dx < thresh && compete(prio, dx, bestXPriority, bestXDiff)) {
      bestXDiff = dx;
      bestXSnap = px;
      bestXGuide = {
        axis: 'vertical',
        position: px,
        label: `${px}px`,
        type: 'edge',
        targetId: 'pixel-grid:x',
        sourceFeature: 'left',
        targetFeature: 'pixel-grid',
        referenceSpace: 'world',
        correction: px - x,
      };
      bestXPriority = prio;
    }
    if (dy < thresh && compete(prio, dy, bestYPriority, bestYDiff)) {
      bestYDiff = dy;
      bestYSnap = py;
      bestYGuide = {
        axis: 'horizontal',
        position: py,
        label: `${py}px`,
        type: 'edge',
        targetId: 'pixel-grid:y',
        sourceFeature: 'top',
        targetFeature: 'pixel-grid',
        referenceSpace: 'world',
        correction: py - y,
      };
      bestYPriority = prio;
    }
  }

  // C2.5: Permanent ruler guides. These are line targets, so compare every
  // movable edge/center on the matching axis against the guide's position.
  if (options.guideTargets && options.guideTargets.length > 0) {
    for (const guide of options.guideTargets) {
      const prio = SNAP_PRIORITY.guide;
      if (guide.axis === 'vertical') {
        for (const key of ['left', 'centerX', 'right'] as const) {
          const diff = edges[key] - guide.position;
          const absDiff = Math.abs(diff);
          if (absDiff < thresh && compete(prio, absDiff, bestXPriority, bestXDiff)) {
            bestXDiff = absDiff;
            bestXSnap = x - diff;
            bestXGuide = {
              axis: 'vertical',
              position: guide.position,
              distance: absDiff,
              type: 'guide',
              label: 'guide',
              ...(guide.id
                ? {
                    targetId: guide.id,
                    sourceFeature: key,
                    targetFeature: 'guide',
                    referenceSpace: 'world' as const,
                    correction: -diff,
                  }
                : {}),
            };
            bestXPriority = prio;
          }
        }
      } else {
        for (const key of ['top', 'centerY', 'bottom'] as const) {
          const diff = edges[key] - guide.position;
          const absDiff = Math.abs(diff);
          if (absDiff < thresh && compete(prio, absDiff, bestYPriority, bestYDiff)) {
            bestYDiff = absDiff;
            bestYSnap = y - diff;
            bestYGuide = {
              axis: 'horizontal',
              position: guide.position,
              distance: absDiff,
              type: 'guide',
              label: 'guide',
              ...(guide.id
                ? {
                    targetId: guide.id,
                    sourceFeature: key,
                    targetFeature: 'guide',
                    referenceSpace: 'world' as const,
                    correction: -diff,
                  }
                : {}),
            };
            bestYPriority = prio;
          }
        }
      }
    }
  }

  // C3: Mid-point between two objects. The canonical evaluation scans every
  // unordered pair (O(k²)); the criterion is symmetric, so the winning pair
  // is found by sorting centers once and, per node, binary-searching the
  // partner whose center is closest to (2*cx - center) — O(k log k) with
  // identical winners (verified against the pair scan by the parity tests in
  // tools/__benchmarks__/snapParity.bench.test.ts).
  if (activeBounds.length > 1) {
    const n = activeBounds.length;
    const centersX: number[] = new Array(n);
    const centersY: number[] = new Array(n);
    const targetIds = activeTargets.map((target) => target.id);
    for (let i = 0; i < n; i++) {
      const b = activeBounds[i]!;
      centersX[i] = b.x + b.w / 2;
      centersY[i] = b.y + b.h / 2;
    }
    const xOrder = Array.from({ length: n }, (_, i) => i).sort(
      (i, j) => centersX[i]! - centersX[j]!,
    );
    const yOrder = Array.from({ length: n }, (_, i) => i).sort(
      (i, j) => centersY[i]! - centersY[j]!,
    );
    const sortedX = xOrder.map((i) => centersX[i]!);
    const sortedY = yOrder.map((i) => centersY[i]!);
    const prio = SNAP_PRIORITY.midpoint;

    for (let i = 0; i < n; i++) {
      const xTarget = 2 * cx - centersX[i]!;
      const xPartner = findClosest(sortedX, xOrder, xTarget, i);
      if (xPartner !== -1) {
        const midX = (centersX[i]! + centersX[xPartner]!) / 2;
        const dmx = Math.abs(cx - midX);
        if (dmx < thresh && compete(prio, dmx, bestXPriority, bestXDiff)) {
          bestXDiff = dmx;
          bestXSnap = x - (cx - midX);
          bestXGuide = {
            axis: 'vertical',
            position: midX,
            type: 'midpoint',
            label: 'mid',
            targetId: `midpoint:${[targetIds[i]!, targetIds[xPartner]!].sort().join(':')}`,
            sourceFeature: 'centerX',
            targetFeature: 'midpoint',
            referenceSpace: 'world',
            correction: -(cx - midX),
          };
          bestXPriority = prio;
        }
      }
      const yTarget = 2 * cy - centersY[i]!;
      const yPartner = findClosest(sortedY, yOrder, yTarget, i);
      if (yPartner !== -1) {
        const midY = (centersY[i]! + centersY[yPartner]!) / 2;
        const dmy = Math.abs(cy - midY);
        if (dmy < thresh && compete(prio, dmy, bestYPriority, bestYDiff)) {
          bestYDiff = dmy;
          bestYSnap = y - (cy - midY);
          bestYGuide = {
            axis: 'horizontal',
            position: midY,
            type: 'midpoint',
            label: 'mid',
            targetId: `midpoint:${[targetIds[i]!, targetIds[yPartner]!].sort().join(':')}`,
            sourceFeature: 'centerY',
            targetFeature: 'midpoint',
            referenceSpace: 'world',
            correction: -(cy - midY),
          };
          bestYPriority = prio;
        }
      }
    }
  }

  for (const target of activeTargets) {
    const b = target.bounds;
    const bCX = b.x + b.w / 2;
    const bCY = b.y + b.h / 2;
    const bEdges = {
      left: b.x,
      right: b.x + b.w,
      centerX: bCX,
      top: b.y,
      bottom: b.y + b.h,
      centerY: bCY,
    };

    for (const key of ['left', 'centerX', 'right'] as const) {
      const diff = edges[key] - bEdges[key];
      const absDiff = Math.abs(diff);
      const prio = key === 'centerX' ? SNAP_PRIORITY.center : SNAP_PRIORITY.edge;
      if (absDiff < thresh && compete(prio, absDiff, bestXPriority, bestXDiff)) {
        bestXDiff = absDiff;
        bestXSnap = x - diff;
        bestXGuide = {
          axis: 'vertical',
          position: bEdges[key],
          distance: absDiff,
          type: key === 'centerX' ? 'center' : 'edge',
          targetId: target.id,
          sourceFeature: key,
          targetFeature: key,
          referenceSpace: 'world',
          correction: -diff,
        };
        bestXPriority = prio;
      }
    }

    for (const key of ['top', 'centerY', 'bottom'] as const) {
      const diff = edges[key] - bEdges[key];
      const absDiff = Math.abs(diff);
      const prio = key === 'centerY' ? SNAP_PRIORITY.center : SNAP_PRIORITY.edge;
      if (absDiff < thresh && compete(prio, absDiff, bestYPriority, bestYDiff)) {
        bestYDiff = absDiff;
        bestYSnap = y - diff;
        bestYGuide = {
          axis: 'horizontal',
          position: bEdges[key],
          distance: absDiff,
          type: key === 'centerY' ? 'center' : 'edge',
          targetId: target.id,
          sourceFeature: key,
          targetFeature: key,
          referenceSpace: 'world',
          correction: -diff,
        };
        bestYPriority = prio;
      }
    }
  }

  // C3: Isometric lattice snap (joint 2-D candidate).
  //
  // An oblique lattice cannot be snapped by correcting X and Y independently:
  // the nearest intersection is a property of the pair. The solver returns a
  // single translation for the whole selection; it competes with the winning
  // axis candidates by distance (see SnapOptions.isometric).
  if (options.isometric) {
    const iso = findIsometricSnap(boxSourceFeatures({ x, y, w, h }), options.isometric);
    if (iso) {
      const hasAxisCandidate = Number.isFinite(bestXDiff) || Number.isFinite(bestYDiff);
      const competing = Math.hypot(
        Number.isFinite(bestXDiff) ? bestXDiff : 0,
        Number.isFinite(bestYDiff) ? bestYDiff : 0,
      );
      if (!hasAxisCandidate || iso.distance <= competing + 1e-9) {
        snappedX = x + iso.translation.x;
        snappedY = y + iso.translation.y;
        // Isometric locks are 2-D and own both axes for this sample; clear any
        // axis lock so its correction is never re-applied on top.
        session = { stickyX: null, stickyY: null };
        bestXGuide = null;
        bestYGuide = null;
        bestXDiff = Infinity;
        bestYDiff = Infinity;
        isoGuide = {
          axis: 'vertical',
          position: snappedX,
          label: iso.kind === 'intersection' ? 'iso' : 'iso line',
          type: 'edge',
          targetId: `isometric:${options.isometric.id}`,
          sourceFeature: 'corner',
          targetFeature: iso.kind,
          referenceSpace: 'world',
          correction: iso.translation.x,
          point: { x: iso.snappedPoint[0], y: iso.snappedPoint[1] },
        };
        isoLock = iso.lock;
      }
    }
  }

  if (bestXGuide) {
    const stickyResult = tryStickyAxis(x, bestXSnap, bestXGuide, session.stickyX, release, sticky);
    snappedX = stickyResult.coord;
    session = { ...session, stickyX: sticky && stickyResult.snapped ? stickyResult.session : null };
    if (stickyResult.snapped || !sticky) guides.push(bestXGuide);
  } else if (sticky && session.stickyX && stickyTargetIsInScope(session.stickyX, activeTargets)) {
    const lockGuide = guideFromLock('vertical', session.stickyX);
    const hold = tryStickyAxis(x, x, lockGuide, session.stickyX, release, true);
    if (hold.snapped) snappedX = hold.coord;
    else session = { ...session, stickyX: null };
  } else if (sticky && session.stickyX) {
    session = { ...session, stickyX: null };
  }

  if (bestYGuide) {
    const stickyResult = tryStickyAxis(y, bestYSnap, bestYGuide, session.stickyY, release, sticky);
    snappedY = stickyResult.coord;
    session = { ...session, stickyY: sticky && stickyResult.snapped ? stickyResult.session : null };
    if (stickyResult.snapped || !sticky) guides.push(bestYGuide);
  } else if (sticky && session.stickyY && stickyTargetIsInScope(session.stickyY, activeTargets)) {
    const lockGuide = guideFromLock('horizontal', session.stickyY);
    const hold = tryStickyAxis(y, y, lockGuide, session.stickyY, release, true);
    if (hold.snapped) snappedY = hold.coord;
    else session = { ...session, stickyY: null };
  } else if (sticky && session.stickyY) {
    session = { ...session, stickyY: null };
  }

  // The isometric guide is pushed after the axis machinery so an axis lock
  // (now cleared) can never add a conflicting line for the same sample.
  if (isoGuide) guides.push(isoGuide);

  // C4: Spacing distribution (lowest priority). The canonical evaluation is
  // O(k²) over every ordered pair (a,b) with a.right < cx < b.left. Because
  // |gap - (mid - cx)| equals |b.left - 3*a.right + 2*cx| / 2, the best b for
  // a fixed a is the left edge closest to (3*a.right - 2*cx) among left edges
  // > cx — a sorted binary search, reducing the rule to O(k log k) with
  // identical winners (parity-verified).
  if (activeTargets.length > 1) {
    const n = activeTargets.length;
    const rightEdges: number[] = new Array(n);
    const bottomEdges: number[] = new Array(n);
    const leftEdges: number[] = new Array(n);
    const topEdges: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const b = activeTargets[i]!.bounds;
      rightEdges[i] = b.x + b.w;
      bottomEdges[i] = b.y + b.h;
      leftEdges[i] = b.x;
      topEdges[i] = b.y;
    }
    const xOrder = Array.from({ length: n }, (_, i) => i).sort(
      (i, j) => leftEdges[i]! - leftEdges[j]!,
    );
    const yOrder = Array.from({ length: n }, (_, i) => i).sort(
      (i, j) => topEdges[i]! - topEdges[j]!,
    );
    const sortedLeft = xOrder.map((i) => leftEdges[i]!);
    const sortedTop = yOrder.map((i) => topEdges[i]!);
    const prio = SNAP_PRIORITY.spacing;
    const preciseSpacingLabel = activeTargets.some((target) => target.explicitId);

    let bestXGap: { mid: number; gap: number; obj: number; targetId: string } | null = null;
    for (let i = 0; i < n; i++) {
      const ra = rightEdges[i]!;
      if (!(ra < cx)) continue;
      const target = 3 * ra - 2 * cx;
      const j = findClosestGap(sortedLeft, xOrder, target, i, cx);
      if (j === -1) continue;
      const mid = (ra + leftEdges[j]!) / 2;
      const gap = leftEdges[j]! - ra;
      const obj = Math.abs(gap - (mid - cx));
      const targetId = `spacing:${[activeTargets[i]!.id, activeTargets[j]!.id].sort().join(':')}`;
      if (
        bestXGap === null ||
        obj < bestXGap.obj ||
        (obj === bestXGap.obj && targetId.localeCompare(bestXGap.targetId) < 0)
      ) {
        bestXGap = { mid, gap, obj, targetId };
      }
    }
    if (bestXGap) {
      const dmx = Math.abs(cx - bestXGap.mid);
      if (dmx < thresh * 3 && compete(prio, dmx, bestXPriority, bestXDiff)) {
        bestXDiff = dmx;
        bestXSnap = x - (cx - bestXGap.mid);
        bestXGuide = {
          axis: 'vertical',
          position: bestXGap.mid,
          type: 'spacing',
          label: `${preciseSpacingLabel ? formatSnapValue(bestXGap.gap) : Math.round(bestXGap.gap)}px`,
          targetId: bestXGap.targetId,
          sourceFeature: 'centerX',
          targetFeature: 'spacing-gap',
          referenceSpace: 'world',
          correction: -(cx - bestXGap.mid),
        };
        bestXPriority = prio;
      }
    }

    let bestYGap: { mid: number; gap: number; obj: number; targetId: string } | null = null;
    for (let i = 0; i < n; i++) {
      const ba = bottomEdges[i]!;
      if (!(ba < cy)) continue;
      const target = 3 * ba - 2 * cy;
      const j = findClosestGap(sortedTop, yOrder, target, i, cy);
      if (j === -1) continue;
      const mid = (ba + topEdges[j]!) / 2;
      const gap = topEdges[j]! - ba;
      const obj = Math.abs(gap - (mid - cy));
      const targetId = `spacing:${[activeTargets[i]!.id, activeTargets[j]!.id].sort().join(':')}`;
      if (
        bestYGap === null ||
        obj < bestYGap.obj ||
        (obj === bestYGap.obj && targetId.localeCompare(bestYGap.targetId) < 0)
      ) {
        bestYGap = { mid, gap, obj, targetId };
      }
    }
    if (bestYGap) {
      const dmy = Math.abs(cy - bestYGap.mid);
      if (dmy < thresh * 3 && compete(prio, dmy, bestYPriority, bestYDiff)) {
        bestYDiff = dmy;
        bestYSnap = y - (cy - bestYGap.mid);
        bestYGuide = {
          axis: 'horizontal',
          position: bestYGap.mid,
          type: 'spacing',
          label: `${preciseSpacingLabel ? formatSnapValue(bestYGap.gap) : Math.round(bestYGap.gap)}px`,
          targetId: bestYGap.targetId,
          sourceFeature: 'centerY',
          targetFeature: 'spacing-gap',
          referenceSpace: 'world',
          correction: -(cy - bestYGap.mid),
        };
        bestYPriority = prio;
      }
    }
  }

  // Spacing is selected after the cheaper edge/midpoint rules, so apply its
  // winning candidate through the same sticky resolver as every other snap.
  // This keeps the session and the visible guide in agreement instead of
  // returning a corrected coordinate with the previous lock still active.
  if (bestXGuide?.type === 'spacing') {
    const stickyResult = tryStickyAxis(x, bestXSnap, bestXGuide, session.stickyX, release, sticky);
    snappedX = stickyResult.coord;
    session = { ...session, stickyX: sticky && stickyResult.snapped ? stickyResult.session : null };
    if (stickyResult.snapped || !sticky) guides.push(bestXGuide);
  }
  if (bestYGuide?.type === 'spacing') {
    const stickyResult = tryStickyAxis(y, bestYSnap, bestYGuide, session.stickyY, release, sticky);
    snappedY = stickyResult.coord;
    session = { ...session, stickyY: sticky && stickyResult.snapped ? stickyResult.session : null };
    if (stickyResult.snapped || !sticky) guides.push(bestYGuide);
  }

  const matches = guides.flatMap((guide) => {
    if (!guide.targetId || !guide.sourceFeature || !guide.targetFeature) return [];
    const pointCorrection = guide.point ? { x: snappedX - x, y: snappedY - y } : null;
    return [
      {
        targetId: guide.targetId,
        sourceFeature: guide.sourceFeature,
        targetFeature: guide.targetFeature,
        referenceSpace: 'world' as const,
        correction: pointCorrection ?? {
          x: guide.axis === 'vertical' ? (guide.correction ?? snappedX - x) : 0,
          y: guide.axis === 'horizontal' ? (guide.correction ?? snappedY - y) : 0,
        },
        category: guide.type ?? 'edge',
      },
    ];
  });
  return {
    x: snappedX,
    y: snappedY,
    guides,
    matches: matches.length > 0 ? matches : undefined,
    session,
    isometricLock: isoLock,
  };
}

export function snapSize(
  w: number,
  h: number,
  otherBounds: Array<{ x: number; y: number; w: number; h: number }>,
  zoom = 1,
  tolerancePx?: number,
): { w: number; h: number; matched: boolean; guide?: SnapGuide } {
  const threshold = thresholdWorld(zoom, tolerancePx);
  for (const b of otherBounds) {
    if (Math.abs(b.w - w) < threshold) {
      return {
        w: b.w,
        h,
        matched: true,
        guide: { axis: 'horizontal', position: 0, type: 'size-match', label: `${b.w}px` },
      };
    }
    if (Math.abs(b.h - h) < threshold) {
      return {
        w,
        h: b.h,
        matched: true,
        guide: { axis: 'vertical', position: 0, type: 'size-match', label: `${b.h}px` },
      };
    }
  }
  return { w, h, matched: false };
}

/** Create a fresh snap session (call on pointer down). */
export function createSnapSession(): SnapSession {
  return { stickyX: null, stickyY: null };
}

type ResizeSide = 'start' | 'end';

interface ResizeAxisTarget {
  position: number;
  priority: number;
}

function lineTargetPriority(type: SnapGuide['type']): number {
  switch (type) {
    case 'guide':
      return SNAP_PRIORITY.guide;
    case 'layout-grid':
      return SNAP_PRIORITY.layoutGrid;
    default:
      return SNAP_PRIORITY.edge;
  }
}

function lineAxisTargets(lineTargets: SnapLineTarget[], axis: 'x' | 'y'): ResizeAxisTarget[] {
  const expectedAxis = axis === 'x' ? 'vertical' : 'horizontal';
  return lineTargets
    .filter((target) => target.axis === expectedAxis && Number.isFinite(target.position))
    .map((target) => ({
      position: target.position,
      priority: lineTargetPriority(target.type),
    }));
}

interface ResizeAxisSnap {
  center: number;
  size: number;
  priority: number;
  diff: number;
}

function preferResizeAxis(x: ResizeAxisSnap | null, y: ResizeAxisSnap | null): 'x' | 'y' | null {
  if (!x && !y) return null;
  if (!y) return 'x';
  if (!x) return 'y';
  if (x.priority !== y.priority) return x.priority > y.priority ? 'x' : 'y';
  if (x.diff !== y.diff) return x.diff < y.diff ? 'x' : 'y';
  // A corner can be close to two equally strong targets. Keeping X as the
  // stable tie-breaker makes the result independent of candidate iteration.
  return 'x';
}

function preserveProportionalResize(
  box: SelectionBox,
  snapped: SelectionBox,
  resizeX: ResizeSide | null,
  resizeY: ResizeSide | null,
  xSnap: ResizeAxisSnap | null,
  ySnap: ResizeAxisSnap | null,
  centered: boolean,
): SelectionBox {
  const axis = preferResizeAxis(xSnap, ySnap);
  if (!axis || box.w <= Number.EPSILON || box.h <= Number.EPSILON) return snapped;

  const width = axis === 'x' ? xSnap?.size : box.w * ((ySnap?.size ?? box.h) / box.h);
  const height = axis === 'y' ? ySnap?.size : box.h * ((xSnap?.size ?? box.w) / box.w);
  if (
    width === undefined ||
    height === undefined ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= Number.EPSILON ||
    height <= Number.EPSILON
  ) {
    return snapped;
  }

  let cx = box.cx;
  let cy = box.cy;
  if (!centered) {
    const fixedX = resizeX ? box.cx + (resizeX === 'end' ? -box.w / 2 : box.w / 2) : null;
    const fixedY = resizeY ? box.cy + (resizeY === 'end' ? -box.h / 2 : box.h / 2) : null;
    if (fixedX !== null && resizeX) {
      cx = fixedX + (resizeX === 'end' ? width / 2 : -width / 2);
    }
    if (fixedY !== null && resizeY) {
      cy = fixedY + (resizeY === 'end' ? height / 2 : -height / 2);
    }
  }

  return { ...snapped, cx, cy, w: width, h: height };
}

function resizeSideForHandle(handle: ResizeHandle, axis: 'x' | 'y'): ResizeSide | null {
  if (axis === 'x') {
    if (handle === 'w' || handle === 'nw' || handle === 'sw') return 'start';
    if (handle === 'e' || handle === 'ne' || handle === 'se') return 'end';
  } else {
    if (handle === 'n' || handle === 'nw' || handle === 'ne') return 'start';
    if (handle === 's' || handle === 'sw' || handle === 'se') return 'end';
  }
  return null;
}

/**
 * Snap the moving side of a resize without translating its opposite anchor.
 * A generic selection-box snap may safely translate a box; doing that during
 * resize makes the fixed handle side drift, so resize has its own resolver.
 */
function snapResizeAxis(
  center: number,
  size: number,
  side: ResizeSide,
  targets: ResizeAxisTarget[],
  centered: boolean,
  threshold: number,
): ResizeAxisSnap | null {
  const moving = center + (side === 'end' ? size / 2 : -size / 2);
  const fixed = center + (side === 'end' ? -size / 2 : size / 2);
  let best: ResizeAxisSnap | null = null;

  for (const target of targets) {
    const diff = Math.abs(moving - target.position);
    if (diff >= threshold) continue;
    if (best && !compete(target.priority, diff, best.priority, best.diff)) continue;

    const nextSize = centered
      ? size + (side === 'end' ? 2 * (target.position - moving) : 2 * (moving - target.position))
      : side === 'end'
        ? target.position - fixed
        : fixed - target.position;
    if (nextSize <= Number.EPSILON) continue;
    best = {
      center: centered ? center : (fixed + target.position) / 2,
      size: nextSize,
      priority: target.priority,
      diff,
    };
  }

  return best;
}

function objectAxisTargets(
  otherBounds: Array<{ x: number; y: number; w: number; h: number }>,
  axis: 'x' | 'y',
): ResizeAxisTarget[] {
  const targets: ResizeAxisTarget[] = [];
  for (const b of otherBounds) {
    const start = axis === 'x' ? b.x : b.y;
    const size = axis === 'x' ? b.w : b.h;
    targets.push(
      { position: start, priority: SNAP_PRIORITY.edge },
      { position: start + size / 2, priority: SNAP_PRIORITY.center },
      { position: start + size, priority: SNAP_PRIORITY.edge },
    );
  }
  return targets;
}

function snapResizeAxisToGrid(
  center: number,
  size: number,
  side: ResizeSide,
  spacing: number,
  offset: number,
  centered: boolean,
  threshold: number,
  priority: number,
): ResizeAxisSnap | null {
  const moving = center + (side === 'end' ? size / 2 : -size / 2);
  return snapResizeAxis(
    center,
    size,
    side,
    [{ position: snapCoordToGrid(moving, spacing, offset), priority }],
    centered,
    threshold,
  );
}

/** Snap a selection box (position and size) to other bounds. */
export function snapSelectionBox(box: SelectionBox, options: SnapBoxOptions = {}): SelectionBox {
  const {
    zoom = 1,
    tolerancePx,
    otherBounds = [],
    resizeHandle,
    resizeCentered = false,
    resizeProportional = false,
    grid,
    layoutGridStep,
    pixelGridSnap,
    lineTargets = [],
  } = options;
  const thresh = thresholdWorld(zoom, tolerancePx);

  let snappedCx = box.cx;
  let snappedCy = box.cy;
  let snappedW = box.w;
  let snappedH = box.h;

  let bestXDiff = Infinity;
  let bestXPriority = -1;
  let bestYDiff = Infinity;
  let bestYPriority = -1;
  const isAxisAligned = Math.abs(Math.sin(box.rotation)) < 1e-9;
  const resizeX = resizeHandle ? resizeSideForHandle(resizeHandle, 'x') : null;
  const resizeY = resizeHandle ? resizeSideForHandle(resizeHandle, 'y') : null;
  const canSnapResizeAxes = isAxisAligned && (resizeX !== null || resizeY !== null);

  // Use the same-anchor edge/center matching as move snapping. Resize
  // gestures already call this resolver through TransformEngine, so teaching
  // this path about edges fixes handle-drag snapping without inventing a
  // parallel candidate model. An oriented box has no world-axis-aligned edges
  // at arbitrary rotation; its centre is still meaningful, but edge matching
  // is intentionally restricted to axis-aligned selections.
  let xResizeSnap: ResizeAxisSnap | null = null;
  let yResizeSnap: ResizeAxisSnap | null = null;
  if (otherBounds.length > 0 || lineTargets.length > 0) {
    if (canSnapResizeAxes && resizeX) {
      const snap = snapResizeAxis(
        box.cx,
        box.w,
        resizeX,
        [...objectAxisTargets(otherBounds, 'x'), ...lineAxisTargets(lineTargets, 'x')],
        resizeCentered,
        thresh,
      );
      if (snap) {
        xResizeSnap = snap;
        snappedCx = snap.center;
        snappedW = snap.size;
        bestXDiff = snap.diff;
        bestXPriority = snap.priority;
      }
    }
    if (canSnapResizeAxes && resizeY) {
      const snap = snapResizeAxis(
        box.cy,
        box.h,
        resizeY,
        [...objectAxisTargets(otherBounds, 'y'), ...lineAxisTargets(lineTargets, 'y')],
        resizeCentered,
        thresh,
      );
      if (snap) {
        yResizeSnap = snap;
        snappedCy = snap.center;
        snappedH = snap.size;
        bestYDiff = snap.diff;
        bestYPriority = snap.priority;
      }
    }
    if (!resizeHandle) {
      const boxEdges = {
        left: box.cx - box.w / 2,
        right: box.cx + box.w / 2,
        centerX: box.cx,
        top: box.cy - box.h / 2,
        bottom: box.cy + box.h / 2,
        centerY: box.cy,
      };
      for (const b of otherBounds) {
        const targetEdges = {
          left: b.x,
          right: b.x + b.w,
          centerX: b.x + b.w / 2,
          top: b.y,
          bottom: b.y + b.h,
          centerY: b.y + b.h / 2,
        };

        for (const key of ['left', 'centerX', 'right'] as const) {
          if (!isAxisAligned && key !== 'centerX') continue;
          const diff = boxEdges[key] - targetEdges[key];
          const absDiff = Math.abs(diff);
          const priority = key === 'centerX' ? SNAP_PRIORITY.center : SNAP_PRIORITY.edge;
          if (absDiff < thresh && compete(priority, absDiff, bestXPriority, bestXDiff)) {
            bestXDiff = absDiff;
            bestXPriority = priority;
            snappedCx = box.cx - diff;
          }
        }

        for (const key of ['top', 'centerY', 'bottom'] as const) {
          if (!isAxisAligned && key !== 'centerY') continue;
          const diff = boxEdges[key] - targetEdges[key];
          const absDiff = Math.abs(diff);
          const priority = key === 'centerY' ? SNAP_PRIORITY.center : SNAP_PRIORITY.edge;
          if (absDiff < thresh && compete(priority, absDiff, bestYPriority, bestYDiff)) {
            bestYDiff = absDiff;
            bestYPriority = priority;
            snappedCy = box.cy - diff;
          }
        }
      }
      for (const target of lineTargets) {
        const targetPriority = lineTargetPriority(target.type);
        if (target.axis === 'vertical') {
          for (const key of ['left', 'centerX', 'right'] as const) {
            const diff = boxEdges[key] - target.position;
            const absDiff = Math.abs(diff);
            if (absDiff < thresh && compete(targetPriority, absDiff, bestXPriority, bestXDiff)) {
              bestXDiff = absDiff;
              bestXPriority = targetPriority;
              snappedCx = box.cx - diff;
            }
          }
        } else {
          for (const key of ['top', 'centerY', 'bottom'] as const) {
            const diff = boxEdges[key] - target.position;
            const absDiff = Math.abs(diff);
            if (absDiff < thresh && compete(targetPriority, absDiff, bestYPriority, bestYDiff)) {
              bestYDiff = absDiff;
              bestYPriority = targetPriority;
              snappedCy = box.cy - diff;
            }
          }
        }
      }
    }
  }

  // Snap to grid (higher priority than center)
  if (canSnapResizeAxes && grid !== undefined && grid !== null) {
    const gridConfig = typeof grid === 'number' ? { spacingX: grid, spacingY: grid } : grid;
    if (gridConfig.spacingX > 0 && gridConfig.spacingY > 0) {
      if (resizeX) {
        const snap = snapResizeAxisToGrid(
          box.cx,
          box.w,
          resizeX,
          gridConfig.spacingX,
          gridConfig.offsetX ?? 0,
          resizeCentered,
          thresh,
          SNAP_PRIORITY.grid,
        );
        if (snap && compete(snap.priority, snap.diff, bestXPriority, bestXDiff)) {
          xResizeSnap = snap;
          snappedCx = snap.center;
          snappedW = snap.size;
          bestXDiff = snap.diff;
          bestXPriority = snap.priority;
        }
      }
      if (resizeY) {
        const snap = snapResizeAxisToGrid(
          box.cy,
          box.h,
          resizeY,
          gridConfig.spacingY,
          gridConfig.offsetY ?? 0,
          resizeCentered,
          thresh,
          SNAP_PRIORITY.grid,
        );
        if (snap && compete(snap.priority, snap.diff, bestYPriority, bestYDiff)) {
          yResizeSnap = snap;
          snappedCy = snap.center;
          snappedH = snap.size;
          bestYDiff = snap.diff;
          bestYPriority = snap.priority;
        }
      }
    }
  } else if (!resizeHandle && grid !== undefined && grid !== null) {
    const gridConfig = typeof grid === 'number' ? { spacingX: grid, spacingY: grid } : grid;
    if (gridConfig.spacingX > 0 && gridConfig.spacingY > 0) {
      const offsetX = gridConfig.offsetX ?? 0;
      const offsetY = gridConfig.offsetY ?? 0;
      const gridCx = snapCoordToGrid(box.cx, gridConfig.spacingX, offsetX);
      const gridCy = snapCoordToGrid(box.cy, gridConfig.spacingY, offsetY);
      const dx = Math.abs(gridCx - box.cx);
      const dy = Math.abs(gridCy - box.cy);
      if (dx < thresh && compete(SNAP_PRIORITY.grid, dx, bestXPriority, bestXDiff)) {
        bestXDiff = dx;
        bestXPriority = SNAP_PRIORITY.grid;
        snappedCx = gridCx;
      }
      if (dy < thresh && compete(SNAP_PRIORITY.grid, dy, bestYPriority, bestYDiff)) {
        bestYDiff = dy;
        bestYPriority = SNAP_PRIORITY.grid;
        snappedCy = gridCy;
      }
    }
  }

  // Snap to pixel grid (snaps to integer pixel coordinates)
  if (canSnapResizeAxes && pixelGridSnap) {
    if (resizeX) {
      const snap = snapResizeAxisToGrid(
        box.cx,
        box.w,
        resizeX,
        1,
        0,
        resizeCentered,
        thresh,
        SNAP_PRIORITY.grid,
      );
      if (snap && compete(snap.priority, snap.diff, bestXPriority, bestXDiff)) {
        xResizeSnap = snap;
        snappedCx = snap.center;
        snappedW = snap.size;
        bestXDiff = snap.diff;
        bestXPriority = snap.priority;
      }
    }
    if (resizeY) {
      const snap = snapResizeAxisToGrid(
        box.cy,
        box.h,
        resizeY,
        1,
        0,
        resizeCentered,
        thresh,
        SNAP_PRIORITY.grid,
      );
      if (snap && compete(snap.priority, snap.diff, bestYPriority, bestYDiff)) {
        yResizeSnap = snap;
        snappedCy = snap.center;
        snappedH = snap.size;
        bestYDiff = snap.diff;
        bestYPriority = snap.priority;
      }
    }
  } else if (!resizeHandle && pixelGridSnap) {
    const px = Math.round(box.cx);
    const py = Math.round(box.cy);
    const dx = Math.abs(px - box.cx);
    const dy = Math.abs(py - box.cy);
    if (dx < thresh && compete(SNAP_PRIORITY.grid, dx, bestXPriority, bestXDiff)) {
      bestXDiff = dx;
      bestXPriority = SNAP_PRIORITY.grid;
      snappedCx = px;
    }
    if (dy < thresh && compete(SNAP_PRIORITY.grid, dy, bestYPriority, bestYDiff)) {
      bestYDiff = dy;
      bestYPriority = SNAP_PRIORITY.grid;
      snappedCy = py;
    }
  }

  // Snap to layout grid
  if (canSnapResizeAxes && layoutGridStep && layoutGridStep > 0) {
    if (resizeX) {
      const snap = snapResizeAxisToGrid(
        box.cx,
        box.w,
        resizeX,
        layoutGridStep,
        0,
        resizeCentered,
        thresh,
        SNAP_PRIORITY.layoutGrid,
      );
      if (snap && compete(snap.priority, snap.diff, bestXPriority, bestXDiff)) {
        xResizeSnap = snap;
        snappedCx = snap.center;
        snappedW = snap.size;
        bestXDiff = snap.diff;
        bestXPriority = snap.priority;
      }
    }
    if (resizeY) {
      const snap = snapResizeAxisToGrid(
        box.cy,
        box.h,
        resizeY,
        layoutGridStep,
        0,
        resizeCentered,
        thresh,
        SNAP_PRIORITY.layoutGrid,
      );
      if (snap && compete(snap.priority, snap.diff, bestYPriority, bestYDiff)) {
        yResizeSnap = snap;
        snappedCy = snap.center;
        snappedH = snap.size;
        bestYDiff = snap.diff;
        bestYPriority = snap.priority;
      }
    }
  } else if (!resizeHandle && layoutGridStep && layoutGridStep > 0) {
    const step = layoutGridStep;
    const lx = Math.round(box.cx / step) * step;
    const ly = Math.round(box.cy / step) * step;
    const dx = Math.abs(lx - box.cx);
    const dy = Math.abs(ly - box.cy);
    if (dx < thresh && compete(SNAP_PRIORITY.layoutGrid, dx, bestXPriority, bestXDiff)) {
      bestXDiff = dx;
      bestXPriority = SNAP_PRIORITY.layoutGrid;
      snappedCx = lx;
    }
    if (dy < thresh && compete(SNAP_PRIORITY.layoutGrid, dy, bestYPriority, bestYDiff)) {
      bestYDiff = dy;
      bestYPriority = SNAP_PRIORITY.layoutGrid;
      snappedCy = ly;
    }
  }

  // Snap size
  // Object-edge snapping may already have changed a resize dimension. Match
  // size against that resolved result so an unchanged perpendicular dimension
  // cannot restore the pre-snap width or height.
  if (resizeProportional && resizeHandle && canSnapResizeAxes) {
    const proportional = preserveProportionalResize(
      box,
      { cx: snappedCx, cy: snappedCy, w: snappedW, h: snappedH, rotation: box.rotation },
      resizeX,
      resizeY,
      xResizeSnap,
      yResizeSnap,
      resizeCentered,
    );
    snappedCx = proportional.cx;
    snappedCy = proportional.cy;
    snappedW = proportional.w;
    snappedH = proportional.h;
  } else {
    const sizeSnap = snapSize(snappedW, snappedH, otherBounds, zoom, tolerancePx);
    if (sizeSnap.matched) {
      snappedW = sizeSnap.w;
      snappedH = sizeSnap.h;
    }
  }

  return {
    cx: snappedCx,
    cy: snappedCy,
    w: snappedW,
    h: snappedH,
    rotation: box.rotation,
  };
}

/**
 * Page trim snap targets for the shared multipage canvas (M6, ADR-0144):
 * the placed trim bounds of every page in the document, so nodes snap to
 * page edges on any page — not only the active page's trim at the origin.
 */
export function pageSnapTargets(
  doc: import('@varve/scene').Document,
): Array<{ x: number; y: number; w: number; h: number }> {
  const targets: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (const page of doc.pages ?? []) {
    const bounds = pageBoundsInWorld(doc, page.id);
    if (bounds) targets.push(bounds);
  }
  return targets;
}
