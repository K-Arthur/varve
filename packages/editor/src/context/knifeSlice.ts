/**
 * Pure Knife geometry and the document operation that applies it.
 *
 * The knife is the straight segment the user drags, in world space. A shape is
 * split only when that segment passes all the way through it — every point at
 * which the cut's line enters or leaves the outline has to fall inside the
 * dragged span. That rule is what makes the result predictable: a short drag
 * near a big shape does nothing instead of silently splitting it, and a cut
 * across one arm of a concave shape never also slices an arm the user never
 * dragged over.
 *
 * Splitting is a chain walk, not half-plane clipping. Clipping each side of the
 * outline against the line collapses a concave shape into one ring per side,
 * which is wrong: a horizontal cut through both arms of a U leaves one piece
 * below and *two* above. So the outline is augmented with its crossing points,
 * broken into chains per side, and the chains are re-closed along the cut —
 * which yields however many pieces the geometry really has.
 *
 * Geometry is flattened with @varve/scene's `shapeToPolygon`, the same sampler
 * the boolean operations use, so a cut agrees with a boolean on identical
 * input. `booleanOp` itself is not reused: it assembles exactly one contour and
 * simplifies it at a 0.5px tolerance, both of which lose pieces a knife must
 * keep.
 *
 * Research basis: Illustrator Knife, Sutherland-Hodgman (and why it is not
 * enough here), and the editor's world/local coordinate service.
 */

import type { Shape } from '@varve/engine';
import {
  activePageNodes,
  type Document,
  type Fill,
  getParent,
  isContainer,
  type NodeId,
  nextNodeId,
  pointInPolygon as pointInRegion,
  type SceneNode,
  type ShapeNode,
  shapeToPolygon,
} from '@varve/scene';
import { applyAffine, generateKeyBetween, type Point, tryInvertAffine } from '@varve/shared';
import { nodeWorldBounds, nodeWorldTransform } from '../scene/world';

/**
 * Distances are compared in world units, not in raw cross-product magnitude:
 * the cross product scales with the cut's length, so a bare epsilon on it means
 * something different for a 10px drag than for a 10000px one.
 */
const ON_LINE_DISTANCE = 1e-6;
/** Slack, as a fraction of the cut length, on "the crossing is inside the drag". */
const SPAN_TOLERANCE = 1e-6;
/** Pieces smaller than this (world px²) are discarded as numerical debris. */
const MIN_AREA = 0.01;
/** A cut shorter than this cannot express a direction reliably. */
const MIN_CUT_LENGTH = 1e-3;

export interface KnifeLine {
  start: Point;
  end: Point;
}

/** Why a candidate the knife looked at was left alone. */
export type KnifeSkipReason =
  | 'text'
  | 'compound-path'
  | 'unsupported-shape'
  | 'unsupported-image-placement'
  | 'modified-geometry'
  | 'no-full-crossing';

export interface KnifeSkip {
  nodeId: NodeId;
  name: string;
  reason: KnifeSkipReason;
}

export interface KnifeSliceResult {
  document: Document;
  /** Every node id present after the cut, source ids included, in z-order. */
  resultNodeIds: NodeId[];
  /** The source nodes that were actually divided. */
  slicedNodeIds: NodeId[];
  /** Candidates the cut touched but could not divide, with the reason. */
  skipped: KnifeSkip[];
}

/**
 * What to tell the user when a cut divided nothing.
 *
 * The reasons are ordered by how much they explain: "live text cannot be cut"
 * is worth saying even if a compound path was also in the way, whereas "the cut
 * did not pass through" is the fallback that covers a near miss. Reporting the
 * single most useful reason beats listing all of them in a live region that is
 * read aloud.
 */
export function knifeSkipMessage(skipped: readonly KnifeSkip[]): string {
  const has = (reason: KnifeSkipReason) => skipped.find((skip) => skip.reason === reason);

  const text = has('text');
  if (text) return `Live text can't be sliced. Convert "${text.name}" to outlines first.`;

  const compound = has('compound-path');
  if (compound) return `"${compound.name}" has holes and can't be sliced yet.`;

  const image = has('unsupported-image-placement');
  if (image) return `"${image.name}" uses an image placement the knife can't preserve.`;

  const modified = has('modified-geometry');
  if (modified) {
    return `"${modified.name}" is warped or masked; flatten it before slicing.`;
  }

  const unsupported = has('unsupported-shape');
  if (unsupported) return `"${unsupported.name}" can't be sliced.`;

  return 'Nothing was sliced. Drag the cut all the way across an object.';
}

// ── Cut-line primitives ─────────────────────────────────────────────────────

interface CutFrame {
  /** Signed perpendicular distance from the cut's line, in world units. */
  distance: (point: Point) => number;
  /** Position along the cut: 0 at `start`, 1 at `end`. */
  span: (point: Point) => number;
  length: number;
}

function cutFrame(line: KnifeLine): CutFrame | null {
  const dx = line.end[0] - line.start[0];
  const dy = line.end[1] - line.start[1];
  const lengthSquared = dx * dx + dy * dy;
  const length = Math.sqrt(lengthSquared);
  if (!(length > MIN_CUT_LENGTH)) return null;
  return {
    distance: (point) =>
      (dx * (point[1] - line.start[1]) - dy * (point[0] - line.start[0])) / length,
    span: (point) =>
      (dx * (point[0] - line.start[0]) + dy * (point[1] - line.start[1])) / lengthSquared,
    length,
  };
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a[0] - b[0]) <= ON_LINE_DISTANCE && Math.abs(a[1] - b[1]) <= ON_LINE_DISTANCE;
}

function cleanRing(points: readonly Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    const previous = result[result.length - 1];
    if (!previous || !samePoint(previous, point)) result.push(point);
  }
  while (result.length > 1 && samePoint(result[0]!, result[result.length - 1]!)) result.pop();
  return result;
}

function polygonArea(points: readonly Point[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area / 2;
}

/**
 * Even-odd containment against a single ring.
 *
 * Even-odd rather than the node's own fill rule on purpose: this only ever
 * tests one ring against itself, where the two rules agree, and it is asking a
 * geometric question ("does this run of the cut pass through the outline")
 * rather than a paint question.
 */
function insidePolygon(point: Point, ring: readonly Point[]): boolean {
  return pointInRegion(
    { x: point[0], y: point[1] },
    ring.map((p) => ({ x: p[0], y: p[1] })),
    'evenodd',
  );
}

// ── Closed-outline split ────────────────────────────────────────────────────

interface AugmentedVertex {
  point: Point;
  /** 1 / -1 for the two sides of the cut, 0 for a point lying on it. */
  side: -1 | 0 | 1;
  /** Position along the cut. Only meaningful when `side` is 0. */
  span: number;
}

interface Chain {
  points: Point[];
  spanIn: number;
  spanOut: number;
}

/** Walk the outline, inserting a vertex wherever an edge crosses the cut. */
function augmentRing(ring: readonly Point[], cut: CutFrame): AugmentedVertex[] {
  const distances = ring.map((point) => cut.distance(point));
  const sides = distances.map<-1 | 0 | 1>((d) =>
    d > ON_LINE_DISTANCE ? 1 : d < -ON_LINE_DISTANCE ? -1 : 0,
  );

  const out: AugmentedVertex[] = [];
  for (let index = 0; index < ring.length; index++) {
    const next = (index + 1) % ring.length;
    const current = ring[index]!;
    out.push({ point: current, side: sides[index]!, span: cut.span(current) });

    const from = sides[index]!;
    const to = sides[next]!;
    if (from === 0 || to === 0 || from === to) continue;
    const dFrom = distances[index]!;
    const dTo = distances[next]!;
    const ratio = dFrom / (dFrom - dTo);
    const target = ring[next]!;
    const crossing: Point = [
      current[0] + (target[0] - current[0]) * ratio,
      current[1] + (target[1] - current[1]) * ratio,
    ];
    out.push({ point: crossing, side: 0, span: cut.span(crossing) });
  }
  return out;
}

/**
 * True when the cut's line enters and leaves the outline only within the span
 * the user actually dragged.
 */
function cutPassesThrough(augmented: readonly AugmentedVertex[]): boolean {
  let sawCrossing = false;
  for (let index = 0; index < augmented.length; index++) {
    const vertex = augmented[index]!;
    if (vertex.side !== 0) continue;
    // A vertex sitting on the cut only matters if the outline actually changes
    // side around it; a tangential touch is not a crossing.
    const previous = augmented[(index - 1 + augmented.length) % augmented.length]!;
    const next = augmented[(index + 1) % augmented.length]!;
    if (previous.side === next.side) continue;
    sawCrossing = true;
    if (vertex.span < -SPAN_TOLERANCE || vertex.span > 1 + SPAN_TOLERANCE) return false;
  }
  return sawCrossing;
}

/** Maximal runs of the outline that lie on `side` (points on the cut join both). */
function chainsForSide(augmented: readonly AugmentedVertex[], side: -1 | 1): Chain[] {
  const count = augmented.length;
  const belongs = augmented.map((vertex) => vertex.side === side || vertex.side === 0);
  if (belongs.every(Boolean)) {
    // The whole outline is on this side; nothing to re-close.
    return [
      {
        points: augmented.map((vertex) => vertex.point),
        spanIn: Number.NaN,
        spanOut: Number.NaN,
      },
    ];
  }

  const chains: Chain[] = [];
  for (let index = 0; index < count; index++) {
    const previous = (index - 1 + count) % count;
    if (!belongs[index] || belongs[previous]) continue;

    const points: Point[] = [];
    let hasInterior = false;
    let spanOut = Number.NaN;
    let cursor = index;
    for (let step = 0; step < count && belongs[cursor]; step++) {
      const vertex = augmented[cursor]!;
      points.push(vertex.point);
      if (vertex.side === side) hasInterior = true;
      if (vertex.side === 0) spanOut = vertex.span;
      cursor = (cursor + 1) % count;
    }
    // A run that never leaves the cut is a tangential touch, not a piece.
    if (!hasInterior || points.length < 2) continue;
    chains.push({ points, spanIn: augmented[index]!.span, spanOut });
  }
  return chains;
}

/**
 * Re-close chains along the cut.
 *
 * Each chain leaves the outline at one point on the cut and the next chain
 * rejoins it at another. The connecting run is the one whose midpoint lies
 * inside the original outline — that is what distinguishes crossing the shape
 * from crossing the gap in a concave one — and, among those, the nearest.
 */
function linkChains(chains: readonly Chain[], ring: readonly Point[]): number[] {
  const order = chains
    .map((_, index) => index)
    .sort((a, b) => chains[a]!.spanOut - chains[b]!.spanOut);
  const next = new Array<number>(chains.length).fill(-1);
  const taken = new Set<number>();

  for (const from of order) {
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestInside = false;
    for (let to = 0; to < chains.length; to++) {
      if (taken.has(to)) continue;
      const exit = chains[from]!.points[chains[from]!.points.length - 1]!;
      const entry = chains[to]!.points[0]!;
      const midpoint: Point = [(exit[0] + entry[0]) / 2, (exit[1] + entry[1]) / 2];
      const inside = samePoint(exit, entry) || insidePolygon(midpoint, ring);
      const distance = Math.abs(chains[to]!.spanIn - chains[from]!.spanOut);
      // An inside connection always beats an outside one; among equals the
      // nearest along the cut wins.
      const better = inside === bestInside ? distance < bestDistance : inside;
      if (better) {
        best = to;
        bestDistance = distance;
        bestInside = inside;
      }
    }
    if (best < 0) continue;
    next[from] = best;
    taken.add(best);
  }
  return next;
}

/** Trace the chain cycles into finished rings. */
function assembleRings(chains: readonly Chain[], next: readonly number[]): Point[][] {
  const rings: Point[][] = [];
  const visited = new Set<number>();
  for (let start = 0; start < chains.length; start++) {
    if (visited.has(start)) continue;
    const points: Point[] = [];
    let cursor = start;
    for (let step = 0; step <= chains.length; step++) {
      if (visited.has(cursor)) break;
      visited.add(cursor);
      points.push(...chains[cursor]!.points);
      const following = next[cursor] ?? -1;
      if (following < 0) break;
      cursor = following;
    }
    const ring = cleanRing(points);
    if (ring.length >= 3 && Math.abs(polygonArea(ring)) > MIN_AREA) rings.push(ring);
  }
  return rings;
}

/**
 * Split a closed outline with the drawn cut.
 *
 * Returns every resulting piece in a stable order (one side then the other),
 * or null when the cut does not pass all the way through and the outline is
 * therefore left alone.
 */
export function splitPolygonByKnifeLine(
  polygon: readonly Point[],
  line: KnifeLine,
): Point[][] | null {
  const cut = cutFrame(line);
  if (!cut) return null;
  const ring = cleanRing(polygon);
  if (ring.length < 3 || Math.abs(polygonArea(ring)) <= MIN_AREA) return null;

  const augmented = augmentRing(ring, cut);
  if (!cutPassesThrough(augmented)) return null;

  const pieces: Point[][] = [];
  for (const side of [1, -1] as const) {
    const chains = chainsForSide(augmented, side);
    if (chains.length === 0) continue;
    // A single chain with no crossings is the whole outline on one side, which
    // means the cut only grazed it.
    if (chains.length === 1 && Number.isNaN(chains[0]!.spanIn)) return null;
    pieces.push(...assembleRings(chains, linkChains(chains, ring)));
  }

  return pieces.length >= 2 ? pieces : null;
}

// ── Open-path split ─────────────────────────────────────────────────────────

/**
 * Split an open polyline wherever the drawn cut crosses it.
 *
 * Unlike a closed outline there is nothing to re-close: each crossing simply
 * ends one piece and begins the next, and the endpoints and their caps carry
 * through to the pieces that still own them.
 */
export function splitPolylineByKnifeLine(
  polyline: readonly Point[],
  line: KnifeLine,
): Point[][] | null {
  const cut = cutFrame(line);
  if (!cut || polyline.length < 2) return null;

  const pieces: Point[][] = [];
  let current: Point[] = [polyline[0]!];
  for (let index = 0; index < polyline.length - 1; index++) {
    const from = polyline[index]!;
    const to = polyline[index + 1]!;
    const dFrom = cut.distance(from);
    const dTo = cut.distance(to);
    const crosses =
      (dFrom > ON_LINE_DISTANCE && dTo < -ON_LINE_DISTANCE) ||
      (dFrom < -ON_LINE_DISTANCE && dTo > ON_LINE_DISTANCE);
    if (crosses) {
      const ratio = dFrom / (dFrom - dTo);
      const crossing: Point = [
        from[0] + (to[0] - from[0]) * ratio,
        from[1] + (to[1] - from[1]) * ratio,
      ];
      const span = cut.span(crossing);
      if (span >= -SPAN_TOLERANCE && span <= 1 + SPAN_TOLERANCE) {
        current.push(crossing);
        pieces.push(current);
        current = [crossing];
      }
    }
    current.push(to);
  }
  pieces.push(current);

  const kept = pieces.filter((piece) => cleanRing(piece).length >= 2);
  return kept.length >= 2 ? kept : null;
}

/**
 * Broad phase: does the dragged segment reach this node's world bounds?
 *
 * Every rejection the tool reports is filtered through this. Without it, a cut
 * anywhere on the canvas would announce every live text layer in the document
 * as unsupported — accurate, useless, and impossible to act on.
 *
 * Liang-Barsky slab clipping: a segment misses an axis-aligned box exactly when
 * the parameter interval it survives on one axis is disjoint from the other's.
 */
function cutReachesRect(
  line: KnifeLine,
  rect: { x: number; y: number; w: number; h: number },
): boolean {
  const dx = line.end[0] - line.start[0];
  const dy = line.end[1] - line.start[1];
  let enter = 0;
  let exit = 1;

  const clip = (delta: number, origin: number, low: number, high: number): boolean => {
    if (Math.abs(delta) < ON_LINE_DISTANCE) return origin >= low && origin <= high;
    const t0 = (low - origin) / delta;
    const t1 = (high - origin) / delta;
    enter = Math.max(enter, Math.min(t0, t1));
    exit = Math.min(exit, Math.max(t0, t1));
    return enter <= exit;
  };

  if (!clip(dx, line.start[0], rect.x, rect.x + rect.w)) return false;
  if (!clip(dy, line.start[1], rect.y, rect.y + rect.h)) return false;
  return enter <= exit;
}

// ── Node eligibility ────────────────────────────────────────────────────────

function buildParentIndex(doc: Document): Map<NodeId, NodeId> {
  const parents = new Map<NodeId, NodeId>();
  for (const node of Object.values(doc.nodes)) {
    if (!isContainer(node)) continue;
    for (const childId of node.children) parents.set(childId, node.id);
  }
  return parents;
}

function isEffectivelyLocked(
  doc: Document,
  id: NodeId,
  parents: ReadonlyMap<NodeId, NodeId>,
): boolean {
  const visited = new Set<NodeId>();
  let current: SceneNode | undefined = doc.nodes[id];
  while (current && !visited.has(current.id)) {
    if (current.locked) return true;
    visited.add(current.id);
    const parentId = parents.get(current.id);
    current = parentId ? doc.nodes[parentId] : undefined;
  }
  return false;
}

/**
 * Why this node cannot be cut, or null when it can.
 *
 * Nodes that are simply not the knife's business — locked, hidden, containers
 * — are filtered out before this and never produce a reason, so every reason
 * returned here is worth telling the user about. Exported so the hover overlay
 * shows eligibility from the same rules the commit uses, instead of a second
 * copy that can drift out of agreement with it.
 */
export function knifeRejectionFor(node: SceneNode): KnifeSkipReason | null {
  if (node.kind === 'text') return 'text';
  if (node.kind !== 'shape') return 'unsupported-shape';
  return sliceRejection(node);
}

function sliceRejection(node: ShapeNode): KnifeSkipReason | null {
  // Live warps, masks, traces and background removal all mean the painted
  // outline is not the stored one. Cutting the stored geometry would move
  // pixels the user can see.
  if (node.warps?.length || node.mask || node.liveTrace || node.backgroundRemoval) {
    return 'modified-geometry';
  }
  if (node.shapeless) return 'unsupported-shape';

  switch (node.shape.kind) {
    case 'rect':
    case 'ellipse':
    case 'circle':
    case 'polygon':
    case 'star':
    case 'line':
      return null;
    case 'path':
      // A compound path's holes would each need re-assigning to whichever
      // piece still contains them. Until that is implemented, leaving the
      // path whole is better than dropping its holes.
      if (node.shape.holes && node.shape.holes.length > 0) return 'compound-path';
      return null;
    case 'arrow':
    case 'table':
      return 'unsupported-shape';
  }
}

// ── Local geometry reconstruction ───────────────────────────────────────────

function pointToPathPoint(point: Point) {
  return { x: point[0], y: point[1], handleIn: null, handleOut: null } as const;
}

function toLocal(
  points: readonly Point[],
  inverse: NonNullable<ReturnType<typeof tryInvertAffine>>,
) {
  return points.map((point) => pointToPathPoint(applyAffine(inverse, point)));
}

function boundsOf(points: readonly { x: number; y: number }[]) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Re-anchor an image fill so a piece keeps painting the exact same pixels.
 *
 * Image placement is resolved against the node's own local bounds, so a piece
 * with smaller bounds would re-fit the picture and shift it. Every fit mode
 * lands the source in some rectangle; recording that rectangle explicitly as a
 * `crop` placement, offset by the piece's own origin, reproduces it without
 * copying a single pixel — both pieces keep referencing the one asset.
 *
 * Returns null when the placement cannot be expressed that way, which is the
 * signal to leave the image alone rather than shift it.
 */
function reanchorImageFill(
  fill: Fill,
  sourceBounds: { x: number; y: number; w: number; h: number },
  pieceBounds: { x: number; y: number; w: number; h: number },
): Fill | null {
  const image = fill.image;
  if (!image) return fill;

  const offsetX = image.x ?? 0;
  const offsetY = image.y ?? 0;
  const scale = image.scale ?? 1;

  // 'crop' and 'tile' already position the source relative to the bounds
  // origin at a fixed size, so cancelling the origin shift is exact — and for
  // tile it also keeps the piece on the same tile lattice.
  if (image.fit === 'crop' || image.fit === 'tile') {
    return {
      ...fill,
      image: {
        ...image,
        x: offsetX + (sourceBounds.x - pieceBounds.x),
        y: offsetY + (sourceBounds.y - pieceBounds.y),
      },
    };
  }

  const sourceWidth = image.imageWidth;
  const sourceHeight = image.imageHeight;
  // Without the natural size there is no way to know where the source landed.
  if (!sourceWidth || !sourceHeight || sourceWidth <= 0 || sourceHeight <= 0) return null;

  const aspect = sourceWidth / sourceHeight;
  const boundsAspect = sourceBounds.w / sourceBounds.h;
  let drawWidth: number;
  let drawHeight: number;
  if (image.fit === 'stretch') {
    // Non-uniform by construction: a single crop scale cannot express it.
    return null;
  }
  if (image.fit === 'fit') {
    if (aspect > boundsAspect) {
      drawWidth = sourceBounds.w;
      drawHeight = sourceBounds.w / aspect;
    } else {
      drawHeight = sourceBounds.h;
      drawWidth = sourceBounds.h * aspect;
    }
  } else if (aspect > boundsAspect) {
    drawHeight = sourceBounds.h;
    drawWidth = sourceBounds.h * aspect;
  } else {
    drawWidth = sourceBounds.w;
    drawHeight = sourceBounds.w / aspect;
  }
  drawWidth *= scale;
  drawHeight *= scale;
  if (!(drawWidth > 0) || !(drawHeight > 0)) return null;

  const drawX = sourceBounds.x + offsetX + (sourceBounds.w - drawWidth) / 2;
  const drawY = sourceBounds.y + offsetY + (sourceBounds.h - drawHeight) / 2;

  return {
    ...fill,
    image: {
      ...image,
      fit: 'crop',
      scale: drawWidth / sourceWidth,
      x: drawX - pieceBounds.x,
      y: drawY - pieceBounds.y,
    },
  };
}

/** `null` means the placement cannot be preserved, so the node must be left alone. */
function reanchorFills(
  node: ShapeNode,
  sourceBounds: { x: number; y: number; w: number; h: number },
  pieceBounds: { x: number; y: number; w: number; h: number },
): Fill[] | undefined | null {
  if (!node.fills?.length) return undefined;
  const out: Fill[] = [];
  for (const fill of node.fills) {
    if (fill.type !== 'image' && fill.type !== 'pattern') {
      out.push(fill);
      continue;
    }
    const reanchored = reanchorImageFill(fill, sourceBounds, pieceBounds);
    if (!reanchored) return null;
    out.push(reanchored);
  }
  return out;
}

interface SplitGeometry {
  shape: Shape;
  /** Replacement fill stack, or undefined to keep the source node's own. */
  fills: Fill[] | undefined;
}

function splitShapeGeometry(
  doc: Document,
  node: ShapeNode,
  line: KnifeLine,
): SplitGeometry[] | KnifeSkipReason {
  const worldTransform = nodeWorldTransform(doc, node.id);
  const inverse = tryInvertAffine(worldTransform);
  if (!inverse) return 'unsupported-shape';

  const localBounds = boundsOf(
    shapeToPolygon(node.shape, [1, 0, 0, 1, 0, 0]).map((p) => ({ x: p.x, y: p.y })),
  );

  const openShape =
    node.shape.kind === 'line' || (node.shape.kind === 'path' && !node.shape.closed)
      ? node.shape
      : null;
  if (openShape) {
    const polyline = shapeToPolygon(node.shape, worldTransform).map(
      (point) => [point.x, point.y] as Point,
    );
    const parts = splitPolylineByKnifeLine(polyline, line);
    if (!parts) return 'no-full-crossing';
    const tolerance = openShape.tolerance;
    return parts.map((part) => ({
      shape: {
        kind: 'path' as const,
        points: toLocal(part, inverse),
        closed: false,
        tolerance,
      },
      fills: undefined,
    }));
  }

  const polygon = shapeToPolygon(node.shape, worldTransform).map(
    (point) => [point.x, point.y] as Point,
  );
  const parts = splitPolygonByKnifeLine(polygon, line);
  if (!parts) return 'no-full-crossing';

  const tolerance = node.shape.kind === 'path' ? node.shape.tolerance : 3;
  const fillRule = node.shape.kind === 'path' ? node.shape.fillRule : undefined;

  const out: SplitGeometry[] = [];
  for (const part of parts) {
    const points = toLocal(part, inverse);
    const fills = reanchorFills(node, localBounds, boundsOf(points));
    if (fills === null) return 'unsupported-image-placement';
    out.push({
      shape: {
        kind: 'path',
        points,
        closed: true,
        tolerance,
        ...(fillRule ? { fillRule } : {}),
      },
      fills,
    });
  }
  return out;
}

// ── Target acquisition ──────────────────────────────────────────────────────

interface Candidate {
  node: ShapeNode | SceneNode;
  reason: KnifeSkipReason | null;
}

/**
 * Descend to the leaf artwork under each root.
 *
 * Containers are traversed, never cut: a group's bounding box intersecting the
 * knife says nothing about whether its contents do, and slicing hierarchy
 * rather than geometry is exactly the mistake that makes a cut destroy a
 * layout. Text is surfaced as a rejection rather than skipped silently, so the
 * tool can say why it did nothing.
 */
function collectCandidates(doc: Document, roots: readonly NodeId[]): Candidate[] {
  const result: Candidate[] = [];
  const visited = new Set<NodeId>();
  const parents = buildParentIndex(doc);

  const visit = (id: NodeId) => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = doc.nodes[id];
    if (!node || node.visible === false) return;
    if (isEffectivelyLocked(doc, id, parents)) return;
    if (node.kind === 'text') {
      result.push({ node, reason: 'text' });
      return;
    }
    if (node.kind === 'shape') {
      result.push({ node, reason: sliceRejection(node) });
      return;
    }
    if (!isContainer(node)) return;
    for (const childId of node.children) visit(childId);
  };

  for (const root of roots) visit(root);
  return result;
}

// ── Document mutation ───────────────────────────────────────────────────────

/**
 * Name for a piece after the first.
 *
 * A trailing number is treated as an index and advanced, so "Rectangle 1"
 * yields "Rectangle 2" the way a newly drawn rectangle would, rather than
 * accreting suffixes into "Rectangle 1 copy copy 2".
 */
function nextPieceName(taken: Set<string>, base: string): string {
  const match = /^(.*?)(\d+)$/.exec(base);
  const stem = (match ? match[1] : `${base} `) ?? `${base} `;
  let index = match ? Number(match[2]) + 1 : 2;
  let candidate = `${stem}${index}`;
  while (taken.has(candidate)) {
    index++;
    candidate = `${stem}${index}`;
  }
  taken.add(candidate);
  return candidate;
}

function siblingListFor(doc: Document, id: NodeId): readonly NodeId[] {
  const parentId = getParent(doc, id);
  const parent = parentId ? doc.nodes[parentId] : undefined;
  if (parentId && parent && isContainer(parent)) return parent.children;
  if (doc.globalChildren?.includes(id)) return doc.globalChildren;
  return doc.rootChildren;
}

function withSiblings(doc: Document, id: NodeId, siblings: NodeId[]): Document {
  const parentId = getParent(doc, id);
  const parent = parentId ? doc.nodes[parentId] : undefined;
  if (parentId && parent && isContainer(parent)) {
    return { ...doc, nodes: { ...doc.nodes, [parentId]: { ...parent, children: siblings } } };
  }
  if (doc.globalChildren?.includes(id)) return { ...doc, globalChildren: siblings };
  return { ...doc, rootChildren: siblings };
}

function replaceShapeGeometry(
  node: ShapeNode,
  id: NodeId,
  geometry: SplitGeometry,
  name: string,
): ShapeNode {
  return {
    ...node,
    id,
    name,
    shape: geometry.shape,
    ...(geometry.fills !== undefined ? { fills: geometry.fills } : {}),
    // The outline is now an explicit path, so a corner radius that used to
    // round the rect would round the cut edge as well.
    cornerRadius: undefined,
    backgroundRemoval: undefined,
    liveTrace: undefined,
  };
}

/**
 * Apply one knife cut to the whole document.
 *
 * Pure: the caller owns the transaction, so a failed or empty cut simply
 * returns the document it was given and nothing reaches history.
 */
export function sliceDocumentWithKnife(
  doc: Document,
  line: KnifeLine,
  selection: readonly NodeId[] = [],
): KnifeSliceResult {
  const roots = selection.length > 0 ? selection : activePageNodes(doc);
  const candidates = collectCandidates(doc, roots);
  const takenNames = new Set(Object.values(doc.nodes).map((node) => node.name));
  const parents = buildParentIndex(doc);
  const reached = (id: NodeId): boolean => {
    const bounds = nodeWorldBounds(doc, id, parents);
    return bounds ? cutReachesRect(line, bounds) : false;
  };

  let nextDocument = doc;
  const resultNodeIds: NodeId[] = [];
  const slicedNodeIds: NodeId[] = [];
  const skipped: KnifeSkip[] = [];

  for (const candidate of candidates) {
    const current = nextDocument.nodes[candidate.node.id];
    if (!current || current.kind !== 'shape') {
      if (candidate.reason && reached(candidate.node.id)) {
        skipped.push({
          nodeId: candidate.node.id,
          name: candidate.node.name,
          reason: candidate.reason,
        });
      }
      continue;
    }
    if (candidate.reason) {
      if (reached(current.id)) {
        skipped.push({ nodeId: current.id, name: current.name, reason: candidate.reason });
      }
      continue;
    }

    const geometry = splitShapeGeometry(nextDocument, current, line);
    if (!Array.isArray(geometry)) {
      // 'no-full-crossing' on an object the cut never came near is noise, not
      // news: only report it for objects the cut's line actually reached.
      if (geometry !== 'no-full-crossing' || reached(current.id)) {
        skipped.push({ nodeId: current.id, name: current.name, reason: geometry });
      }
      continue;
    }

    const siblings = siblingListFor(nextDocument, current.id);
    const index = siblings.indexOf(current.id);
    if (index < 0) continue;

    const nextSiblings = [...siblings];
    const pieceIds: NodeId[] = [current.id];
    let workingDoc = nextDocument;
    const nodes: Record<NodeId, SceneNode> = { ...workingDoc.nodes };

    nodes[current.id] = replaceShapeGeometry(current, current.id, geometry[0]!, current.name);

    let previousOrder = current.order;
    const followingOrder = siblings[index + 1]
      ? (workingDoc.nodes[siblings[index + 1]!]?.order ?? null)
      : null;
    for (let piece = 1; piece < geometry.length; piece++) {
      const allocated = nextNodeId(workingDoc);
      workingDoc = allocated.doc;
      const order = generateKeyBetween(previousOrder, followingOrder);
      previousOrder = order;
      nodes[allocated.id] = {
        ...replaceShapeGeometry(
          current,
          allocated.id,
          geometry[piece]!,
          nextPieceName(takenNames, current.name),
        ),
        order,
      };
      nextSiblings.splice(index + piece, 0, allocated.id);
      pieceIds.push(allocated.id);
    }

    nextDocument = withSiblings(
      { ...workingDoc, nodes: { ...workingDoc.nodes, ...nodes } },
      current.id,
      nextSiblings,
    );
    resultNodeIds.push(...pieceIds);
    slicedNodeIds.push(current.id);
  }

  return { document: nextDocument, resultNodeIds, slicedNodeIds, skipped };
}
