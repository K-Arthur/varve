/**
 * HistogramWidget — channel-selectable histogram display with level sliders.
 *
 * Canvas-based bar chart (256 bars for 256 bins). Three draggable triangles
 * below the histogram represent black point, gamma, and white point for
 * Levels adjustment. Auto button computes optimal levels from the histogram.
 *
 * Research basis: Photoshop Levels panel histogram display.
 */
import type { Histogram, LevelParams } from '@varve/engine';
import { autoLevelsParams, computeHistogramStats } from '@varve/engine';
import { Icon } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const WIDTH = 300;
const HEIGHT = 130;
const BAR_AREA_H = 100;
const TRI_Y = BAR_AREA_H + 4;
const TRI_SIZE = 8;

export type HistogramChannel = 'luminance' | 'red' | 'green' | 'blue';

export interface HistogramWidgetProps {
  histogram?: Histogram;
  levels: LevelParams;
  onChange: (levels: LevelParams) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  channel?: HistogramChannel;
  onChannelChange?: (channel: HistogramChannel) => void;
}

function drawHistogram(
  ctx: CanvasRenderingContext2D,
  histogram: Histogram,
  barColor: string,
  channel: HistogramChannel,
) {
  ctx.clearRect(0, 0, WIDTH, BAR_AREA_H);

  const data = histogram[channel];
  const total = histogram.totalPixels;
  if (total === 0) return;

  let maxCount = 0;
  for (let i = 0; i < 256; i++) {
    if (data[i]! > maxCount) maxCount = data[i]!;
  }
  if (maxCount === 0) return;

  const barW = WIDTH / 256;
  ctx.fillStyle = barColor;

  for (let i = 0; i < 256; i++) {
    const h = (data[i]! / maxCount) * BAR_AREA_H;
    ctx.fillRect(i * barW, BAR_AREA_H - h, Math.max(1, barW), h);
  }
}

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  x: number,
  color: string,
  label: string,
  labelColor: string,
) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, TRI_Y);
  ctx.lineTo(x - TRI_SIZE, TRI_Y + TRI_SIZE);
  ctx.lineTo(x + TRI_SIZE, TRI_Y + TRI_SIZE);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = labelColor;
  ctx.font = '8px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, x, TRI_Y + TRI_SIZE + 10);
}

export function HistogramWidget({
  histogram,
  levels,
  onChange,
  onDragStart,
  onDragEnd,
  channel = 'luminance',
  onChannelChange,
}: HistogramWidgetProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragType, setDragType] = useState<'black' | 'gamma' | 'white' | null>(null);
  const [focusType, setFocusType] = useState<'black' | 'gamma' | 'white' | null>(null);
  const onDragStartRef = useRef(onDragStart);
  onDragStartRef.current = onDragStart;
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;

  // Compute accessible histogram stats (visible to screen readers only).
  const statsSummary = useMemo(() => {
    if (!histogram || histogram.totalPixels === 0) return '';
    const stats = computeHistogramStats(histogram[channel], histogram.opaquePixels);
    const channelLabel = channel === 'luminance' ? 'Luminance' : channel.toUpperCase();
    return (
      `${channelLabel} histogram: mean ${stats.mean.toFixed(0)}, median ${stats.median}, ` +
      `standard deviation ${stats.stdDev.toFixed(0)}, ` +
      `5th percentile ${stats.percentile5}, 95th percentile ${stats.percentile95}. ` +
      `${stats.blackClipped} pixels at black, ${stats.whiteClipped} pixels at white.`
    );
  }, [channel, histogram]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Canvas2D cannot resolve CSS variables — resolve via getComputedStyle.
    const computed = getComputedStyle(document.documentElement);
    const mutedColor = computed.getPropertyValue('--color-text-muted').trim() || '#888';
    const accentColor = computed.getPropertyValue('--color-accent-primary').trim() || '#39d0c6';
    const interactiveColor =
      computed.getPropertyValue('--color-interactive-default').trim() || '#555';

    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    if (histogram) {
      drawHistogram(ctx, histogram, mutedColor, channel);
    }

    const blackX = (levels.inputBlack / 255) * WIDTH;
    const whiteX = (levels.inputWhite / 255) * WIDTH;
    const gammaX = levels.gamma ** 0.5 * (whiteX - blackX) + blackX;

    drawTriangle(ctx, blackX, accentColor, 'B', mutedColor);
    drawTriangle(ctx, gammaX, interactiveColor, 'G', mutedColor);
    drawTriangle(ctx, whiteX, accentColor, 'W', mutedColor);
  }, [channel, histogram, levels]);

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
      const gammaX = levels.gamma ** 0.5 * (whiteX - blackX) + blackX;

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
        onDragStartRef.current?.();
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
    onDragEndRef.current?.();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      const current = focusType ?? 'black';
      const step = 5;

      switch (e.key) {
        case 'ArrowLeft': {
          e.preventDefault();
          const delta = current === 'gamma' ? -0.1 : -step;
          if (current === 'black') {
            const next = Math.max(0, levels.inputBlack + delta);
            if (next < levels.inputWhite - 2) onChange({ ...levels, inputBlack: next });
          } else if (current === 'white') {
            const next = Math.min(255, levels.inputWhite + delta);
            if (next > levels.inputBlack + 2) onChange({ ...levels, inputWhite: next });
          } else if (current === 'gamma') {
            const next = Math.max(0.1, levels.gamma + delta);
            onChange({ ...levels, gamma: next });
          }
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          const delta = current === 'gamma' ? 0.1 : step;
          if (current === 'black') {
            const next = Math.min(255, levels.inputBlack + delta);
            if (next < levels.inputWhite - 2) onChange({ ...levels, inputBlack: next });
          } else if (current === 'white') {
            const next = Math.min(255, levels.inputWhite + delta);
            if (next > levels.inputBlack + 2) onChange({ ...levels, inputWhite: next });
          } else if (current === 'gamma') {
            const next = Math.min(10, levels.gamma + delta);
            onChange({ ...levels, gamma: next });
          }
          break;
        }
        case 'Tab': {
          e.preventDefault();
          const sliders: Array<'black' | 'gamma' | 'white'> = ['black', 'gamma', 'white'];
          const idx = sliders.indexOf(current);
          const dir = e.shiftKey ? -1 : 1;
          const next = (idx + dir + sliders.length) % sliders.length;
          setFocusType(sliders[next]!);
          break;
        }
        case 'Home': {
          e.preventDefault();
          setFocusType('black');
          break;
        }
        case 'End': {
          e.preventDefault();
          setFocusType('white');
          break;
        }
      }
    },
    [focusType, levels, onChange],
  );

  const handleAuto = useCallback(() => {
    if (!histogram) return;
    onDragStartRef.current?.();
    const auto = autoLevelsParams(histogram);
    onChange({
      ...levels,
      inputBlack: auto.inputBlack,
      inputWhite: auto.inputWhite,
      gamma: auto.gamma,
    });
    onDragEndRef.current?.();
  }, [histogram, levels, onChange]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      {/* Visually hidden ARIA summary for screen readers. */}
      {statsSummary && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            overflow: 'hidden',
            clip: 'rect(0,0,0,0)',
            whiteSpace: 'nowrap',
            border: 0,
          }}
        >
          {statsSummary}
        </div>
      )}
      <div className="histogram-widget__channels" role="radiogroup" aria-label="Histogram channel">
        {(
          [
            ['luminance', 'Luma'],
            ['red', 'R'],
            ['green', 'G'],
            ['blue', 'B'],
          ] as const
        ).map(([value, label]) => (
          <label
            key={value}
            className={channel === value ? 'histogram-widget__channel--active' : undefined}
          >
            <input
              type="radio"
              name="histogram-channel"
              value={value}
              checked={channel === value}
              onChange={() => onChannelChange?.(value)}
            />
            {label}
          </label>
        ))}
      </div>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        tabIndex={0}
        aria-label="Histogram with level sliders. Use arrow keys to adjust, Tab to cycle between black/gamma/white sliders, Home/End to jump to ends."
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
        onKeyDown={handleKeyDown}
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
