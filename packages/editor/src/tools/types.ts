/**
 * Tool system core types — the contract each tool implements.
 *
 * Research basis: W3C Pointer Events, Figma tool architecture,
 *                 de Casteljau's algorithm for Bézier, Schneider curve fitting.
 *
 * F1: ToolContext provides every tool with current state and mutation methods.
 *     No tool directly imports context — they receive context at event time.
 * F2: CursorSpec allows per-sub-state cursor resolution through the ToolManager.
 * F3: GestureResult tells the ToolManager whether to fall through or consume.
 */

import type { Engine, PathPoint } from '@strata/engine';
import type { Document, NodeId, SceneNode } from '@strata/scene';

export type ToolId =
  | 'select'
  | 'hand'
  | 'zoom'
  | 'scale'
  | 'frame'
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'line'
  | 'arrow'
  | 'pen'
  | 'pencil'
  | 'nodeEdit'
  | 'text'
  | 'image'
  | 'slice'
  | 'eyedropper'
  | 'booleanUnion'
  | 'booleanSubtract'
  | 'booleanIntersect'
  | 'booleanExclude'
  | 'inspect';

export const DRAW_TOOL_IDS: readonly ToolId[] = [
  'frame',
  'rect',
  'ellipse',
  'polygon',
  'star',
  'line',
  'arrow',
  'pen',
  'pencil',
  'text',
  'image',
] as const;

export const NAV_TOOL_IDS: readonly ToolId[] = ['select', 'hand', 'zoom', 'scale'] as const;

export function isDrawTool(id: ToolId): boolean {
  return DRAW_TOOL_IDS.includes(id as (typeof DRAW_TOOL_IDS)[number]);
}

export function isNavTool(id: ToolId): boolean {
  return NAV_TOOL_IDS.includes(id as (typeof NAV_TOOL_IDS)[number]);
}

export interface CursorSpec {
  css: string;
  fallback?: string;
}

export type ToolCursorState = 'idle' | 'hover' | 'drag' | 'resize' | 'rotate';

export interface GestureResult {
  consumed: boolean;
  captured?: boolean;
}

export type DraftShape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; label?: string }
  | { kind: 'ellipse'; x: number; y: number; w: number; h: number; label?: string }
  | { kind: 'polygon'; x: number; y: number; w: number; h: number; sides: number; label?: string }
  | { kind: 'star'; x: number; y: number; w: number; h: number; points: number; label?: string }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; label?: string }
  | { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number; label?: string }
  | { kind: 'frame'; x: number; y: number; w: number; h: number; label?: string };

export interface ToolContext {
  document: Document;
  selection: NodeId[];
  zoom: number;
  pan: { x: number; y: number };
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  pointerType: 'mouse' | 'pen' | 'touch';
  pointerPressure: number;
  snapEnabled: boolean;
  snapGrid: number;

  createShapeAt: (
    world: { x: number; y: number },
    size?: { w: number; h: number },
    parentId?: NodeId | null,
    pathPoints?: PathPoint[],
  ) => void;
  createTextNodeAt: (
    world: { x: number; y: number },
    size?: { w: number; h: number },
    parentId?: NodeId | null,
    text?: string,
  ) => void;
  setSelection: (id: NodeId | null) => void;
  toggleSelection: (id: NodeId, additive?: boolean) => void;
  isSelected: (id: NodeId) => boolean;
  setNodePosition: (id: NodeId, x: number, y: number) => void;
  setNodeSize: (id: NodeId, w: number, h: number) => void;
  updateNode: (id: NodeId, updater: (n: SceneNode) => SceneNode) => void;
  removeSelected: () => void;
  duplicateSelected: () => void;
  reparentNode: (id: NodeId, newParentId: NodeId | null, toIndex: number) => void;
  setPan: (p: { x: number; y: number }) => void;
  setZoom: (z: number) => void;
  announce: (msg: string) => void;
  announceSelection: (selected: SceneNode[]) => void;
  announceOperation: (op: string, result: string) => void;
  setDraft: (draft: DraftShape | null) => void;
  rootNodes: () => SceneNode[];
  getNode: (id: NodeId) => SceneNode | undefined;

  canvasToWorld: (cx: number, cy: number) => { x: number; y: number };
  worldToCanvas: (wx: number, wy: number) => { x: number; y: number };
  canvasDeltaToWorld: (dx: number, dy: number) => { dx: number; dy: number };

  setPointerCapture: (pointerId: number) => void;
  releasePointerCapture: (pointerId: number) => void;

  findContainingFrame: (world: { x: number; y: number }) => NodeId | null;
  nodeWorldBounds: (n: SceneNode) => { x: number; y: number; w: number; h: number } | null;

  engine: Engine | null;
  hitTest: (world: { x: number; y: number }) => { nodeId: NodeId; node: SceneNode } | null;

  canvasElement: HTMLCanvasElement | null;

  beginTransaction: () => void;
  commitTransaction: () => void;
  abortTransaction: () => void;

  setTool: (id: ToolId) => void;
  /** Node id currently being edited in nodeEdit mode; null outside nodeEdit. */
  nodeEditTargetId: string | null;
  setNodeEditTargetId: (id: string | null) => void;
  setNodeEditSelectedAnchors: (anchors: ReadonlySet<number>) => void;

  snapPosition: (
    bounds: { x: number; y: number; w: number; h: number },
    targets: Array<{ x: number; y: number; w: number; h: number }>,
  ) => {
    x: number;
    y: number;
    guides: Array<{ axis: 'horizontal' | 'vertical'; position: number }>;
  };
}

export interface Tool {
  id: ToolId;
  cursor(state: ToolCursorState): CursorSpec;
  onActivate?(ctx: ToolContext): void;
  onDeactivate?(ctx: ToolContext): void;
  onPointerDown?(e: PointerEvent, ctx: ToolContext): GestureResult;
  onPointerMove?(e: PointerEvent, ctx: ToolContext): void;
  onPointerUp?(e: PointerEvent, ctx: ToolContext): void;
  onPointerCancel?(e: PointerEvent, ctx: ToolContext): void;
  onKeyDown?(e: KeyboardEvent, ctx: ToolContext): boolean;
  onKeyUp?(e: KeyboardEvent, ctx: ToolContext): void;
  onDoubleClick?(e: PointerEvent, ctx: ToolContext): void;
}
