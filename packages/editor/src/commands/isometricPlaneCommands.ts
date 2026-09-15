/**
 * Explicit isometric plane operations on existing artwork.
 *
 * - `fitSelectionToPlane`: maps a selection onto a construction plane with
 *   one world-space affine (`pivot + B·(p − pivot)`), applied to each
 *   selection *root* exactly once. This is deliberately not a per-object
 *   decomposition: the Affinity "Fit to Plane" defect class comes from
 *   decomposing each object independently and inheriting one object's
 *   rotation.
 * - `unprojectSelectionFromPlane`: the validated inverse (`B⁻¹`) of the same
 *   operation, around the same pivot.
 * - `planGridArtwork`: an explicit, bounded, undoable conversion of the
 *   construction grid into ordinary vector line nodes.
 *
 * Turning a grid on never runs any of these; they are separate commands.
 */

import type { ConstructionPlane, Document, IsometricGrid, NodeId, SceneNode } from '@varve/scene';
import {
  addChild,
  addNode,
  buildParentIndexMap,
  gridLinesForViewport,
  makeGroupNode,
  makeShapeNode,
  nextNodeId,
  resolveIsometricGeometry,
} from '@varve/scene';
import type { Affine } from '@varve/shared';
import { identity, multiplyAffine, translate, tryInvertAffine } from '@varve/shared';
import { nodeWorldBounds, nodeWorldTransform } from '../scene/world';

const EPSILON = 1e-9;

export interface PlaneFitPlan {
  /** New local transforms for the selection roots. */
  transforms: Array<{ id: NodeId; transform: Affine }>;
  rootCount: number;
  locked: number;
  skipped: number;
  total: number;
}

/**
 * The affine that maps flat document artwork onto a construction plane,
 * pivoting around `pivot`:
 *
 *   world' = pivot + B · (world − pivot)
 *
 * where `B` is the plane's basis. With `inverse` the plane basis is inverted
 * (`B⁻¹`) — the exact inverse operation for artwork that was fitted around
 * the same pivot with no intervening edits.
 */
export function planeFitAffine(
  pivot: { x: number; y: number },
  plane: ConstructionPlane,
  inverse = false,
): Affine | null {
  const linear: Affine = [plane.basis[0], plane.basis[1], plane.basis[2], plane.basis[3], 0, 0];
  const applied = inverse ? tryInvertAffine(linear) : linear;
  if (!applied) return null;
  return multiplyAffine(
    translate(pivot.x, pivot.y),
    multiplyAffine(applied, translate(-pivot.x, -pivot.y)),
  );
}

function isEffectivelyLocked(
  doc: Document,
  id: NodeId,
  parentIndex: ReadonlyMap<string, string>,
): boolean {
  let current: string | null = id;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    visited.add(current);
    const node = doc.nodes[current];
    if (node?.locked) return true;
    current = parentIndex.get(current) ?? null;
  }
  return false;
}

/**
 * Plan a single world-space affine for every selection root. Descendants are
 * not visited twice (their parent's transform carries them), matching the
 * move/nudge hierarchy policy.
 */
export function planWorldAffineTransform(
  doc: Document,
  selection: readonly NodeId[],
  worldAffine: Affine,
): PlaneFitPlan {
  const parentIndex = buildParentIndexMap(doc);
  const selected = new Set(selection);
  const roots = selection.filter((id) => {
    if (!doc.nodes[id]) return false;
    const parent = parentIndex.get(id);
    return !parent || !selected.has(parent);
  });

  const transforms: PlaneFitPlan['transforms'] = [];
  let locked = 0;
  let skipped = 0;
  for (const id of roots) {
    if (isEffectivelyLocked(doc, id, parentIndex)) {
      locked++;
      continue;
    }
    const node = doc.nodes[id];
    if (!node) {
      skipped++;
      continue;
    }
    const world = nodeWorldTransform(doc, id, parentIndex);
    const parent = parentIndex.get(id);
    const parentWorld = parent ? nodeWorldTransform(doc, parent, parentIndex) : identity;
    const inverseParent = tryInvertAffine(parentWorld);
    if (!inverseParent) {
      skipped++;
      continue;
    }
    const nextWorld = multiplyAffine(worldAffine, world);
    const nextLocal = multiplyAffine(inverseParent, nextWorld);
    const changed =
      Math.abs(nextLocal[0] - node.transform[0]) > EPSILON ||
      Math.abs(nextLocal[1] - node.transform[1]) > EPSILON ||
      Math.abs(nextLocal[2] - node.transform[2]) > EPSILON ||
      Math.abs(nextLocal[3] - node.transform[3]) > EPSILON ||
      Math.abs(nextLocal[4] - node.transform[4]) > EPSILON ||
      Math.abs(nextLocal[5] - node.transform[5]) > EPSILON;
    if (!changed) {
      skipped++;
      continue;
    }
    transforms.push({ id, transform: nextLocal });
  }

  return {
    transforms,
    rootCount: roots.length,
    locked,
    skipped,
    total: selection.length,
  };
}

/** Apply a planned root-transform set to a document (one entry in history). */
export function applyPlaneFitPlan(doc: Document, plan: PlaneFitPlan): Document {
  if (plan.transforms.length === 0) return doc;
  const nodes = { ...doc.nodes };
  for (const entry of plan.transforms) {
    const node = nodes[entry.id];
    if (!node) continue;
    nodes[entry.id] = { ...node, transform: entry.transform } as SceneNode;
  }
  return { ...doc, nodes };
}

/** World-space centre of the selection, used as the default fit pivot. */
export function selectionWorldCentre(
  doc: Document,
  selection: readonly NodeId[],
): { x: number; y: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;
  for (const id of selection) {
    const bounds = nodeWorldBounds(doc, id);
    if (!bounds) continue;
    found = true;
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.w);
    maxY = Math.max(maxY, bounds.y + bounds.h);
  }
  if (!found || !Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

// ── Grid artwork ──────────────────────────────────────────────────────────────

export interface GridArtworkOptions {
  /** Document-space bounds the artwork covers (typically the page trim). */
  bounds: { x: number; y: number; w: number; h: number };
  /** Hard cap on generated line nodes. The display step coarsens to fit. */
  maxLines?: number;
  /** Major/minor stroke colours; defaults are concrete export-safe colors. */
  majorColor?: string;
  minorColor?: string;
}

export interface GridArtworkPlan {
  doc: Document;
  nodeIds: NodeId[];
  lineCount: number;
  displayStep: number;
  groupId: NodeId | null;
}

const DISPLAY_STEPS = [1, 2, 4, 8, 16, 32, 64, 128];

/**
 * Convert the construction grid into bounded, ordinary vector line geometry.
 * This is an explicit action with its own history entry; the result is
 * independent of later view/settings changes. Returns `null` when the grid
 * cannot be resolved or the requested bounds would exceed `maxLines` even at
 * the coarsest display step.
 */
export function planGridArtwork(
  doc: Document,
  grid: IsometricGrid,
  options: GridArtworkOptions,
): GridArtworkPlan | null {
  const { bounds } = options;
  const maxLines = Math.max(4, Math.min(20000, options.maxLines ?? 1200));
  if (!(bounds.w > 0) || !(bounds.h > 0)) return null;
  const geometry = resolveIsometricGeometry({
    originX: grid.originX,
    originY: grid.originY,
    spacing: grid.spacing,
    rotation: grid.rotation,
    axes: grid.axes,
  });
  if (!geometry || geometry.families.length === 0) return null;

  const corners = [
    [bounds.x, bounds.y],
    [bounds.x + bounds.w, bounds.y],
    [bounds.x + bounds.w, bounds.y + bounds.h],
    [bounds.x, bounds.y + bounds.h],
  ] as const;

  let segments: ReturnType<typeof gridLinesForViewport> = [];
  let displayStep = 1;
  let chosen = false;
  for (const step of DISPLAY_STEPS) {
    const candidate = gridLinesForViewport(geometry, {
      corners,
      displayStep: step,
      majorEvery: grid.majorEvery ?? 4,
      maxLinesPerFamily: maxLines,
    });
    if (candidate.length > 0 && candidate.length <= maxLines) {
      segments = candidate;
      displayStep = step;
      chosen = true;
      break;
    }
  }
  if (!chosen) return null;

  const majorColor = options.majorColor ?? '#5b6472';
  const minorColor = options.minorColor ?? '#8b95a5';
  let next = doc;
  const groupId = `grid-artwork-${Date.now().toString(36)}`;
  next = addNode(next, makeGroupNode(groupId, { name: 'Isometric Grid', transform: identity }));
  const nodeIds: NodeId[] = [];
  for (const segment of segments) {
    const minted = nextNodeId(next);
    next = minted.doc;
    const id = minted.id;
    const color = segment.major ? majorColor : minorColor;
    const line = makeShapeNode(
      id,
      { kind: 'line', from: [segment.x1, segment.y1], to: [segment.x2, segment.y2], tolerance: 3 },
      {
        name: segment.major ? 'Grid major' : 'Grid minor',
        transform: identity,
        strokes: [
          {
            color: {
              space: 'rgb',
              r: hexByte(color, 1),
              g: hexByte(color, 3),
              b: hexByte(color, 5),
              a: 255,
            },
            weight: segment.major ? 1 : 0.5,
            align: 'center',
            dashPattern: [],
            dashOffset: 0,
            cap: 'butt',
            join: 'miter',
            miterLimit: 4,
            visible: true,
          },
        ],
      },
    );
    next = addChild(next, groupId, line);
    nodeIds.push(id);
  }

  return { doc: next, nodeIds, lineCount: segments.length, displayStep, groupId };
}

/** `#rrggbb` → one byte, or 0 for malformed input. */
function hexByte(color: string, start: number): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return 0;
  return Number.parseInt(color.slice(start, start + 2), 16);
}
