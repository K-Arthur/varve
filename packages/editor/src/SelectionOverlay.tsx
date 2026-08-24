/**
 * SelectionOverlay — SVG overlay for selected node bounding box + handles.
 *
 * Lives in screen space and renders the oriented bounding box of the current
 * selection using the same world transforms as the renderer. Resize and rotate
 * gestures are handled by TransformEngine, which applies a single delta matrix
 * to all selected nodes.
 *
 * Research basis: Figma/Penpot handle layout conventions; MDN SVG coordinate system.
 */

import type { ShapeNode } from '@varve/scene';
import { buildParentIndexMap } from '@varve/scene';
import type { Affine, Camera, Point, Rect, Viewport } from '@varve/shared';
import {
  applyAffine,
  computeResizeModifiers,
  computeSelectionBox,
  handlePositions,
  type ResizeHandle,
  type SelectionBox,
  screenToWorld,
  transformRect,
  tryInvertAffine,
  worldToScreen,
} from '@varve/shared';
import { Fragment, useCallback, useMemo, useRef } from 'react';
import { CANVAS_INTERACTIVE_OVERLAY_Z_INDEX } from './canvas/overlayZIndex';
import { useEditor } from './context';
import { nodeLocalBounds, nodeWorldBounds, nodeWorldTransform } from './scene/world';
import { type SnapBoxOptions, snapSelectionBox } from './tools/snapping';
import { storeRepeatTransform } from './transform/repeatTransform';
import { type SkewAxis, TransformEngine } from './transform/TransformEngine';

const HANDLE_HALF = 4;
const ROT_OFFSET = 20;
const ROT_SNAP = 15 * (Math.PI / 180);
/** Minimum screen-px between adjacent handles before collapse. */
const MIN_HANDLE_SPACING_PX = 14;
/**
 * Minimum screen-px box dimension before skew handles render. The skew hit
 * targets are 20x20 screen px at the box edge midpoints; on a smaller box
 * they overlap the box interior and swallow the shape's own move-drag at the
 * center (a 20px box's center lies inside the 'n' target). Gate the
 * affordance so tiny selections keep working as plain move/resize targets.
 */
const MIN_SKEW_BOX_PX = 60;

/** Return which handle indices to show based on screen-space size. */
function visibleHandles(
  boxW: number,
  boxH: number,
  zoom: number,
  isSingle: boolean,
): { indices: Set<number>; showRotation: boolean } {
  const sw = boxW * zoom;
  const sh = boxH * zoom;
  // Single selection: always show all 8 handles + rotation, even at extreme
  // zoom. The handles are screen-space sized (HANDLE_HALF) so they don't
  // become microscopic — only the spacing changes.
  if (isSingle) {
    return { indices: new Set([0, 1, 2, 3, 4, 5, 6, 7]), showRotation: true };
  }
  // Multi-select: show all handles if box is large enough on screen.
  if (sw >= MIN_HANDLE_SPACING_PX && sh >= MIN_HANDLE_SPACING_PX) {
    return { indices: new Set([0, 1, 2, 3, 4, 5, 6, 7]), showRotation: false };
  }
  // Tiny multi-select: only center pivot
  if (sw < MIN_HANDLE_SPACING_PX && sh < MIN_HANDLE_SPACING_PX) {
    return { indices: new Set<number>(), showRotation: false };
  }
  if (sw < MIN_HANDLE_SPACING_PX) {
    return { indices: new Set([1, 5]), showRotation: false };
  }
  return { indices: new Set([3, 7]), showRotation: false };
}

/** Cursor per handle index: TL, T, TR, R, BR, B, BL, L */
const HANDLE_CURSORS = [
  'nwse-resize',
  'ns-resize',
  'nesw-resize',
  'ew-resize',
  'nwse-resize',
  'ns-resize',
  'nesw-resize',
  'ew-resize',
];

const HANDLE_LABELS = [
  'Top-left resize handle',
  'Top resize handle',
  'Top-right resize handle',
  'Right resize handle',
  'Bottom-right resize handle',
  'Bottom resize handle',
  'Bottom-left resize handle',
  'Left resize handle',
];

const HANDLE_KEYS: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rotation'];

interface DragState {
  engine: TransformEngine;
  handleIndex: number;
  handle: ResizeHandle;
  isRotation: boolean;
  center: Point;
  initialPointer: Point;
  initialAngle: number;
  canvasOffsetX: number;
  canvasOffsetY: number;
}

/** Drag state for corner-radius handle drag. */
interface CornerRadiusDragState {
  nodeId: string;
  initialCornerRadius: number | [number, number, number, number];
  cornerTL: number;
  initialPointer: Point;
  localBox: { x: number; y: number; w: number; h: number };
  invWorldTransform: Affine;
  canvasOffsetX: number;
  canvasOffsetY: number;
}

/** Drag state for skew handle interaction. */
interface SkewDragState {
  engine: TransformEngine;
  axis: SkewAxis;
  canvasOffsetX: number;
  canvasOffsetY: number;
}

/** Drag state for line/arrow endpoint handles. */
interface EndpointDragState {
  nodeId: string;
  /** 0 = from (start), 1 = to (end) */
  endpointIndex: 0 | 1;
  initialFrom: readonly [number, number];
  initialTo: readonly [number, number];
  initialPointer: Point;
  canvasOffsetX: number;
  canvasOffsetY: number;
  worldTransform: Affine;
  invWorldTransform: Affine;
}

const MIN_SIZE = 1;

export function computeResize(
  handleIndex: number,
  initX: number,
  initY: number,
  initW: number,
  initH: number,
  dx: number,
  dy: number,
  shiftKey: boolean = false,
  altKey: boolean = false,
): { x: number; y: number; w: number; h: number; flippedX?: boolean; flippedY?: boolean } {
  let x = initX,
    y = initY,
    w = initW,
    h = initH;

  switch (handleIndex) {
    case 0:
      x = initX + dx;
      y = initY + dy;
      w = initW - dx;
      h = initH - dy;
      break;
    case 1:
      y = initY + dy;
      h = initH - dy;
      break;
    case 2:
      y = initY + dy;
      w = initW + dx;
      h = initH - dy;
      break;
    case 3:
      w = initW + dx;
      break;
    case 4:
      w = initW + dx;
      h = initH + dy;
      break;
    case 5:
      h = initH + dy;
      break;
    case 6:
      x = initX + dx;
      w = initW - dx;
      h = initH + dy;
      break;
    case 7:
      x = initX + dx;
      w = initW - dx;
      break;
  }

  let flippedX = false;
  let flippedY = false;

  if (w < 0) {
    w = -w;
    x = x - w;
    flippedX = true;
  }
  if (h < 0) {
    h = -h;
    y = y - h;
    flippedY = true;
  }

  if (altKey) {
    const cx = initX + initW / 2;
    const cy = initY + initH / 2;
    x = cx - w / 2;
    y = cy - h / 2;
  }

  if (shiftKey) {
    const aspect = initW / initH;
    if (w / h > aspect) {
      w = h * aspect;
    } else {
      h = w / aspect;
    }
  }

  if (w < MIN_SIZE) w = MIN_SIZE;
  if (h < MIN_SIZE) h = MIN_SIZE;

  return { x, y, w, h, flippedX, flippedY };
}

export function computeRotatedLocalBBox(
  handleIndex: number,
  lb: { x: number; y: number; w: number; h: number },
  worldMat: Affine,
  invMat: Affine,
  dx: number,
  dy: number,
  shiftKey: boolean,
  altKey: boolean,
): { x: number; y: number; w: number; h: number } {
  const { x: bx, y: by, w: bw, h: bh } = lb;
  const localCorners: Record<number, [number, number]> = {
    0: [bx, by],
    1: [bx + bw / 2, by],
    2: [bx + bw, by],
    3: [bx + bw, by + bh / 2],
    4: [bx + bw, by + bh],
    5: [bx + bw / 2, by + bh],
    6: [bx, by + bh],
    7: [bx, by + bh / 2],
  };
  const localCorner = localCorners[handleIndex];
  if (!localCorner) return lb;

  const curWorld = applyAffine(worldMat, localCorner);
  const newWorld: [number, number] = [curWorld[0] + dx, curWorld[1] + dy];
  const newLocal = applyAffine(invMat, newWorld);

  let newX = bx;
  let newY = by;
  let newW = bw;
  let newH = bh;

  switch (handleIndex) {
    case 0:
      newX = newLocal[0];
      newY = newLocal[1];
      newW = bw + bx - newX;
      newH = bh + by - newY;
      break;
    case 1:
      newY = newLocal[1];
      newH = bh + by - newY;
      break;
    case 2:
      newY = newLocal[1];
      newW = newLocal[0] - bx;
      newH = bh + by - newY;
      break;
    case 3:
      newW = newLocal[0] - bx;
      break;
    case 4:
      newW = newLocal[0] - bx;
      newH = newLocal[1] - by;
      break;
    case 5:
      newH = newLocal[1] - by;
      break;
    case 6:
      newX = newLocal[0];
      newW = bw + bx - newX;
      newH = newLocal[1] - by;
      break;
    case 7:
      newX = newLocal[0];
      newW = bw + bx - newX;
      break;
  }

  if (shiftKey && bh > 0) {
    const aspect = bw / bh;
    if (newW / newH > aspect) {
      newW = newH * aspect;
    } else {
      newH = newW / aspect;
    }
  }

  if (altKey) {
    const cx = bx + bw / 2;
    const cy = by + bh / 2;
    newX = cx - newW / 2;
    newY = cy - newH / 2;
  }

  newW = Math.max(MIN_SIZE, newW);
  newH = Math.max(MIN_SIZE, newH);

  return { x: newX, y: newY, w: newW, h: newH };
}

export interface SelectionOverlayProps {
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
}

export function SelectionOverlay({ canvasRef }: SelectionOverlayProps = {}) {
  const { state, selectedNodes, updateDoc, beginTransaction, commitTransaction } = useEditor();
  const sel = selectedNodes();
  const dragRef = useRef<DragState | null>(null);
  const skewDragRef = useRef<SkewDragState | null>(null);
  const endpointDragRef = useRef<EndpointDragState | null>(null);
  const cornerRadiusDragRef = useRef<CornerRadiusDragState | null>(null);

  /**
   * Screen<->world for the overlay, using the SAME camera the renderer uses.
   *
   * This used to go through `simpleScreenToWorld` / `simpleWorldToScreen`,
   * which drop `cameraRotation` entirely. At rotation 0 those reduce to the
   * identical affine, so the bug was invisible until the view was rotated
   * (View > Rotate, or the rotate-view shortcuts) — and then the handles
   * rendered somewhere the artwork was not, and a handle drag mapped the
   * pointer to the wrong world point, so resize/rotate/skew stopped following
   * the pointer. The overlay must agree with the artwork at every rotation:
   * a selection box one transform behind the thing it is selecting is exactly
   * what makes manipulation feel broken even when the frame rate is fine.
   *
   * The viewport is read live from the canvas element because the rotation
   * term is about the viewport centre. A null canvas yields a 0x0 viewport,
   * whose centre is the origin — which is precisely the legacy behaviour, so
   * the fallback degrades to what this code did before rather than to nonsense.
   */
  const overlayViewport = (): Viewport => ({
    width: canvasRef?.current?.clientWidth ?? 0,
    height: canvasRef?.current?.clientHeight ?? 0,
  });
  const overlayCamera = (): Camera => ({
    pan: state.pan,
    zoom: state.zoom,
    rotation: state.cameraRotation,
  });
  const overlayScreenToWorld = (sx: number, sy: number): Point =>
    screenToWorld(overlayCamera(), sx, sy, overlayViewport());
  const overlayWorldToScreen = (wx: number, wy: number): Point =>
    worldToScreen(overlayCamera(), wx, wy, overlayViewport());

  // nodeWorldTransform/nodeWorldBounds walk the ancestor chain via getParent(),
  // which is O(n) per call. The overlay resolves world geometry for the whole
  // selection every render, so on a large selection (e.g. after select-all +
  // duplicate) it would be O(n²). One O(n) parent index per document keeps it
  // O(selection) — see @varve/scene coordinateService.
  const parentIndex = useMemo(() => buildParentIndexMap(state.document), [state.document]);

  const box = useMemo<SelectionBox | null>(() => {
    if (state.tool === 'marquee' || state.tool === 'ellipseMarquee' || state.tool === 'pixelLasso')
      return null;
    const candidates = state.selection
      .map((id) => {
        const node = state.document.nodes[id];
        if (!node) return null;
        const worldMat = nodeWorldTransform(state.document, id, parentIndex);
        let localRect = nodeLocalBounds(node, state.document);
        if (!localRect) {
          const worldBounds = nodeWorldBounds(state.document, id, parentIndex);
          if (!worldBounds) return null;
          const inv = tryInvertAffine(worldMat);
          if (!inv) return null;
          localRect = transformRect(inv, worldBounds);
        }
        return { localRect, worldTransform: worldMat };
      })
      .filter((c): c is { localRect: Rect; worldTransform: Affine } => c !== null);
    return computeSelectionBox(candidates);
  }, [state.document, state.selection]);

  const isSingle = sel.length === 1;
  const node = sel[0];
  const isShape = node?.kind === 'shape';
  const isFrame = node?.kind === 'frame';
  const isText = node?.kind === 'text';
  const hasInteractiveHandles = isSingle && (isShape || isFrame || isText);

  const isLineOrArrow =
    isSingle &&
    isShape &&
    node?.kind === 'shape' &&
    (node.shape?.kind === 'line' || node.shape?.kind === 'arrow');

  let fromWorld: Point | null = null;
  let toWorld: Point | null = null;
  if (isLineOrArrow && node) {
    const sn = node as ShapeNode;
    const shape = sn.shape;
    if (shape.kind === 'line' || shape.kind === 'arrow') {
      const worldMat = nodeWorldTransform(state.document, node.id, parentIndex);
      fromWorld = applyAffine(worldMat, shape.from);
      toWorld = applyAffine(worldMat, shape.to);
    }
  }

  const cornerHandlePos: Point | null = useMemo(() => {
    if (!isSingle || !node) return null;
    if (node.kind === 'frame') {
      const r = node.cornerRadius ?? 0;
      const uniform = typeof r === 'number' ? r : Array.isArray(r) ? r[0] : 0;
      if (uniform <= 0) return null;
      const localBounds = nodeLocalBounds(node);
      if (!localBounds) return null;
      const worldMat = nodeWorldTransform(state.document, node.id, parentIndex);
      const [wx, wy] = applyAffine(worldMat, [localBounds.x + uniform, localBounds.y]);
      return [wx, wy] as Point;
    }
    if (node.kind === 'shape') {
      const s = (node as ShapeNode).shape;
      if (s.kind !== 'rect') return null;
      const r = node.cornerRadius ?? 0;
      const uniform = typeof r === 'number' ? r : Array.isArray(r) ? r[0] : 0;
      if (uniform <= 0) return null;
      const worldMat = nodeWorldTransform(state.document, node.id, parentIndex);
      const [wx, wy] = applyAffine(worldMat, [s.x + uniform, s.y]);
      return [wx, wy] as Point;
    }
    return null;
  }, [isSingle, node, state.document]);

  // Snap targets for handle drags. Built ONCE when a handle drag begins
  // (handlePointerDown / handleSkewPointerDown), not as a render memo: the
  // previous `useMemo` keyed on [document, selection, zoom] re-walked every
  // node in the document on every render — including during SelectTool move
  // drags where snap is never consulted — an O(N) nodeWorldBounds pass per
  // pointermove sample on large documents. Other nodes do not move during a
  // handle drag, so a static snapshot is also more correct than per-sample
  // rebuilds.
  const snapOptionsRef = useRef<SnapBoxOptions | null>(null);
  const buildSnapOptions = useCallback((): SnapBoxOptions => {
    if (snapOptionsRef.current) return snapOptionsRef.current;
    const otherBounds: Array<{ x: number; y: number; w: number; h: number }> = [];
    for (const [id] of Object.entries(state.document.nodes)) {
      if (state.selection.includes(id)) continue;
      const bounds = nodeWorldBounds(state.document, id, parentIndex);
      if (bounds) otherBounds.push(bounds);
    }
    snapOptionsRef.current = { zoom: state.zoom, otherBounds };
    return snapOptionsRef.current;
  }, [state.document, state.selection, state.zoom, parentIndex]);

  const releaseSnapOptions = useCallback(() => {
    snapOptionsRef.current = null;
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, handleIndex: number) => {
      if (!hasInteractiveHandles || !box) return;
      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);

      const canvasEl = canvasRef?.current;
      const rect = canvasEl?.getBoundingClientRect();
      const canvasOffsetX = rect?.left ?? 0;
      const canvasOffsetY = rect?.top ?? 0;
      const pointerScreenX = e.clientX - canvasOffsetX;
      const pointerScreenY = e.clientY - canvasOffsetY;
      const pointerWorld: Point = overlayScreenToWorld(pointerScreenX, pointerScreenY);

      const engine = new TransformEngine(state.document, state.selection, {
        bakeOnCommit: true,
        snapBox: (b) => snapSelectionBox(b, buildSnapOptions()),
      });
      beginTransaction();

      const isRotation = handleIndex === 8;
      const handle: ResizeHandle = isRotation
        ? 'rotation'
        : (HANDLE_KEYS[handleIndex] as ResizeHandle);
      const center: Point = [box.cx, box.cy];
      const initialAngle = Math.atan2(pointerWorld[1] - center[1], pointerWorld[0] - center[0]);

      dragRef.current = {
        engine,
        handleIndex,
        handle,
        isRotation,
        center,
        initialPointer: pointerWorld,
        initialAngle,
        canvasOffsetX,
        canvasOffsetY,
      };
    },
    [
      hasInteractiveHandles,
      box,
      canvasRef,
      state.pan,
      state.zoom,
      state.document,
      state.selection,
      beginTransaction,
      buildSnapOptions,
    ],
  );

  const handleSkewPointerDown = useCallback(
    (e: React.PointerEvent, axis: SkewAxis) => {
      if (!hasInteractiveHandles || !box) return;
      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      const canvasEl = canvasRef?.current;
      const rect = canvasEl?.getBoundingClientRect();
      const canvasOffsetX = rect?.left ?? 0;
      const canvasOffsetY = rect?.top ?? 0;
      const engine = new TransformEngine(state.document, state.selection, {
        bakeOnCommit: true,
        snapBox: (b) => snapSelectionBox(b, buildSnapOptions()),
      });
      beginTransaction();
      skewDragRef.current = { engine, axis, canvasOffsetX, canvasOffsetY };
    },
    [
      hasInteractiveHandles,
      box,
      canvasRef,
      state.document,
      state.selection,
      beginTransaction,
      buildSnapOptions,
    ],
  );

  const handleEndpointPointerDown = useCallback(
    (e: React.PointerEvent, endpointIndex: 0 | 1) => {
      if (!isLineOrArrow || !node) return;
      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      const canvasEl = canvasRef?.current;
      const rect = canvasEl?.getBoundingClientRect();
      const canvasOffsetX = rect?.left ?? 0;
      const canvasOffsetY = rect?.top ?? 0;
      const pointerScreenX = e.clientX - canvasOffsetX;
      const pointerScreenY = e.clientY - canvasOffsetY;
      const pw: Point = overlayScreenToWorld(pointerScreenX, pointerScreenY);
      const sn = node as ShapeNode;
      const shape = sn.shape;
      if (shape.kind !== 'line' && shape.kind !== 'arrow') return;
      const worldMat = nodeWorldTransform(state.document, node.id, parentIndex);
      const invMat = tryInvertAffine(worldMat);
      if (!invMat) return;
      beginTransaction();
      endpointDragRef.current = {
        nodeId: node.id,
        endpointIndex,
        initialFrom: [...shape.from] as [number, number],
        initialTo: [...shape.to] as [number, number],
        initialPointer: pw,
        canvasOffsetX,
        canvasOffsetY,
        worldTransform: worldMat,
        invWorldTransform: invMat,
      };
    },
    [isLineOrArrow, node, canvasRef, state.zoom, state.pan, state.document, beginTransaction],
  );

  const handleCornerRadiusPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!isSingle || !node) return;
      let localRect: { x: number; y: number; w: number; h: number } | null = null;
      if (node.kind === 'frame') {
        localRect = nodeLocalBounds(node);
      } else if (node.kind === 'shape') {
        const s = (node as ShapeNode).shape;
        if (s.kind === 'rect') localRect = { x: s.x, y: s.y, w: s.w, h: s.h };
      }
      if (!localRect) return;
      const cr = (node as import('@varve/scene').ShapeNode).cornerRadius ?? 0;
      const uniform = typeof cr === 'number' ? cr : Array.isArray(cr) ? cr[0] : 0;
      if (uniform <= 0) return;

      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      const canvasEl = canvasRef?.current;
      const rect = canvasEl?.getBoundingClientRect();
      const canvasOffsetX = rect?.left ?? 0;
      const canvasOffsetY = rect?.top ?? 0;
      const pointerScreenX = e.clientX - canvasOffsetX;
      const pointerScreenY = e.clientY - canvasOffsetY;
      const pw: Point = overlayScreenToWorld(pointerScreenX, pointerScreenY);
      const worldMat = nodeWorldTransform(state.document, node.id, parentIndex);
      const invMat = tryInvertAffine(worldMat);
      if (!invMat) return;
      beginTransaction();
      cornerRadiusDragRef.current = {
        nodeId: node.id,
        initialCornerRadius: cr as number | [number, number, number, number],
        cornerTL: uniform,
        initialPointer: pw,
        localBox: localRect,
        invWorldTransform: invMat,
        canvasOffsetX,
        canvasOffsetY,
      };
    },
    [isSingle, node, canvasRef, state.zoom, state.pan, state.document, beginTransaction],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Handle endpoint drag
      const epDrag = endpointDragRef.current;
      if (epDrag) {
        const pointerScreenX = e.clientX - epDrag.canvasOffsetX;
        const pointerScreenY = e.clientY - epDrag.canvasOffsetY;
        const pw: Point = overlayScreenToWorld(pointerScreenX, pointerScreenY);
        const worldDx = pw[0] - epDrag.initialPointer[0];
        const worldDy = pw[1] - epDrag.initialPointer[1];
        // Convert world delta to local delta
        const localDelta = applyAffine(epDrag.invWorldTransform, [
          epDrag.initialPointer[0] + worldDx,
          epDrag.initialPointer[1] + worldDy,
        ]);
        const originalLocal = applyAffine(epDrag.invWorldTransform, epDrag.initialPointer);
        const dLocalX = localDelta[0] - originalLocal[0];
        const dLocalY = localDelta[1] - originalLocal[1];
        let newFrom = epDrag.initialFrom;
        let newTo = epDrag.initialTo;
        if (epDrag.endpointIndex === 0) {
          newFrom = [epDrag.initialFrom[0] + dLocalX, epDrag.initialFrom[1] + dLocalY] as [
            number,
            number,
          ];
        } else {
          newTo = [epDrag.initialTo[0] + dLocalX, epDrag.initialTo[1] + dLocalY] as [
            number,
            number,
          ];
        }
        updateDoc((doc) => {
          const n = doc.nodes[epDrag.nodeId];
          if (n?.kind !== 'shape') return doc;
          return {
            ...doc,
            nodes: {
              ...doc.nodes,
              [epDrag.nodeId]: {
                ...n,
                shape: {
                  ...n.shape,
                  from: newFrom,
                  to: newTo,
                } as import('@varve/engine').Shape,
              },
            },
          } as import('@varve/scene').Document;
        });
        return;
      }
      const sk = skewDragRef.current;
      if (sk) {
        const skScreenX = e.clientX - sk.canvasOffsetX;
        const skScreenY = e.clientY - sk.canvasOffsetY;
        const skWorld: Point = overlayScreenToWorld(skScreenX, skScreenY);
        updateDoc((doc) => sk.engine.skew(skWorld, sk.axis, doc));
        return;
      }
      const g = dragRef.current;
      if (!g) return;
      const pointerScreenX = e.clientX - g.canvasOffsetX;
      const pointerScreenY = e.clientY - g.canvasOffsetY;
      const pointerWorld: Point = overlayScreenToWorld(pointerScreenX, pointerScreenY);

      if (g.isRotation) {
        const angle = Math.atan2(pointerWorld[1] - g.center[1], pointerWorld[0] - g.center[0]);
        let angleDelta = angle - g.initialAngle;
        if (e.shiftKey) {
          angleDelta = Math.round(angleDelta / ROT_SNAP) * ROT_SNAP;
        }
        updateDoc((doc) => g.engine.rotate(angleDelta, g.center, doc));
      } else {
        const defaultPolicy = g.engine.getResizePolicy({});
        const mods = computeResizeModifiers(
          e.shiftKey,
          e.altKey,
          e.ctrlKey,
          e.metaKey,
          g.engine.isAllRaster(),
          typeof navigator !== 'undefined' &&
            (navigator.platform?.toLowerCase().includes('mac') ?? false),
          g.handle.length === 1,
          defaultPolicy.proportional,
        );
        // C4: Ctrl/Cmd + resize on a frame = scale frame and contents together.
        // Default frame resize preserves child positions unless they have constraints.
        const isFrameResize = g.engine.isAllRaster() === false;
        const scaleContents = mods.bypassSnap && isFrameResize;
        updateDoc((doc) =>
          g.engine.resize(
            pointerWorld,
            g.handle,
            {
              centered: mods.centered,
              proportional: mods.proportional,
              bypassSnap: mods.bypassSnap,
              scaleContents,
            },
            doc,
          ),
        );
      }
      // Handle corner radius drag
      const crDrag = cornerRadiusDragRef.current;
      if (crDrag) {
        const pointerScreenX = e.clientX - crDrag.canvasOffsetX;
        const pointerScreenY = e.clientY - crDrag.canvasOffsetY;
        const pw: Point = overlayScreenToWorld(pointerScreenX, pointerScreenY);
        const localP = applyAffine(crDrag.invWorldTransform, pw);
        // Distance from top-left corner to pointer in local space
        const dx = localP[0] - crDrag.localBox.x;
        const dy = localP[1] - crDrag.localBox.y;
        const maxR = Math.min(crDrag.localBox.w, crDrag.localBox.h) / 2;
        const newRadius = Math.max(0, Math.min(Math.max(dx, dy), maxR));
        updateDoc((doc) => {
          const nn = doc.nodes[crDrag.nodeId];
          if (!nn) return doc;
          return {
            ...doc,
            nodes: {
              ...doc.nodes,
              [crDrag.nodeId]: {
                ...nn,
                cornerRadius: newRadius,
              } as import('@varve/scene').SceneNode,
            },
          } as import('@varve/scene').Document;
        });
        return;
      }
    },
    [updateDoc, state.pan, state.zoom],
  );

  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag) {
      storeRepeatTransform(drag.engine.getLastDelta(), state.selection);
      updateDoc((doc) => drag.engine.commit(doc));
      commitTransaction();
    }
    const epDrag = endpointDragRef.current;
    endpointDragRef.current = null;
    if (epDrag) {
      commitTransaction();
    }
    const crDrag = cornerRadiusDragRef.current;
    cornerRadiusDragRef.current = null;
    if (crDrag) {
      commitTransaction();
    }
    const sk = skewDragRef.current;
    skewDragRef.current = null;
    if (sk) {
      storeRepeatTransform(sk.engine.getLastDelta(), state.selection);
      updateDoc((doc) => sk.engine.commit(doc));
      commitTransaction();
    }
    // The snap-target snapshot belongs to the gesture that just ended; the
    // next handle drag must observe the freshly committed document.
    releaseSnapOptions();
  }, [updateDoc, commitTransaction, releaseSnapOptions]);

  if (!box || box.w === 0 || box.h === 0) return null;

  const handles = handlePositions(box);
  const topCenter = handles.n;
  const [rotX, rotY] = overlayWorldToScreen(topCenter[0], topCenter[1]);
  const rotScreenX = rotX;
  const rotScreenY = rotY - ROT_OFFSET;

  const centerScreen = overlayWorldToScreen(box.cx, box.cy);
  const topLeftScreen = overlayWorldToScreen(box.cx - box.w / 2, box.cy - box.h / 2);
  const rotationDeg = (box.rotation * 180) / Math.PI;

  const resizeHandleTargets = (() => {
    const { indices } = visibleHandles(box.w, box.h, state.zoom, isSingle);
    return HANDLE_KEYS.slice(0, 8).map((key, i) => {
      if (!indices.has(i)) return null;
      const [hx, hy] = handles[key];
      const [sx, sy] = overlayWorldToScreen(hx, hy);
      return (
        <Fragment key={key}>
          {/* Hit target is 24x24 (WCAG 2.5.8 minimum) while the painted
              handle stays HANDLE_HALF*2 — pointer/touch accuracy must not
              be tied to the visual handle size. */}
          <rect
            x={sx - 12}
            y={sy - 12}
            width={24}
            height={24}
            fill="transparent"
            style={{
              pointerEvents: hasInteractiveHandles ? 'auto' : 'none',
              cursor: hasInteractiveHandles ? HANDLE_CURSORS[i] : 'default',
            }}
            onPointerDown={hasInteractiveHandles ? (e) => handlePointerDown(e, i) : undefined}
            onPointerUp={hasInteractiveHandles ? handlePointerUp : undefined}
            onPointerCancel={hasInteractiveHandles ? handlePointerUp : undefined}
            onLostPointerCapture={hasInteractiveHandles ? handlePointerUp : undefined}
          />
          <rect
            x={sx - HANDLE_HALF}
            y={sy - HANDLE_HALF}
            width={HANDLE_HALF * 2}
            height={HANDLE_HALF * 2}
            fill="var(--color-surface-overlay)"
            stroke="var(--color-interactive-default)"
            strokeWidth={1.5}
            rx={1}
            aria-label={HANDLE_LABELS[i]}
            pointerEvents="none"
          />
        </Fragment>
      );
    });
  })();

  return (
    <svg
      role="presentation"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'visible',
        width: '100%',
        height: '100%',
        touchAction: 'none',
        zIndex: CANVAS_INTERACTIVE_OVERLAY_Z_INDEX,
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <defs>
        <filter id="selection-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={2} result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      <rect
        x={topLeftScreen[0]}
        y={topLeftScreen[1]}
        width={box.w * state.zoom}
        height={box.h * state.zoom}
        transform={`rotate(${rotationDeg}, ${centerScreen[0]}, ${centerScreen[1]})`}
        fill="none"
        stroke="var(--color-interactive-default)"
        strokeWidth={1}
        strokeDasharray={sel.length > 1 ? '4 3' : undefined}
        filter="url(#selection-glow)"
      />

      {hasInteractiveHandles &&
        (() => {
          const { showRotation } = visibleHandles(box.w, box.h, state.zoom, isSingle);
          if (!showRotation) return null;
          return (
            <>
              <line
                x1={rotX}
                y1={rotY}
                x2={rotScreenX}
                y2={rotScreenY}
                stroke="var(--color-interactive-default)"
                strokeWidth={1}
              />
              <circle
                cx={rotScreenX}
                cy={rotScreenY}
                r={12}
                fill="transparent"
                style={{ pointerEvents: 'auto', cursor: 'grab' }}
                onPointerDown={(e) => handlePointerDown(e, 8)}
              />
              <circle
                cx={rotScreenX}
                cy={rotScreenY}
                r={HANDLE_HALF}
                fill="var(--color-surface-overlay)"
                stroke="var(--color-interactive-default)"
                strokeWidth={1.5}
                aria-label="Rotate"
                pointerEvents="none"
              />
            </>
          );
        })()}

      {hasInteractiveHandles && (
        <>
          {/* Transform-origin indicator is display-only: it has no drag
              handler, so it must stay pointer-events:none or it silently
              steals move-drag gestures that start at the selection center
              (confirmed via an E2E regression once the overlay's stacking
              was fixed to actually sit above the canvas — see
              overlayZIndex.ts). */}
          <circle
            cx={centerScreen[0]}
            cy={centerScreen[1]}
            r={8}
            fill="transparent"
            pointerEvents="none"
          />
          <circle
            cx={centerScreen[0]}
            cy={centerScreen[1]}
            r={4}
            fill="var(--color-surface-overlay)"
            stroke="var(--color-interactive-default)"
            strokeWidth={1.5}
            aria-label="Transform origin"
            pointerEvents="none"
          />
        </>
      )}

      {/* Skew handles — diamond shape at edge midpoints. Hidden below
          MIN_SKEW_BOX_PX: their 24px hit targets (WCAG 2.5.8) would cover a
          tiny box and intercept the shape's own move-drag. */}
      {hasInteractiveHandles &&
        box.w * state.zoom >= MIN_SKEW_BOX_PX &&
        box.h * state.zoom >= MIN_SKEW_BOX_PX &&
        (() => {
          const edges: Array<{
            axis: SkewAxis;
            key: string;
            pos: Point;
            cursor: string;
            label: string;
          }> = [
            {
              axis: 'n',
              key: 'skew-n',
              pos: handles.n,
              cursor: 'ns-resize',
              label: 'Skew top edge',
            },
            {
              axis: 's',
              key: 'skew-s',
              pos: handles.s,
              cursor: 'ns-resize',
              label: 'Skew bottom edge',
            },
            {
              axis: 'e',
              key: 'skew-e',
              pos: handles.e,
              cursor: 'ew-resize',
              label: 'Skew right edge',
            },
            {
              axis: 'w',
              key: 'skew-w',
              pos: handles.w,
              cursor: 'ew-resize',
              label: 'Skew left edge',
            },
          ];
          return edges.map(({ axis, key, pos, cursor, label }) => {
            const [sx, sy] = overlayWorldToScreen(pos[0], pos[1]);
            return (
              <Fragment key={key}>
                {/* Invisible hit target */}
                <rect
                  x={sx - 12}
                  y={sy - 12}
                  width={24}
                  height={24}
                  fill="transparent"
                  style={{ pointerEvents: 'auto', cursor }}
                  onPointerDown={(e) => handleSkewPointerDown(e, axis)}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  onLostPointerCapture={handlePointerUp}
                />
                {/* Diamond handle */}
                <rect
                  x={sx - HANDLE_HALF}
                  y={sy - HANDLE_HALF}
                  width={HANDLE_HALF * 2}
                  height={HANDLE_HALF * 2}
                  rx={0}
                  fill="var(--color-accent-primary)"
                  stroke="var(--color-surface-overlay)"
                  strokeWidth={1.5}
                  transform={`rotate(45, ${sx}, ${sy})`}
                  aria-label={label}
                  pointerEvents="none"
                />
              </Fragment>
            );
          });
        })()}

      {/* Resize targets follow skew targets in SVG paint order. The two
          handle families share edge midpoints; resize must win at the
          standard edge-handle hit point, while the painted skew diamond
          remains discoverable by its own accessible label. */}
      {resizeHandleTargets}

      {cornerHandlePos &&
        (() => {
          const [sx, sy] = overlayWorldToScreen(cornerHandlePos[0], cornerHandlePos[1]);
          return (
            <Fragment key="cr-handle">
              <circle
                cx={sx}
                cy={sy}
                r={12}
                fill="transparent"
                style={{ pointerEvents: 'auto', cursor: 'nwse-resize' }}
                onPointerDown={handleCornerRadiusPointerDown}
              />
              <rect
                x={sx - HANDLE_HALF}
                y={sy - HANDLE_HALF}
                width={HANDLE_HALF * 2}
                height={HANDLE_HALF * 2}
                rx={1}
                fill="var(--color-surface-overlay)"
                stroke="var(--color-accent-primary)"
                strokeWidth={1.5}
                transform={`rotate(45, ${sx}, ${sy})`}
                aria-label="Corner radius handle"
                pointerEvents="none"
              />
            </Fragment>
          );
        })()}

      {isLineOrArrow && fromWorld && toWorld && (
        <>
          {/* Endpoint handle: from (start) */}
          {(() => {
            const [sx, sy] = overlayWorldToScreen(fromWorld[0], fromWorld[1]);
            return (
              <Fragment key="ep-from">
                <circle
                  cx={sx}
                  cy={sy}
                  r={12}
                  fill="transparent"
                  style={{ pointerEvents: 'auto', cursor: 'move' }}
                  onPointerDown={(e) => handleEndpointPointerDown(e, 0)}
                />
                <circle
                  cx={sx}
                  cy={sy}
                  r={HANDLE_HALF}
                  fill="var(--color-surface-overlay)"
                  stroke="var(--color-accent-primary)"
                  strokeWidth={2}
                  aria-label="Line start point"
                  pointerEvents="none"
                />
              </Fragment>
            );
          })()}
          {/* Endpoint handle: to (end) */}
          {(() => {
            const [sx, sy] = overlayWorldToScreen(toWorld[0], toWorld[1]);
            return (
              <Fragment key="ep-to">
                <circle
                  cx={sx}
                  cy={sy}
                  r={12}
                  fill="transparent"
                  style={{ pointerEvents: 'auto', cursor: 'move' }}
                  onPointerDown={(e) => handleEndpointPointerDown(e, 1)}
                />
                <circle
                  cx={sx}
                  cy={sy}
                  r={HANDLE_HALF}
                  fill="var(--color-interactive-default)"
                  stroke="var(--color-surface-overlay)"
                  strokeWidth={2}
                  aria-label="Line end point"
                  pointerEvents="none"
                />
              </Fragment>
            );
          })()}
        </>
      )}

      {sel.length > 0 &&
        (() => {
          // Figma-style dimension pill: centered under the selection AABB.
          const [midX] = overlayWorldToScreen(box.cx, box.cy + box.h / 2);
          const [, botY] = overlayWorldToScreen(handles.s[0], handles.s[1]);
          const label = `${Math.round(box.w)} x ${Math.round(box.h)}`;
          const padX = 6;
          const padY = 3;
          const fontSize = 11;
          const approxCharW = fontSize * 0.62;
          const textW = label.length * approxCharW;
          const pillW = textW + padX * 2;
          const pillH = fontSize + padY * 2;
          const pillX = midX - pillW / 2;
          const pillY = botY + 8;
          return (
            <g className="selection-overlay__dim" aria-hidden>
              <rect
                x={pillX}
                y={pillY}
                width={pillW}
                height={pillH}
                rx={pillH / 2}
                fill="var(--color-interactive-default)"
              />
              <text
                x={midX}
                y={pillY + pillH / 2 + fontSize * 0.35}
                textAnchor="middle"
                fontSize={fontSize}
                fill="var(--color-text-on-accent)"
                fontFamily="var(--font-body, system-ui, sans-serif)"
                style={{ fontFeatureSettings: "'tnum'" }}
              >
                {label}
              </text>
            </g>
          );
        })()}

      {sel.length === 1 &&
        (() => {
          const world = nodeWorldBounds(state.document, node!.id, parentIndex);
          if (!world) return null;
          const [sx, sy] = overlayWorldToScreen(world.x, world.y + world.h);
          return (
            <text
              x={sx}
              y={sy + 14 + 22}
              fontSize={10}
              fill="var(--color-text-muted)"
              fontFamily="var(--font-body, system-ui, sans-serif)"
              style={{ fontFeatureSettings: "'tnum'" }}
            >
              {Math.round(world.x)}, {Math.round(world.y)}
            </text>
          );
        })()}
    </svg>
  );
}
