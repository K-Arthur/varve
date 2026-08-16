import { computeFloatingOrigin } from '@varve/shared';
import { useCallback, useRef, useState } from 'react';
import { getEditorViewport } from '../../canvas/cameraState';
import { useEditor } from '../../context';
import { nodeWorldBounds } from '../../scene/world';
import './alignment-overlay.css';

interface Bounds {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DragState {
  axis: 'horizontal' | 'vertical';
  activeIndex: number;
  startMouse: number;
  initialGap: number;
}

interface SessionData {
  axis: 'horizontal' | 'vertical';
  sorted: Bounds[];
  gaps: number[];
}

// Must match the transform the canvas actually paints with
// (applyEditorCameraToCtx: floating origin) — naive world*zoom+pan drifts
// from the real paint position once panned away from world (0,0), putting
// these spacing handles somewhere other than the selection they measure.
function worldToScreenX(wx: number, zoom: number, panX: number, originX: number): number {
  return (wx - originX) * zoom + panX;
}

function worldToScreenY(wy: number, zoom: number, panY: number, originY: number): number {
  return (wy - originY) * zoom + panY;
}

export function AlignmentHandleOverlay() {
  const { state, distributeWithGap } = useEditor();
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [currentGap, setCurrentGap] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const sessionRef = useRef<SessionData | null>(null);

  const sel = state.selection;
  const doc = state.document;
  const zoom = state.zoom;
  const pan = state.pan;
  const origin = computeFloatingOrigin(
    { zoom, pan, rotation: state.cameraRotation },
    getEditorViewport(),
  );

  const computeData = useCallback(() => {
    if (sel.length < 2) return null;

    const items: Bounds[] = [];
    for (const id of sel) {
      const b = nodeWorldBounds(doc, id);
      if (b) items.push({ id, x: b.x, y: b.y, w: b.w, h: b.h });
    }
    if (items.length < 2) return null;

    const sortedH = [...items].sort((a, b) => a.x - b.x);
    const sortedV = [...items].sort((a, b) => a.y - b.y);

    const gapsH: number[] = [];
    for (let i = 0; i < sortedH.length - 1; i++) {
      const next = sortedH[i + 1]!;
      const curr = sortedH[i]!;
      gapsH.push(next.x - (curr.x + curr.w));
    }

    const gapsV: number[] = [];
    for (let i = 0; i < sortedV.length - 1; i++) {
      const next = sortedV[i + 1]!;
      const curr = sortedV[i]!;
      gapsV.push(next.y - (curr.y + curr.h));
    }

    return { items, sortedH, sortedV, gapsH, gapsV };
  }, [sel, doc]);

  const data = computeData();

  if (!data || sel.length < 2) return null;

  const { sortedH, sortedV, gapsH, gapsV } = data;

  const handlePointerDown =
    (axis: 'horizontal' | 'vertical', index: number) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const gaps = axis === 'horizontal' ? gapsH : gapsV;
      const sorted = axis === 'horizontal' ? sortedH : sortedV;
      const initialGap = gaps[index] ?? 0;
      sessionRef.current = { axis, sorted, gaps };
      setDragState({
        axis,
        activeIndex: index,
        startMouse: axis === 'horizontal' ? e.clientX : e.clientY,
        initialGap,
      });
      setCurrentGap(initialGap);
      const el = e.currentTarget as SVGElement;
      el.setPointerCapture(e.pointerId);
    };

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const ds = dragState;
      if (!ds || !sessionRef.current) return;
      const mousePos = ds.axis === 'horizontal' ? e.clientX : e.clientY;
      const delta = mousePos - ds.startMouse;
      const deltaWorld = delta / zoom;
      const newGap = Math.max(0, ds.initialGap + deltaWorld);
      setCurrentGap(Math.round(newGap));
    },
    [dragState, zoom],
  );

  /**
   * Keyboard operation for the gap sliders. These are `role="slider"` with
   * `tabIndex={0}`, so they were already reachable by Tab but had no keys
   * bound — focusable controls that could not be operated at all without a
   * pointer (WCAG 2.1.1). Arrow keys nudge by 1px, Shift+Arrow by 10px.
   */
  const handleGapKeyDown =
    (axis: 'horizontal' | 'vertical', index: number) => (e: React.KeyboardEvent) => {
      const gaps = axis === 'horizontal' ? gapsH : gapsV;
      const currentValue = gaps[index] ?? 0;
      const step = e.shiftKey ? 10 : 1;
      let nextGap: number | null = null;

      const decrease = axis === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
      const increase = axis === 'horizontal' ? 'ArrowRight' : 'ArrowDown';

      if (e.key === decrease) nextGap = Math.max(0, currentValue - step);
      else if (e.key === increase) nextGap = currentValue + step;
      else if (e.key === 'Home') nextGap = 0;
      else return;

      e.preventDefault();
      e.stopPropagation();
      distributeWithGap(axis, Math.round(nextGap));
    };

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const ds = dragState;
      if (!ds || !sessionRef.current) return;
      const mousePos = ds.axis === 'horizontal' ? e.clientX : e.clientY;
      const delta = mousePos - ds.startMouse;
      const deltaWorld = delta / zoom;
      const newGap = Math.max(0, ds.initialGap + deltaWorld);
      distributeWithGap(ds.axis, Math.round(newGap));
      setDragState(null);
      setCurrentGap(null);
      sessionRef.current = null;
      const el = e.currentTarget as SVGElement;
      el.releasePointerCapture(e.pointerId);
    },
    [dragState, zoom, distributeWithGap],
  );

  const renderHorizontalBars = () => {
    if (sortedH.length < 2) return null;
    return sortedH.slice(0, -1).map((item, i) => {
      const next = sortedH[i + 1];
      if (!next) return null;
      const left = worldToScreenX(item.x + item.w, zoom, pan.x, origin[0]);
      const right = worldToScreenX(next.x, zoom, pan.x, origin[0]);
      const midX = (left + right) / 2;
      const topY = worldToScreenY(Math.min(item.y, next.y), zoom, pan.y, origin[1]);
      const bottomY = worldToScreenY(
        Math.max(item.y + item.h, next.y + next.h),
        zoom,
        pan.y,
        origin[1],
      );
      const midY = worldToScreenY(
        (Math.max(item.y + item.h, next.y + next.h) + Math.min(item.y, next.y)) / 2,
        zoom,
        pan.y,
        origin[1],
      );

      const gap =
        currentGap !== null && dragState?.activeIndex === i && dragState?.axis === 'horizontal'
          ? currentGap
          : gapsH[i];
      const isActive = dragState?.activeIndex === i && dragState?.axis === 'horizontal';
      const isHovered = hoveredIndex === i;

      return (
        <g key={`h-bar-${item.id}-${next.id}`}>
          <line
            x1={midX}
            y1={topY}
            x2={midX}
            y2={bottomY}
            className={`alignment-handle__bar ${isActive ? 'alignment-handle__bar--active' : ''}`}
            strokeWidth={isHovered || isActive ? 3 : 2}
          />
          <circle
            cx={midX}
            cy={midY}
            r={isHovered || isActive ? 6 : 4}
            className="alignment-handle__dot alignment-handle__dot--vertical"
            onPointerDown={handlePointerDown('horizontal', i)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
            style={{ cursor: 'ew-resize' }}
            onKeyDown={handleGapKeyDown('horizontal', i)}
            role="slider"
            aria-label={`Horizontal gap handle ${i + 1}`}
            aria-valuenow={gapsH[i]}
            aria-valuemin={0}
            aria-valuetext={`${gapsH[i]} pixels`}
            tabIndex={0}
          />
          <text
            x={midX}
            y={midY - (isHovered || isActive ? 10 : 8)}
            textAnchor="middle"
            className="alignment-handle__label"
            fontSize={isActive ? 11 : 10}
          >
            {gap}px
          </text>
        </g>
      );
    });
  };

  const renderVerticalBars = () => {
    if (sortedV.length < 2) return null;
    return sortedV.slice(0, -1).map((item, i) => {
      const next = sortedV[i + 1];
      if (!next) return null;
      const top = worldToScreenY(item.y + item.h, zoom, pan.y, origin[1]);
      const bottom = worldToScreenY(next.y, zoom, pan.y, origin[1]);
      const midY = (top + bottom) / 2;
      const leftX = worldToScreenX(Math.min(item.x, next.x), zoom, pan.x, origin[0]);
      const rightX = worldToScreenX(
        Math.max(item.x + item.w, next.x + next.w),
        zoom,
        pan.x,
        origin[0],
      );
      const midX = worldToScreenX(
        (Math.max(item.x + item.w, next.x + next.w) + Math.min(item.x, next.x)) / 2,
        zoom,
        pan.x,
        origin[0],
      );

      const gap =
        currentGap !== null && dragState?.activeIndex === i && dragState?.axis === 'vertical'
          ? currentGap
          : gapsV[i];
      const isActive = dragState?.activeIndex === i && dragState?.axis === 'vertical';
      const isHovered = hoveredIndex === sortedH.length + i;

      return (
        <g key={`v-bar-${item.id}-${next.id}`}>
          <line
            x1={leftX}
            y1={midY}
            x2={rightX}
            y2={midY}
            className={`alignment-handle__bar ${isActive ? 'alignment-handle__bar--active' : ''}`}
            strokeWidth={isHovered || isActive ? 3 : 2}
          />
          <circle
            cx={midX}
            cy={midY}
            r={isHovered || isActive ? 6 : 4}
            className="alignment-handle__dot alignment-handle__dot--horizontal"
            onPointerDown={handlePointerDown('vertical', i)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onMouseEnter={() => setHoveredIndex(sortedH.length + i)}
            onMouseLeave={() => setHoveredIndex(null)}
            style={{ cursor: 'ns-resize' }}
            onKeyDown={handleGapKeyDown('vertical', i)}
            role="slider"
            aria-label={`Vertical gap handle ${i + 1}`}
            aria-valuenow={gapsV[i]}
            aria-valuemin={0}
            aria-valuetext={`${gapsV[i]} pixels`}
            tabIndex={0}
          />
          <text
            x={midX}
            y={midY - (isHovered || isActive ? 10 : 8)}
            textAnchor="middle"
            className="alignment-handle__label"
            fontSize={isActive ? 11 : 10}
          >
            {gap}px
          </text>
        </g>
      );
    });
  };

  return (
    // Not aria-hidden: this SVG contains focusable role="slider" controls with
    // accessible names. aria-hidden on the ancestor removed them from the
    // accessibility tree while the browser still let Tab focus them, which is
    // the "focusable but not exposed" failure (WCAG 4.1.2). The <title> names
    // the graphic instead.
    <svg className="alignment-handle-overlay">
      <title>Alignment spacing handles</title>
      {renderHorizontalBars()}
      {renderVerticalBars()}
    </svg>
  );
}
