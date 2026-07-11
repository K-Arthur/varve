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

import type { Affine, Point, Rect } from '@strata/shared';
import {
  applyAffine,
  computeSelectionBox,
  handlePositions,
  type ResizeHandle,
  type SelectionBox,
  simpleScreenToWorld,
  simpleWorldToScreen,
  transformRect,
  tryInvertAffine,
} from '@strata/shared';
import { Fragment, useCallback, useMemo, useRef } from 'react';
import { useEditor } from './context';
import { nodeLocalBounds, nodeWorldBounds, nodeWorldTransform } from './scene/world';
import { type SnapBoxOptions, snapSelectionBox } from './tools/snapping';
import { TransformEngine } from './transform/TransformEngine';

const HANDLE_HALF = 4;
const ROT_OFFSET = 20;
const ROT_SNAP = 15 * (Math.PI / 180);
/** Minimum screen-px between adjacent handles before collapse. */
const MIN_HANDLE_SPACING_PX = 14;

/** Return which handle indices to show based on screen-space size. */
function visibleHandles(
  boxW: number,
  boxH: number,
  zoom: number,
): { indices: Set<number>; showRotation: boolean } {
  const sw = boxW * zoom;
  const sh = boxH * zoom;
  // Tiny: only center pivot (show none of the 8, rotation shown if space)
  if (sw < MIN_HANDLE_SPACING_PX && sh < MIN_HANDLE_SPACING_PX) {
    return { indices: new Set<number>(), showRotation: false };
  }
  if (sw < MIN_HANDLE_SPACING_PX) {
    // Narrow: show only N, center, S
    return { indices: new Set([1, 5]), showRotation: true };
  }
  if (sh < MIN_HANDLE_SPACING_PX) {
    // Flat: show only W, center, E
    return { indices: new Set([3, 7]), showRotation: true };
  }
  // Normal: show all 8
  return { indices: new Set([0, 1, 2, 3, 4, 5, 6, 7]), showRotation: true };
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

  const box = useMemo<SelectionBox | null>(() => {
    const candidates = state.selection
      .map((id) => {
        const node = state.document.nodes[id];
        if (!node) return null;
        const worldMat = nodeWorldTransform(state.document, id);
        let localRect = nodeLocalBounds(node);
        if (!localRect) {
          const worldBounds = nodeWorldBounds(state.document, id);
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

  const snapOptions = useMemo<SnapBoxOptions>(() => {
    const otherBounds: Array<{ x: number; y: number; w: number; h: number }> = [];
    for (const [id] of Object.entries(state.document.nodes)) {
      if (state.selection.includes(id)) continue;
      const bounds = nodeWorldBounds(state.document, id);
      if (bounds) otherBounds.push(bounds);
    }
    return {
      zoom: state.zoom,
      otherBounds,
    };
  }, [state.document, state.selection, state.zoom]);

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
      const pointerWorld: Point = simpleScreenToWorld(
        pointerScreenX,
        pointerScreenY,
        state.zoom,
        state.pan,
      );

      const engine = new TransformEngine(state.document, state.selection, {
        bakeOnCommit: true,
        snapBox: (b) => snapSelectionBox(b, snapOptions),
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
      snapOptions,
    ],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const g = dragRef.current;
      if (!g) return;
      const pointerScreenX = e.clientX - g.canvasOffsetX;
      const pointerScreenY = e.clientY - g.canvasOffsetY;
      const pointerWorld: Point = simpleScreenToWorld(
        pointerScreenX,
        pointerScreenY,
        state.zoom,
        state.pan,
      );

      if (g.isRotation) {
        const angle = Math.atan2(pointerWorld[1] - g.center[1], pointerWorld[0] - g.center[0]);
        let angleDelta = angle - g.initialAngle;
        if (e.shiftKey) {
          angleDelta = Math.round(angleDelta / ROT_SNAP) * ROT_SNAP;
        }
        updateDoc((doc) => g.engine.rotate(angleDelta, g.center, doc));
      } else {
        updateDoc((doc) =>
          g.engine.resize(
            pointerWorld,
            g.handle,
            { centered: e.altKey, proportional: e.shiftKey },
            doc,
          ),
        );
      }
    },
    [updateDoc, state.pan, state.zoom],
  );

  const handlePointerUp = useCallback(() => {
    if (dragRef.current) {
      updateDoc((doc) => dragRef.current!.engine.commit(doc));
      commitTransaction();
    }
    dragRef.current = null;
  }, [updateDoc, commitTransaction]);

  if (!box || box.w === 0 || box.h === 0) return null;

  const handles = handlePositions(box);
  const topCenter = handles['n'];
  const [rotX, rotY] = simpleWorldToScreen(topCenter[0], topCenter[1], state.zoom, state.pan);
  const rotScreenX = rotX;
  const rotScreenY = rotY - ROT_OFFSET;

  const centerScreen = simpleWorldToScreen(box.cx, box.cy, state.zoom, state.pan);
  const topLeftScreen = simpleWorldToScreen(
    box.cx - box.w / 2,
    box.cy - box.h / 2,
    state.zoom,
    state.pan,
  );
  const rotationDeg = (box.rotation * 180) / Math.PI;

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
          const { showRotation } = visibleHandles(box.w, box.h, state.zoom);
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
                r={8}
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

      {(() => {
        const { indices } = visibleHandles(box.w, box.h, state.zoom);
        return HANDLE_KEYS.slice(0, 8).map((key, i) => {
          if (!indices.has(i)) return null;
          const [hx, hy] = handles[key];
          const [sx, sy] = simpleWorldToScreen(hx, hy, state.zoom, state.pan);
          return (
            <Fragment key={i}>
              <rect
                x={sx - 8}
                y={sy - 8}
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
      })()}

      {hasInteractiveHandles && (
        <>
          <circle
            cx={centerScreen[0]}
            cy={centerScreen[1]}
            r={8}
            fill="transparent"
            style={{ pointerEvents: 'auto', cursor: 'move' }}
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

      {sel.length > 0 && (
        <text
          x={simpleWorldToScreen(handles['ne'][0], handles['ne'][1], state.zoom, state.pan)[0] + 6}
          y={simpleWorldToScreen(handles['ne'][0], handles['ne'][1], state.zoom, state.pan)[1] + 12}
          fontSize={10}
          fill="var(--color-interactive-default)"
          fontFamily="system-ui, sans-serif"
        >
          {Math.round(box.w)} by {Math.round(box.h)}
        </text>
      )}

      {sel.length === 1 && (
        <text
          x={simpleWorldToScreen(handles['sw'][0], handles['sw'][1], state.zoom, state.pan)[0]}
          y={simpleWorldToScreen(handles['sw'][0], handles['sw'][1], state.zoom, state.pan)[1] + 14}
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
