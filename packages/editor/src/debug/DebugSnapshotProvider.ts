/**
 * DebugSnapshotProvider — read-only snapshot adapters that pull data from
 * editor state, TransformCache, HitTestEngine, and spatial index without
 * exposing mutable internal references to React.
 */

import type { Document } from '@strata/scene';
import { getParent } from '@strata/scene';
import type { Affine, Point, Rect } from '@strata/shared';
import { applyAffine, tryInvertAffine } from '@strata/shared';
import type { EditorState } from '../context/types';
import type { HitTestEngine } from '../hitTest/HitTestEngine';
import type { SpatialIndex } from '../scene/spatialIndex';
import type { TransformCache } from '../scene/transformCache';
import { getWorldBounds, getWorldTransform } from '../scene/transformCache';
import type {
  DebugGeometryEntry,
  DebugHitTestSnapshot,
  DebugInteractionSnapshot,
  DebugSelectionSnapshot,
  DebugSnapshot,
  DebugSpatialIndexSnapshot,
} from './DebugOverlayRegistry';

let frameCounter = 0;

export interface DebugSnapshotOptions {
  includeGeometry: boolean;
  includeHitTest: boolean;
  includeSpatialIndex: boolean;
  includeInteraction: boolean;
  includeSelection: boolean;
  includePerformance: boolean;
  /** World-space point for hit-test snapshots */
  hitTestPoint?: Point | null;
  /** Max entries per channel */
  maxItems: number;
}

export function buildDebugSnapshot(
  state: EditorState,
  cache: TransformCache,
  hitTestEngine: HitTestEngine | null,
  spatialIndex: SpatialIndex | null,
  opts: DebugSnapshotOptions,
): DebugSnapshot {
  frameCounter++;
  const doc = state.document;
  const now = performance.now();

  const snapshot: DebugSnapshot = {
    timestamp: Date.now(),
    frame: frameCounter,
    geometry: null,
    hitTest: null,
    spatialIndex: null,
    interaction: null,
    selection: null,
    performance: null,
  };

  if (opts.includeGeometry) {
    snapshot.geometry = buildGeometrySnapshot(doc, cache, opts.maxItems);
  }

  if (
    opts.includeHitTest &&
    opts.hitTestPoint !== undefined &&
    opts.hitTestPoint !== null &&
    hitTestEngine
  ) {
    snapshot.hitTest = buildHitTestSnapshot(
      hitTestEngine,
      opts.hitTestPoint,
      state.zoom,
      opts.maxItems,
    );
  }

  if (opts.includeSpatialIndex && spatialIndex) {
    const qp: Point | null = opts.hitTestPoint ?? null;
    snapshot.spatialIndex = buildSpatialIndexSnapshot(spatialIndex, qp);
  }

  if (opts.includeInteraction) {
    snapshot.interaction = buildInteractionSnapshot(state);
  }

  if (opts.includeSelection) {
    snapshot.selection = buildSelectionSnapshot(state);
  }

  if (opts.includePerformance) {
    snapshot.performance = {
      hitTestMs: 0,
      boundsMs: 0,
      transformLookupMs: 0,
      spatialQueryMs: 0,
      overlayRenderMs: 0,
      pointerEventFreq: 0,
      cacheHits: 0,
      cacheMisses: 0,
      nodesVisited: 0,
      timestamp: now,
    };
  }

  return snapshot;
}

function buildGeometrySnapshot(
  doc: Document,
  cache: TransformCache,
  maxItems: number,
): DebugGeometryEntry[] {
  const entries: DebugGeometryEntry[] = [];
  const pageRoots = doc.rootChildren ?? [];
  let count = 0;

  const walk = (ids: readonly string[]) => {
    for (const id of ids) {
      if (count >= maxItems) return;
      const node = doc.nodes[id];
      if (!node) continue;

      const worldTransform = getWorldTransform(cache, doc, id);
      const worldBounds = getWorldBounds(cache, doc, id);
      const parentId = getParent(doc, id);
      const parentTransform = parentId
        ? getWorldTransform(cache, doc, parentId)
        : ([1, 0, 0, 1, 0, 0] as Affine);
      const inv = tryInvertAffine(parentTransform);
      const localBounds = inv && worldBounds ? applyBounds(inv, worldBounds) : null;

      entries.push({
        nodeId: id,
        name: node.name,
        kind: node.kind,
        localBounds,
        worldBounds: worldBounds ?? null,
        worldTransform,
        transformOrigin: [worldTransform[4], worldTransform[5]],
        visible: node.visible !== false,
        locked: !!node.locked,
        clipMask: 'clipPath' in node ? !!(node as Record<string, unknown>).clipPath : false,
      });
      count++;

      if ('children' in node && node.children) {
        walk(node.children);
      }
    }
  };

  walk(pageRoots);
  return entries;
}

function buildHitTestSnapshot(
  _engine: HitTestEngine,
  _point: Point,
  _zoom: number,
  _maxItems: number,
): DebugHitTestSnapshot {
  return {
    point: _point,
    toleranceWorld: 8 / Math.max(0.001, _zoom),
    tolerancePx: 8,
    candidates: [],
    selected: null,
    depth: 0,
  };
}

function buildSpatialIndexSnapshot(
  _index: SpatialIndex,
  _queryPoint: Point | null,
): DebugSpatialIndexSnapshot {
  return {
    cells: [],
    queryRegion: null,
    candidateCount: 0,
    stale: false,
  };
}

function buildInteractionSnapshot(state: EditorState): DebugInteractionSnapshot {
  return {
    pointerPosition: state.cursorPos ? [state.cursorPos.x, state.cursorPos.y] : null,
    pointerType: 'unknown',
    pointerId: -1,
    capturedTarget: null,
    dragThresholdPx: 4,
    longPressRadiusPx: 10,
    activeModifiers: {
      shift: false,
      alt: false,
      ctrl: false,
      meta: false,
    },
    activeTool: state.tool,
    toolSubstate: null,
  };
}

function buildSelectionSnapshot(state: EditorState): DebugSelectionSnapshot {
  return {
    selectedIds: state.selection,
    primaryId: state.primaryId,
    focusedNodeId: state.focusedNodeId,
    editingTarget: null,
    marqueeRect: null,
    selectionMode: state.selectionMode,
    touchMultiSelectActive: state.touchMultiSelect.active,
  };
}

function applyBounds(m: Affine, r: Rect): Rect {
  const corners = [
    applyAffine(m, [r.x, r.y]),
    applyAffine(m, [r.x + r.w, r.y]),
    applyAffine(m, [r.x, r.y + r.h]),
    applyAffine(m, [r.x + r.w, r.y + r.h]),
  ];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of corners) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Check whether debug features should be available at runtime. */
export function isDebugBuild(): boolean {
  try {
    return typeof process !== 'undefined' && process.env?.NODE_ENV === 'development';
  } catch {
    return false;
  }
}
