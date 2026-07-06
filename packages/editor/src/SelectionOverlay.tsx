/**
 * SelectionOverlay — SVG overlay for selected node bounding box + handles.
 *
 * Lives in screen space (absolute, inset:0) so it is not affected by DPR or
 * the canvas backing-store resolution. All coordinates are in CSS logical pixels.
 *
 * Uses world transforms (nodeWorldTransform) for accurate overlay position
 * matching render, especially for nested nodes.
 *
 * Research basis: Figma/Penpot handle layout conventions; MDN SVG coordinate system.
 */

import type { SceneNode } from '@strata/scene';
import { applyAffine, tryInvertAffine } from '@strata/shared';
import { Fragment, useCallback, useRef } from 'react';
import { useEditor } from './context';
import { nodeLocalBounds, nodeWorldBounds, nodeWorldTransform } from './scene/world';

const HANDLE_HALF = 4;
const ROT_OFFSET = 20;
const MIN_SIZE = 1;

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

interface DragState {
  handleIndex: number;
  nodeId: string;
  initX: number;
  initY: number;
  initW: number;
  initH: number;
  pointerX: number;
  pointerY: number;
  nodeKind: 'shape' | 'frame' | 'text';
  shapeKind?: 'rect' | 'ellipse' | 'circle' | 'line' | 'polygon' | 'star' | 'arrow' | 'path';
  initialShape?: Record<string, unknown>;
  isRotation?: boolean;
  initialRotation?: number;
  centerX?: number;
  centerY?: number;
  canvasOffsetX?: number;
  canvasOffsetY?: number;
}

function worldToScreen(
  wx: number,
  wy: number,
  pan: { x: number; y: number },
  zoom: number,
): [number, number] {
  return [wx * zoom + pan.x, wy * zoom + pan.y];
}

function rectToScreen(
  rect: { x: number; y: number; w: number; h: number },
  pan: { x: number; y: number },
  zoom: number,
): ScreenBBox {
  const [sx, sy] = worldToScreen(rect.x, rect.y, pan, zoom);
  return { x: sx, y: sy, w: rect.w * zoom, h: rect.h * zoom };
}

interface ScreenBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function nodeScreenBBox(
  node: SceneNode,
  doc: import('@strata/scene').Document,
  pan: { x: number; y: number },
  zoom: number,
): ScreenBBox | null {
  const worldBounds = nodeWorldBounds(doc, node.id);
  if (!worldBounds) return null;
  return rectToScreen(worldBounds, pan, zoom);
}

function unionBBox(boxes: ScreenBBox[]): ScreenBBox | null {
  if (boxes.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

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

  // Alt: resize from center
  if (altKey) {
    const cx = initX + initW / 2;
    const cy = initY + initH / 2;
    x = cx - w / 2;
    y = cy - h / 2;
  }

  // Shift: constrain aspect ratio
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

/** Apply resized local bounding box to a shape node (per-kind geometry update). */
function applyShapeLocalBBox(
  nodeId: string,
  node: SceneNode,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  setNodePosition: (id: string, x: number, y: number) => void,
  setNodeSize: (id: string, w: number, h: number) => void,
  updateNode: (id: string, updater: (n: SceneNode) => SceneNode) => void,
): void {
  if (node.kind === 'shape') {
    const s = node.shape;
    if (
      s.kind === 'rect' ||
      s.kind === 'polygon' ||
      s.kind === 'star' ||
      s.kind === 'path' ||
      s.kind === 'line' ||
      s.kind === 'arrow'
    ) {
      setNodePosition(nodeId, bx, by);
      setNodeSize(nodeId, bw, bh);
    } else if (s.kind === 'ellipse') {
      setNodePosition(nodeId, bx, by);
      updateNode(nodeId, (n) => {
        if (n.kind !== 'shape') return n;
        const rx = bw / 2;
        const ry = bh / 2;
        return {
          ...n,
          shape: { ...n.shape, kind: 'ellipse', rx, ry, cx: rx, cy: ry } as typeof n.shape,
        };
      });
    } else if (s.kind === 'circle') {
      setNodePosition(nodeId, bx, by);
      updateNode(nodeId, (n) => {
        if (n.kind !== 'shape') return n;
        const r = Math.max(bw, bh) / 2;
        return {
          ...n,
          shape: { ...n.shape, kind: 'circle', r, cx: r, cy: r } as typeof n.shape,
        };
      });
    }
  } else if (node.kind === 'frame') {
    setNodePosition(nodeId, bx, by);
    setNodeSize(nodeId, bw, bh);
  } else if (node.kind === 'text') {
    setNodePosition(nodeId, bx, by);
  }
}

/** Compute new local bbox after dragging a handle on a rotated/transformed node. */
export function computeRotatedLocalBBox(
  handleIndex: number,
  lb: { x: number; y: number; w: number; h: number },
  worldMat: import('@strata/shared').Affine,
  invMat: import('@strata/shared').Affine,
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
  const {
    state,
    selectedNodes,
    setNodePosition,
    setNodeSize,
    updateNode,
    beginTransaction,
    commitTransaction,
    setSelectedRotation,
  } = useEditor();
  const sel = selectedNodes();
  const dragRef = useRef<DragState | null>(null);

  const boxes = sel
    .map((n) => nodeScreenBBox(n, state.document, state.pan, state.zoom))
    .filter((b): b is ScreenBBox => b !== null);
  const bbox = unionBBox(boxes);

  const isSingle = sel.length === 1;
  const node = sel[0];
  const isShape = node?.kind === 'shape';
  const isFrame = node?.kind === 'frame';
  const isText = node?.kind === 'text';
  const hasInteractiveHandles = isSingle && (isShape || isFrame || isText);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, handleIndex: number) => {
      if (!node) return;
      if (!hasInteractiveHandles) return;

      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);

      const worldBounds = nodeWorldBounds(state.document, node.id);
      if (!worldBounds) return;

      const initW = worldBounds.w;
      const initH = worldBounds.h;
      const initX = worldBounds.x;
      const initY = worldBounds.y;

      // Begin transaction for resize/rotation gesture
      beginTransaction();

      // Handle rotation (handleIndex 8)
      if (handleIndex === 8) {
        const centerX = worldBounds.x + worldBounds.w / 2;
        const centerY = worldBounds.y + worldBounds.h / 2;
        const canvasEl = canvasRef?.current;
        const rect = canvasEl?.getBoundingClientRect();
        dragRef.current = {
          handleIndex,
          nodeId: node.id,
          initX,
          initY,
          initW,
          initH,
          pointerX: e.clientX,
          pointerY: e.clientY,
          nodeKind: node.kind,
          isRotation: true,
          initialRotation: node.rotation ?? 0,
          centerX,
          centerY,
          canvasOffsetX: rect?.left ?? 0,
          canvasOffsetY: rect?.top ?? 0,
        };
      } else {
        dragRef.current = {
          handleIndex,
          nodeId: node.id,
          initX,
          initY,
          initW,
          initH,
          pointerX: e.clientX,
          pointerY: e.clientY,
          nodeKind: node.kind,
          shapeKind: node.kind === 'shape' ? node.shape.kind : undefined,
          initialShape: node.kind === 'shape' ? { ...node.shape } : undefined,
        };
      }
    },
    [node, state.document, hasInteractiveHandles, beginTransaction],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const g = dragRef.current;
      if (!g) return;

      // Handle rotation gesture
      if (g.isRotation) {
        const cx = g.centerX;
        const cy = g.centerY;
        if (cx === undefined || cy === undefined) return;
        const offsetX = g.canvasOffsetX ?? 0;
        const offsetY = g.canvasOffsetY ?? 0;
        const canvas = { x: e.clientX - offsetX, y: e.clientY - offsetY };
        const world = state.pan
          ? { x: (canvas.x - state.pan.x) / state.zoom, y: (canvas.y - state.pan.y) / state.zoom }
          : canvas;
        const dx = world.x - cx;
        const dy = world.y - cy;
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        const initialScreenX = g.pointerX - offsetX;
        const initialScreenY = g.pointerY - offsetY;
        const screenCenterX = cx * state.zoom + state.pan.x;
        const screenCenterY = cy * state.zoom + state.pan.y;
        const initialAngle =
          Math.atan2(initialScreenY - screenCenterY, initialScreenX - screenCenterX) *
          (180 / Math.PI);
        const deltaAngle = angle - initialAngle;
        let newRotation = (g.initialRotation ?? 0) + deltaAngle;

        // Shift: snap to 15-degree increments
        if (e.shiftKey) {
          newRotation = Math.round(newRotation / 15) * 15;
        }

        setSelectedRotation(newRotation);
        return;
      }

      // Handle resize gesture
      const dx = (e.clientX - g.pointerX) / state.zoom;
      const dy = (e.clientY - g.pointerY) / state.zoom;
      const shiftKey = e.shiftKey;
      const altKey = e.altKey;

      const node = state.document.nodes[g.nodeId];
      if (!node) return;

      const worldMat = nodeWorldTransform(state.document, g.nodeId);
      const invMat = tryInvertAffine(worldMat);
      const hasRotation =
        (node.rotation ?? 0) !== 0 || Math.abs(worldMat[1]) > 1e-6 || Math.abs(worldMat[2]) > 1e-6;

      // Rotated/transformed path: inverse world transform for all shape kinds
      if (hasRotation && node.kind === 'shape' && invMat) {
        const lb = nodeLocalBounds(node);
        if (lb) {
          const resized = computeRotatedLocalBBox(
            g.handleIndex,
            lb,
            worldMat,
            invMat,
            dx,
            dy,
            shiftKey,
            altKey,
          );
          applyShapeLocalBBox(
            g.nodeId,
            node,
            resized.x,
            resized.y,
            resized.w,
            resized.h,
            setNodePosition,
            setNodeSize,
            updateNode,
          );
          return;
        }
      }

      // Non-rotated path: compute world-space AABB and apply directly
      const { x, y, w, h } = computeResize(
        g.handleIndex,
        g.initX,
        g.initY,
        g.initW,
        g.initH,
        dx,
        dy,
        shiftKey,
        altKey,
      );

      // Convert world bounds back to local shape params
      if (node.kind === 'shape' || node.kind === 'frame' || node.kind === 'text') {
        applyShapeLocalBBox(g.nodeId, node, x, y, w, h, setNodePosition, setNodeSize, updateNode);
      }
    },
    [
      state.zoom,
      state.pan,
      state.document,
      setNodePosition,
      setNodeSize,
      updateNode,
      setSelectedRotation,
    ],
  );

  const handlePointerUp = useCallback(() => {
    if (dragRef.current) {
      commitTransaction();
    }
    dragRef.current = null;
  }, [commitTransaction]);

  if (sel.length === 0 || !bbox) return null;

  const { x, y, w, h } = bbox;

  const handles: [number, number][] = [
    [x, y],
    [x + w / 2, y],
    [x + w, y],
    [x + w, y + h / 2],
    [x + w, y + h],
    [x + w / 2, y + h],
    [x, y + h],
    [x, y + h / 2],
  ];

  const rotX = x + w / 2;
  const rotY = y - ROT_OFFSET;

  const nodeX = node ? Math.round(node.transform[4] ?? 0) : 0;
  const nodeY = node ? Math.round(node.transform[5] ?? 0) : 0;

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
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="none"
        stroke="var(--color-interactive-default)"
        strokeWidth={1}
        strokeDasharray={sel.length > 1 ? '4 3' : undefined}
      />

      {isSingle && (
        <>
          <line
            x1={rotX}
            y1={y}
            x2={rotX}
            y2={rotY}
            stroke="var(--color-interactive-default)"
            strokeWidth={1}
          />
          {/* Touch target (larger hit area, handles interaction) */}
          <circle
            cx={rotX}
            cy={rotY}
            r={8}
            fill="transparent"
            style={{ pointerEvents: hasInteractiveHandles ? 'auto' : 'none', cursor: 'grab' }}
            onPointerDown={hasInteractiveHandles ? (e) => handlePointerDown(e, 8) : undefined}
          />
          <circle
            cx={rotX}
            cy={rotY}
            r={HANDLE_HALF}
            fill="var(--color-surface-overlay)"
            stroke="var(--color-interactive-default)"
            strokeWidth={1.5}
            aria-label="Rotate"
            pointerEvents="none"
          />
        </>
      )}

      {handles.map(([hx, hy], i) => (
        <Fragment key={i}>
          {/* Touch target (larger hit area, handles interaction) */}
          <rect
            x={hx - 8}
            y={hy - 8}
            width={16}
            height={16}
            fill="transparent"
            style={{
              pointerEvents: hasInteractiveHandles ? 'auto' : 'none',
              cursor: hasInteractiveHandles ? HANDLE_CURSORS[i] : 'default',
            }}
            onPointerDown={hasInteractiveHandles ? (e) => handlePointerDown(e, i) : undefined}
          />
          <rect
            x={hx - HANDLE_HALF}
            y={hy - HANDLE_HALF}
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
      ))}

      {isSingle && (
        <>
          {/* Touch target for pivot */}
          <circle
            cx={x + w / 2}
            cy={y + h / 2}
            r={8}
            fill="transparent"
            style={{ pointerEvents: 'auto', cursor: 'move' }}
          />
          <circle
            cx={x + w / 2}
            cy={y + h / 2}
            r={4}
            fill="var(--color-surface-overlay)"
            stroke="var(--color-interactive-default)"
            strokeWidth={1.5}
            aria-label="Transform origin"
            pointerEvents="none"
          />
        </>
      )}

      {(isSingle || sel.length > 1) && (
        <text
          x={x + w + 6}
          y={y + 12}
          fontSize={10}
          fill="var(--color-interactive-default)"
          fontFamily="system-ui, sans-serif"
        >
          {Math.round(w / state.zoom)} by {Math.round(h / state.zoom)}
        </text>
      )}

      {isSingle && (
        <text
          x={x}
          y={y + h + 14}
          fontSize={10}
          fill="var(--color-interactive-default)"
          fontFamily="system-ui, sans-serif"
        >
          {nodeX}, {nodeY}
        </text>
      )}
    </svg>
  );
}
