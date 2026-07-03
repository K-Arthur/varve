/**
 * HistogramWidget — luminance histogram display with level sliders.
 *
 * Canvas-based bar chart (256 bars for 256 bins). Three draggable triangles
 * below the histogram represent black point, gamma, and white point for
 * Levels adjustment. Auto button computes optimal levels from the histogram.
 *
 * Research basis: Photoshop Levels panel histogram display.
 */
import type { Histogram, LevelParams } from '@strata/engine';
import { autoLevelsParams } from '@strata/engine';
import { Icon } from '@strata/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

const WIDTH = 300;
const HEIGHT = 130;
const BAR_AREA_H = 100;
const TRI_Y = BAR_AREA_H + 4;
const TRI_SIZE = 8;

export interface HistogramWidgetProps {
  histogram?: Histogram;
  levels: LevelParams;
  onChange: (levels: LevelParams) => void;
}

function drawHistogram(ctx: CanvasRenderingContext2D, histogram: Histogram) {
  ctx.clearRect(0, 0, WIDTH, BAR_AREA_H);

  const data = histogram.luminance;
  const total = histogram.totalPixels;
  if (total === 0) return;

  let maxCount = 0;
  for (let i = 0; i < 256; i++) {
    if (data[i]! > maxCount) maxCount = data[i]!;
  }
  if (maxCount === 0) return;

  const barW = WIDTH / 256;
  ctx.fillStyle = 'var(--color-text-muted, #888)';

  for (let i = 0; i < 256; i++) {
    const h = (data[i]! / maxCount) * BAR_AREA_H;
    ctx.fillRect(i * barW, BAR_AREA_H - h, Math.max(1, barW), h);
  }
}

function drawTriangle(ctx: CanvasRenderingContext2D, x: number, color: string, label: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, TRI_Y);
  ctx.lineTo(x - TRI_SIZE, TRI_Y + TRI_SIZE);
  ctx.lineTo(x + TRI_SIZE, TRI_Y + TRI_SIZE);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'var(--color-text-muted)';
  ctx.font = '8px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, x, TRI_Y + TRI_SIZE + 10);
}

export function HistogramWidget({ histogram, levels, onChange }: HistogramWidgetProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragType, setDragType] = useState<'black' | 'gamma' | 'white' | null>(null);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    if (histogram) {
      drawHistogram(ctx, histogram);
    }

    const blackX = (levels.inputBlack / 255) * WIDTH;
    const whiteX = (levels.inputWhite / 255) * WIDTH;
    const gammaX = Math.pow(levels.gamma, 0.5) * (whiteX - blackX) + blackX;

    drawTriangle(ctx, blackX, 'var(--color-accent-primary, #39d0c6)', 'B');
    drawTriangle(ctx, gammaX, 'var(--color-interactive-default, #555)', 'G');
    drawTriangle(ctx, whiteX, 'var(--color-accent-primary, #39d0c6)', 'W');
  }, [histogram, levels]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const getLevelFromX = useCallback((clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const clamped = Math.max(0, Math.min(WIDTH, x));
    const value = Math.round((clamped / WIDTH) * 255);
    return { x: clamped, value };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;

      const hitRadius = 14;
      const blackX = (levels.inputBlack / 255) * WIDTH;
      const whiteX = (levels.inputWhite / 255) * WIDTH;
      const gammaX = Math.pow(levels.gamma, 0.5) * (whiteX - blackX) + blackX;

      const hits: [number, 'black' | 'gamma' | 'white'][] = [
        [blackX, 'black'],
        [gammaX, 'gamma'],
        [whiteX, 'white'],
      ];

      let closest: 'black' | 'gamma' | 'white' | null = null;
      let closestDist = Infinity;
      for (const [x, type] of hits) {
        const dist = Math.abs(sx - x);
        if (dist < hitRadius && dist < closestDist) {
          closestDist = dist;
          closest = type;
        }
      }

      if (closest) {
        setDragType(closest);
        canvas.setPointerCapture(e.pointerId);
      }
    },
    [levels],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!dragType) return;
      const result = getLevelFromX(e.clientX);
      if (!result) return;

      switch (dragType) {
        case 'black':
          if (result.value < levels.inputWhite - 2) {
            onChange({ ...levels, inputBlack: result.value });
          }
          break;
        case 'white':
          if (result.value > levels.inputBlack + 2) {
            onChange({ ...levels, inputWhite: result.value });
          }
          break;
        case 'gamma': {
          const blackFrac = levels.inputBlack / 255;
          const whiteFrac = levels.inputWhite / 255;
          const range = whiteFrac - blackFrac;
          if (range > 0) {
            const gammaFrac = (result.x / WIDTH - blackFrac) / range;
            const gamma = Math.max(0.1, Math.min(10, gammaFrac * gammaFrac));
            onChange({ ...levels, gamma });
          }
          break;
        }
      }
    },
    [dragType, levels, onChange, getLevelFromX],
  );

  const handlePointerUp = useCallback(() => {
    setDragType(null);
  }, []);

  const handleAuto = useCallback(() => {
    if (!histogram) return;
    const auto = autoLevelsParams(histogram);
    onChange({
      ...levels,
      inputBlack: auto.inputBlack,
      inputWhite: auto.inputWhite,
      gamma: auto.gamma,
    });
  }, [histogram, levels, onChange]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label="Histogram with level sliders"
        style={{
          width: '100%',
          height: HEIGHT,
          background: 'var(--color-surface-sunken)',
          borderRadius: 'var(--radius-sm)',
          cursor: dragType ? 'ew-resize' : 'default',
          touchAction: 'none',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      <button
        type="button"
        className="insp-add-btn"
        onClick={handleAuto}
        style={{ fontSize: 'var(--font-size-2xs)' }}
      >
        <Icon name="Settings" label={undefined} size="0.85em" />
        <span>Auto</span>
      </button>
    </div>
  );
}
