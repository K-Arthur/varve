import { formatCoordForRuler, type RulerMode } from '@strata/shared';
import { useCallback, useEffect, useRef } from 'react';
import {
  leftRulerScreenToWorld,
  projectWorldXToTopEdge,
  projectWorldYToLeftEdge,
  topRulerScreenToWorld,
  visibleWorldSpanOnRulerEdge,
} from '../../canvas/rulerGeometry';
import './Ruler.css';

interface RulerProps {
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation?: number;
  unitType: 'px' | 'pt' | 'cm' | 'mm' | 'in' | '%';
  rulerMode?: RulerMode;
  artboard?: { x: number; y: number; w: number; h: number } | null;
  pageRulerOrigin?: { x: number; y: number };
  onAddGuide: (axis: 'horizontal' | 'vertical', position: number) => string | undefined;
  onMoveGuide?: (id: string, position: number) => void;
  canvasWidth?: number;
  canvasHeight?: number;
  /** Bumps when theme changes so the canvas-based ruler re-paints. */
  themeRevision?: number;
}

const RULER_SIZE = 20;
const TICK_HEIGHT_SMALL = 4;
const TICK_HEIGHT_MED = 8;
const TICK_HEIGHT_LARGE = 12;

function getTickInterval(zoom: number): number {
  const targetScreenPx = 80;
  const worldPx = targetScreenPx / zoom;
  const magnitude = 10 ** Math.floor(Math.log10(worldPx));
  const residual = worldPx / magnitude;
  let nice: number;
  if (residual < 1.5) nice = 1;
  else if (residual < 3.5) nice = 2;
  else if (residual < 7.5) nice = 5;
  else nice = 10;
  return nice * magnitude;
}

const UNIT_SCALE: Record<string, number> = {
  px: 1,
  pt: 1 / 0.75,
  cm: 37.8,
  mm: 3.78,
  in: 96,
  '%': 1,
};

export function Ruler({
  zoom,
  pan,
  cameraRotation = 0,
  unitType,
  rulerMode = 'global',
  artboard = null,
  pageRulerOrigin,
  onAddGuide,
  onMoveGuide,
  canvasWidth = 800,
  canvasHeight = 600,
}: RulerProps) {
  const topRulerRef = useRef<HTMLCanvasElement>(null);
  const leftRulerRef = useRef<HTMLCanvasElement>(null);
  const activeGuideDrag = useRef<{ guideId: string | null } | null>(null);

  const camState = { zoom, pan, cameraRotation };
  const viewport = { width: canvasWidth, height: canvasHeight };

  const drawRuler = useCallback(
    (ctx: CanvasRenderingContext2D, axis: 'horizontal' | 'vertical', size: number) => {
      const dpr = window.devicePixelRatio ?? 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const computed = getComputedStyle(document.documentElement);
      const bgColor = computed.getPropertyValue('--color-surface-sunken').trim() || '#f0f0f0';
      const tickColor = computed.getPropertyValue('--color-text-muted').trim() || '#888';

      ctx.clearRect(
        0,
        0,
        axis === 'horizontal' ? size : RULER_SIZE,
        axis === 'horizontal' ? RULER_SIZE : size,
      );
      ctx.fillStyle = bgColor;
      ctx.fillRect(
        0,
        0,
        axis === 'horizontal' ? size : RULER_SIZE,
        axis === 'horizontal' ? RULER_SIZE : size,
      );

      const interval = getTickInterval(zoom);
      const scale = UNIT_SCALE[unitType] ?? 1;
      const originOffset =
        rulerMode === 'artboard' && artboard
          ? axis === 'horizontal'
            ? (pageRulerOrigin?.x ?? 0) + artboard.x
            : (pageRulerOrigin?.y ?? 0) + artboard.y
          : 0;

      const span = visibleWorldSpanOnRulerEdge(axis, camState, viewport);
      const startWorld = Math.floor((span.min - originOffset) / interval) * interval + originOffset;
      const endWorld = span.max + interval * 2;

      ctx.strokeStyle = tickColor;
      ctx.fillStyle = tickColor;
      ctx.font = '9px system-ui';

      for (let w = startWorld; w <= endWorld; w += interval) {
        const screenPos =
          axis === 'horizontal'
            ? projectWorldXToTopEdge(w, camState, viewport)
            : projectWorldYToLeftEdge(w, camState, viewport);
        if (screenPos === null) continue;
        if (screenPos < -RULER_SIZE || screenPos > size + RULER_SIZE) continue;

        const isLarge = Math.abs((w - originOffset) % (interval * 5)) < 0.001;
        const isMed = Math.abs((w - originOffset) % (interval * 2)) < 0.001;

        ctx.beginPath();
        if (axis === 'horizontal') {
          ctx.moveTo(screenPos, RULER_SIZE);
          ctx.lineTo(
            screenPos,
            RULER_SIZE -
              (isLarge ? TICK_HEIGHT_LARGE : isMed ? TICK_HEIGHT_MED : TICK_HEIGHT_SMALL),
          );
        } else {
          ctx.moveTo(RULER_SIZE, screenPos);
          ctx.lineTo(
            RULER_SIZE -
              (isLarge ? TICK_HEIGHT_LARGE : isMed ? TICK_HEIGHT_MED : TICK_HEIGHT_SMALL),
            screenPos,
          );
        }
        ctx.stroke();

        if (isLarge) {
          const display = formatCoordForRuler(
            w,
            axis === 'horizontal' ? 'x' : 'y',
            rulerMode,
            artboard,
            pageRulerOrigin ? [pageRulerOrigin.x, pageRulerOrigin.y] : undefined,
          );
          const label = `${Math.round(display * scale)}`;
          if (axis === 'horizontal') {
            ctx.save();
            if (Math.abs(cameraRotation) > 1e-4) {
              ctx.translate(screenPos, RULER_SIZE - 4);
              ctx.rotate(-cameraRotation);
              ctx.fillText(label, 3, 0);
            } else {
              ctx.fillText(label, screenPos + 3, RULER_SIZE - 4);
            }
            ctx.restore();
          } else {
            ctx.save();
            ctx.translate(RULER_SIZE - 4, screenPos + 8);
            ctx.rotate(-Math.PI / 2 - cameraRotation);
            ctx.fillText(label, 0, 0);
            ctx.restore();
          }
        }
      }
    },
    [
      zoom,
      pan.x,
      pan.y,
      cameraRotation,
      unitType,
      rulerMode,
      artboard,
      pageRulerOrigin,
      canvasWidth,
      canvasHeight,
      themeRevision,
    ],
  );

  const redraw = useCallback(() => {
    const top = topRulerRef.current;
    const left = leftRulerRef.current;
    if (top?.parentElement) {
      const w = top.parentElement.clientWidth;
      const dpr = window.devicePixelRatio ?? 1;
      top.width = w * dpr;
      top.height = RULER_SIZE * dpr;
      top.style.width = `${w}px`;
      top.style.height = `${RULER_SIZE}px`;
      const ctx = top.getContext('2d');
      if (ctx) drawRuler(ctx, 'horizontal', w);
    }
    if (left?.parentElement) {
      const h = left.parentElement.clientHeight;
      const dpr = window.devicePixelRatio ?? 1;
      left.width = RULER_SIZE * dpr;
      left.height = h * dpr;
      left.style.width = `${RULER_SIZE}px`;
      left.style.height = `${h}px`;
      const ctx = left.getContext('2d');
      if (ctx) drawRuler(ctx, 'vertical', h);
    }
  }, [drawRuler]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const topCanvasRef = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      topRulerRef.current = canvas;
      if (canvas) redraw();
    },
    [redraw],
  );

  const leftCanvasRef = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      leftRulerRef.current = canvas;
      if (canvas) redraw();
    },
    [redraw],
  );

  const handleMouseDown = (axis: 'h' | 'v') => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pos = axis === 'h' ? e.clientX - rect.left : e.clientY - rect.top;
    const guideAxis = axis === 'h' ? 'vertical' : 'horizontal';
    const worldPoint =
      axis === 'h'
        ? topRulerScreenToWorld(pos, camState, viewport)
        : leftRulerScreenToWorld(pos, camState, viewport);
    const world = guideAxis === 'vertical' ? worldPoint[0] : worldPoint[1];
    const createdId = onAddGuide(guideAxis, Math.round(world));
    activeGuideDrag.current = { guideId: typeof createdId === 'string' ? createdId : null };

    const handleMove = (ev: MouseEvent) => {
      const p = axis === 'h' ? ev.clientX - rect.left : ev.clientY - rect.top;
      const moved =
        axis === 'h'
          ? topRulerScreenToWorld(p, camState, viewport)
          : leftRulerScreenToWorld(p, camState, viewport);
      const w = guideAxis === 'vertical' ? moved[0] : moved[1];
      const active = activeGuideDrag.current;
      if (active?.guideId) {
        onMoveGuide?.(active.guideId, Math.round(w));
      }
    };

    const handleUp = () => {
      activeGuideDrag.current = null;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  return (
    <div className="ruler-container" aria-hidden>
      <div className="ruler-corner" />
      <div className="ruler-top-wrapper">
        <canvas
          ref={topCanvasRef}
          className="ruler-canvas ruler-canvas--top"
          onMouseDown={handleMouseDown('h')}
        />
      </div>
      <div className="ruler-left-wrapper">
        <canvas
          ref={leftCanvasRef}
          className="ruler-canvas ruler-canvas--left"
          onMouseDown={handleMouseDown('v')}
        />
      </div>
    </div>
  );
}
