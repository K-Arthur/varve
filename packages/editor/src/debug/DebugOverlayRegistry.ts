/**
 * DebugOverlayRegistry — channel types, label density, and snapshot schemas
 * for the developer-only canvas debug overlay subsystem.
 *
 * All snapshot types are plain objects (serialisable where practical).
 * No internal mutable references (TransformCache, HitTestEngine, etc.)
 * are exposed directly to React.
 */

import type { NodeId, SceneNode } from '@varve/scene';
import type { Affine, Point, Rect } from '@varve/shared';

export type { Point };

// ── Channel identifiers ──────────────────────────────────────────────────────

export type DebugOverlayChannel =
  | 'geometry'
  | 'hitTest'
  | 'spatialIndex'
  | 'interaction'
  | 'selection'
  | 'performance';

// ── Label density ────────────────────────────────────────────────────────────

export type DebugLabelDensity = 'none' | 'sparse' | 'normal' | 'full';

// ── Geometry snapshot ────────────────────────────────────────────────────────

export interface DebugGeometryEntry {
  nodeId: NodeId;
  name: string;
  kind: SceneNode['kind'];
  localBounds: Rect | null;
  worldBounds: Rect | null;
  worldTransform: Affine;
  transformOrigin: Point;
  visible: boolean;
  locked: boolean;
  clipMask: boolean;
}

// ── Hit-test snapshot ────────────────────────────────────────────────────────

export interface DebugHitTestCandidate {
  nodeId: NodeId;
  name: string;
  kind: SceneNode['kind'];
  distance: number;
  passedBroadPhase: boolean;
  passedPreciseTest: boolean;
  reason: string | null;
}

export interface DebugHitTestSnapshot {
  point: Point;
  toleranceWorld: number;
  tolerancePx: number;
  candidates: DebugHitTestCandidate[];
  selected: string | null;
  depth: number;
}

// ── Spatial index snapshot ───────────────────────────────────────────────────

export interface DebugSpatialCell {
  cx: number;
  cy: number;
  cellSize: number;
  nodeCount: number;
  nodeIds: string[];
}

export interface DebugSpatialIndexSnapshot {
  cells: DebugSpatialCell[];
  queryRegion: Rect | null;
  candidateCount: number;
  stale: boolean;
}

// ── Interaction snapshot ─────────────────────────────────────────────────────

export interface DebugInteractionSnapshot {
  pointerPosition: Point | null;
  pointerType: 'mouse' | 'pen' | 'touch' | 'unknown';
  pointerId: number;
  capturedTarget: string | null;
  dragThresholdPx: number;
  longPressRadiusPx: number;
  activeModifiers: {
    shift: boolean;
    alt: boolean;
    ctrl: boolean;
    meta: boolean;
  };
  activeTool: string;
  toolSubstate: string | null;
}

// ── Selection snapshot ───────────────────────────────────────────────────────

export interface DebugSelectionSnapshot {
  selectedIds: NodeId[];
  primaryId: NodeId | null;
  focusedNodeId: NodeId | null;
  editingTarget: string | null;
  marqueeRect: Rect | null;
  selectionMode: string;
  touchMultiSelectActive: boolean;
}

// ── Performance snapshot ─────────────────────────────────────────────────────

export interface DebugPerformanceSnapshot {
  hitTestMs: number;
  boundsMs: number;
  transformLookupMs: number;
  spatialQueryMs: number;
  overlayRenderMs: number;
  pointerEventFreq: number;
  cacheHits: number;
  cacheMisses: number;
  nodesVisited: number;
  timestamp: number;
}

// ── Full debug snapshot ──────────────────────────────────────────────────────

export interface DebugSnapshot {
  timestamp: number;
  frame: number;
  geometry: DebugGeometryEntry[] | null;
  hitTest: DebugHitTestSnapshot | null;
  spatialIndex: DebugSpatialIndexSnapshot | null;
  interaction: DebugInteractionSnapshot | null;
  selection: DebugSelectionSnapshot | null;
  performance: DebugPerformanceSnapshot | null;
}
