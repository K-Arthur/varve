/**
 * SelectionOverlay — SVG overlay for selected node bounding box + handles.
 *
 * Lives in screen space (absolute, inset:0) so it is not affected by DPR or
 * the canvas backing-store resolution. All coordinates are in CSS logical pixels.
 *
 * A5: bounding box, 8 resize handles (corners + edge midpoints), rotation handle,
 *     and a single-node dimension/position readout.
 * A9: handles are interactive (pointer events) for rect shapes; drag to resize.
 *
 * Research basis: Figma/Penpot handle layout conventions; MDN SVG coordinate system.
 */
import type { ShapeNode } from '@strata/scene';
import { useCallback, useRef } from 'react';
import { useEditor } from './context';

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

interface DragState {
  handleIndex: number;
  nodeId: string;
  initX: number;
  initY: number;
  initW: number;
  initH: number;
  pointerX: number;
  pointerY: number;
}

function worldToScreen(
  wx: number,
  wy: number,
  pan: { x: number; y: number },
  zoom: number,
): [number, number] {
  return [wx * zoom + pan.x, wy * zoom + pan.y];
}

interface ScreenBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function nodeScreenBBox(
  node: ReturnType<ReturnType<typeof useEditor>['selectedNodes']>[0],
  pan: { x: number; y: number },
  zoom: number,
): ScreenBBox | null {
  const tx = node.transform[4] ?? 0;
  const ty = node.transform[5] ?? 0;

  let wx = 0,
    wy = 0,
    ww = 0,
    wh = 0;

  if (node.kind === 'shape') {
    const s = (node as ShapeNode).shape;
    if (s.kind === 'rect') {
      wx = tx + s.x;
      wy = ty + s.y;
      ww = s.w;
      wh = s.h;
    } else if (s.kind === 'ellipse') {
      wx = tx + s.cx - s.rx;
      wy = ty + s.cy - s.ry;
      ww = s.rx * 2;
      wh = s.ry * 2;
    } else if (s.kind === 'circle') {
      wx = tx + s.cx - s.r;
      wy = ty + s.cy - s.r;
      ww = s.r * 2;
      wh = s.r * 2;
    } else if (s.kind === 'line') {
      const minX = Math.min(s.from[0], s.to[0]);
      const minY = Math.min(s.from[1], s.to[1]);
      wx = tx + minX;
      wy = ty + minY;
      ww = Math.abs(s.to[0] - s.from[0]) || 4;
      wh = Math.abs(s.to[1] - s.from[1]) || 4;
    } else if (s.kind === 'polygon') {
      wx = tx + s.cx - s.radius;
      wy = ty + s.cy - s.radius;
      ww = s.radius * 2;
      wh = s.radius * 2;
    } else if (s.kind === 'star') {
      wx = tx + s.cx - s.outerRadius;
      wy = ty + s.cy - s.outerRadius;
      ww = s.outerRadius * 2;
      wh = s.outerRadius * 2;
    } else {
      return null;
    }
  } else if (node.kind === 'text') {
    wx = tx;
    wy = ty;
    ww = (node.fontSize ?? 16) * 3;
    wh = (node.fontSize ?? 16) * 1.4;
  } else if (node.kind === 'frame') {
    wx = tx;
    wy = ty;
    ww = 200;
    wh = 160;
  } else {
    return null;
  }

  const [sx, sy] = worldToScreen(wx, wy, pan, zoom);
  return { x: sx, y: sy, w: ww * zoom, h: wh * zoom };
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

function computeResize(
  handleIndex: number,
  initX: number,
  initY: number,
  initW: number,
  initH: number,
  dx: number,
  dy: number,
): { x: number; y: number; w: number; h: number } {
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

  if (w < MIN_SIZE) w = MIN_SIZE;
  if (h < MIN_SIZE) h = MIN_SIZE;

  return { x, y, w, h };
}

export function SelectionOverlay() {
  const { state, selectedNodes, setNodePosition, setNodeSize } = useEditor();
  const sel = selectedNodes();
  const dragRef = useRef<DragState | null>(null);

  const boxes = sel
    .map((n) => nodeScreenBBox(n, state.pan, state.zoom))
    .filter((b): b is ScreenBBox => b !== null);
  const bbox = unionBBox(boxes);

  const isSingle = sel.length === 1;
  const node = sel[0];
  const isRect = node?.kind === 'shape' && (node as ShapeNode).shape.kind === 'rect';
  const hasInteractiveHandles = isSingle && isRect;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, handleIndex: number) => {
      if (node?.kind !== 'shape') return;
      const s = (node as ShapeNode).shape;
      if (s.kind !== 'rect') return;

      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);

      dragRef.current = {
        handleIndex,
        nodeId: node.id,
        initX: node.transform[4] ?? 0,
        initY: node.transform[5] ?? 0,
        initW: s.w,
        initH: s.h,
        pointerX: e.clientX,
        pointerY: e.clientY,
      };
    },
    [node],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const g = dragRef.current;
      if (!g) return;

      const dx = (e.clientX - g.pointerX) / state.zoom;
      const dy = (e.clientY - g.pointerY) / state.zoom;

      const { x, y, w, h } = computeResize(
        g.handleIndex,
        g.initX,
        g.initY,
        g.initW,
        g.initH,
        dx,
        dy,
      );

      setNodePosition(g.nodeId, x, y);
      setNodeSize(g.nodeId, w, h);
    },
    [state.zoom, setNodePosition, setNodeSize],
  );

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

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
        stroke="#3b82f6"
        strokeWidth={1}
        strokeDasharray={sel.length > 1 ? '4 3' : undefined}
      />

      {isSingle && (
        <>
          <line x1={rotX} y1={y} x2={rotX} y2={rotY} stroke="#3b82f6" strokeWidth={1} />
          <circle
            cx={rotX}
            cy={rotY}
            r={HANDLE_HALF}
            fill="white"
            stroke="#3b82f6"
            strokeWidth={1.5}
          />
        </>
      )}

      {handles.map(([hx, hy], i) => (
        <rect
          key={i}
          x={hx - HANDLE_HALF}
          y={hy - HANDLE_HALF}
          width={HANDLE_HALF * 2}
          height={HANDLE_HALF * 2}
          fill="white"
          stroke="#3b82f6"
          strokeWidth={1.5}
          rx={1}
          style={{
            pointerEvents: hasInteractiveHandles ? 'auto' : 'none',
            cursor: hasInteractiveHandles ? HANDLE_CURSORS[i] : 'default',
          }}
          onPointerDown={hasInteractiveHandles ? (e) => handlePointerDown(e, i) : undefined}
        />
      ))}

      {isSingle && (
        <text
          x={x + w + 6}
          y={y + 12}
          fontSize={10}
          fill="#3b82f6"
          fontFamily="system-ui, sans-serif"
        >
          {Math.round(w / state.zoom)} by {Math.round(h / state.zoom)}
        </text>
      )}

      {isSingle && (
        <text x={x} y={y + h + 14} fontSize={10} fill="#3b82f6" fontFamily="system-ui, sans-serif">
          {nodeX}, {nodeY}
        </text>
      )}
    </svg>
  );
}
