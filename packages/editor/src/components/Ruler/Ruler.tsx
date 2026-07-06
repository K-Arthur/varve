import { formatCoordForRuler, type RulerMode } from '@strata/shared';
import { useCallback, useRef } from 'react';
import './Ruler.css';

interface RulerProps {
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation?: number;
  unitType: 'px' | 'pt' | 'cm' | 'mm' | 'in' | '%';
  rulerMode?: RulerMode;
  artboard?: { x: number; y: number; w: number; h: number } | null;
  pageRulerOrigin?: { x: number; y: number };
  onAddGuide: (axis: 'horizontal' | 'vertical', position: number) => void;
  canvasWidth?: number;
  canvasHeight?: number;
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
}: RulerProps) {
  const topRulerRef = useRef<HTMLCanvasElement>(null);
  const leftRulerRef = useRef<HTMLCanvasElement>(null);
  const isDragging = useRef<'h' | 'v' | null>(null);

  const drawRuler = useCallback(
    (ctx: CanvasRenderingContext2D, axis: 'horizontal' | 'vertical', size: number) => {
      const dpr = window.devicePixelRatio ?? 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const computed = getComputedStyle(document.documentElement);
      const bgColor = computed.getPropertyValue('--color-surface-sunken').trim() || '#f0f0f0';
      const tickColor = computed.getPropertyValue('--color-text-muted').trim() || '#888';

      ctx.clearRect(0, 0, size, RULER_SIZE);
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, size, RULER_SIZE);

      const interval = getTickInterval(zoom);
      const scale = UNIT_SCALE[unitType] ?? 1;
      const offset = axis === 'horizontal' ? pan.x : pan.y;
      const originOffset =
        rulerMode === 'artboard' && artboard
          ? axis === 'horizontal'
            ? (pageRulerOrigin?.x ?? 0) + artboard.x
            : (pageRulerOrigin?.y ?? 0) + artboard.y
          : 0;

      const startWorld =
        Math.floor((-offset / zoom - originOffset) / interval) * interval + originOffset;
      const endWorld = startWorld + size / zoom + interval * 2;

      ctx.strokeStyle = tickColor;
      ctx.fillStyle = tickColor;
      ctx.font = '9px system-ui';

      for (let w = startWorld; w <= endWorld; w += interval) {
        const screenPos = w * zoom + offset;
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
            ctx.fillText(label, screenPos + 3, RULER_SIZE - 4);
          } else {
            ctx.save();
            ctx.translate(RULER_SIZE - 4, screenPos + 8);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(label, 0, 0);
            ctx.restore();
          }
        }
      }

      void cameraRotation;
    },
    [zoom, pan.x, pan.y, unitType, rulerMode, artboard, pageRulerOrigin, cameraRotation],
  );

  const topCanvasRef = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      topRulerRef.current = canvas;
      if (!canvas) return;
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = window.devicePixelRatio ?? 1;
      const w = parent.clientWidth;
      canvas.width = w * dpr;
      canvas.height = RULER_SIZE * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${RULER_SIZE}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) drawRuler(ctx, 'horizontal', w);
    },
    [drawRuler],
  );

  const leftCanvasRef = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      leftRulerRef.current = canvas;
      if (!canvas) return;
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = window.devicePixelRatio ?? 1;
      const h = parent.clientHeight;
      canvas.width = RULER_SIZE * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${RULER_SIZE}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) drawRuler(ctx, 'vertical', h);
    },
    [drawRuler],
  );

  const handleMouseDown = (axis: 'h' | 'v') => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = axis;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pos = axis === 'h' ? e.clientX - rect.left : e.clientY - rect.top;
    const world = axis === 'h' ? (pos - pan.x) / zoom : (pos - pan.y) / zoom;
    onAddGuide(axis === 'h' ? 'vertical' : 'horizontal', Math.round(world));

    const handleMove = (ev: MouseEvent) => {
      const p = axis === 'h' ? ev.clientX - rect.left : ev.clientY - rect.top;
      const w = axis === 'h' ? (p - pan.x) / zoom : (p - pan.y) / zoom;
      onAddGuide(axis === 'h' ? 'vertical' : 'horizontal', Math.round(w));
    };

    const handleUp = () => {
      isDragging.current = null;
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
