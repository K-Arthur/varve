/**
 * CurveEditor — interactive tonal curve adjustment widget for the Inspector.
 *
 * SVG-based grid (4x4) with draggable anchor points. Click adds a point,
 * double-click removes it. A Catmull-Rom spline is drawn through all
 * points as an SVG path. Channel selector filters to RGB / Red / Green / Blue.
 *
 * Research basis: Photoshop Curves panel; SVG pointer-event compositing.
 */
import type { CurvePoint, Histogram } from '@varve/engine';
import { Icon } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

const WIDTH = 300;
const HEIGHT = 240;
const PADDING = 30;
const PLOT_W = WIDTH - PADDING * 2;
const PLOT_H = HEIGHT - PADDING * 2;
const HANDLE_R = 5;

type Channel = 'rgb' | 'red' | 'green' | 'blue';

const CHANNELS: { value: Channel; label: string }[] = [
  { value: 'rgb', label: 'RGB' },
  { value: 'red', label: 'R' },
  { value: 'green', label: 'G' },
  { value: 'blue', label: 'B' },
];

function identityPoints(): CurvePoint[] {
  return [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ];
}

function toSvgCoord(p: CurvePoint): { sx: number; sy: number } {
  return {
    sx: PADDING + p.x * PLOT_W,
    sy: PADDING + (1 - p.y) * PLOT_H,
  };
}

function toCurveCoord(sx: number, sy: number): CurvePoint {
  return {
    x: Math.max(0, Math.min(1, (sx - PADDING) / PLOT_W)),
    y: Math.max(0, Math.min(1, 1 - (sy - PADDING) / PLOT_H)),
  };
}

function catmullRom1d(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function buildSplinePath(points: CurvePoint[]): string {
  if (points.length === 0) return '';
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const pts = sorted.length === 1 ? [...sorted, { x: 1, y: 1 }] : sorted;
  const extended = pts.length === 2 ? pts : pts;

  let d = '';
  const first = toSvgCoord(extended[0]!);
  d = `M ${first.sx} ${first.sy}`;

  if (extended.length === 2) {
    const last = toSvgCoord(extended[1]!);
    d += ` L ${last.sx} ${last.sy}`;
  } else {
    for (let i = 0; i < extended.length - 1; i++) {
      const p0 = extended[Math.max(0, i - 1)]!;
      const p1 = extended[i]!;
      const p2 = extended[Math.min(extended.length - 1, i + 1)]!;
      const p3 = extended[Math.min(extended.length - 1, i + 2)]!;
      const steps = 20;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const x = catmullRom1d(p0.x, p1.x, p2.x, p3.x, t);
        const y = catmullRom1d(p0.y, p1.y, p2.y, p3.y, t);
        const c = toSvgCoord({ x, y });
        d += ` L ${c.sx} ${c.sy}`;
      }
    }
  }
  return d;
}

function gridLines(): { x1: number; y1: number; x2: number; y2: number }[] {
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let i = 0; i <= 4; i++) {
    const frac = i / 4;
    const x = PADDING + frac * PLOT_W;
    const y = PADDING + frac * PLOT_H;
    lines.push({ x1: x, y1: PADDING, x2: x, y2: PADDING + PLOT_H });
    lines.push({ x1: PADDING, y1: y, x2: PADDING + PLOT_W, y2: y });
  }
  return lines;
}

function gridLabels(): { x: number; y: number; label: string; isX: boolean }[] {
  const labels: { x: number; y: number; label: string; isX: boolean }[] = [];
  for (let i = 0; i <= 4; i++) {
    const frac = i / 4;
    const pct = `${frac * 100}%`;
    labels.push({
      x: PADDING + frac * PLOT_W,
      y: HEIGHT - 2,
      label: pct,
      isX: true,
    });
    labels.push({
      x: 2,
      y: PADDING + (1 - frac) * PLOT_H + 4,
      label: pct,
      isX: false,
    });
  }
  return labels;
}

export interface CurveEditorProps {
  value: CurvePoint[];
  onChange: (points: CurvePoint[]) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  /**
   * Controlled channel selection. Omit to fall back to uncontrolled local
   * state (the channel buttons still render and toggle visually, but don't
   * drive anything outside the component — fine for a single-channel curve).
   * Pass both props when the consumer stores per-channel curves, so the
   * buttons actually select what's being edited instead of only looking like
   * they do.
   */
  channel?: Channel;
  onChannelChange?: (channel: Channel) => void;
  /** Optional source histogram painted behind the SVG curve grid. */
  histogram?: Histogram;
}

export function CurveEditor({
  value,
  onChange,
  onDragStart,
  onDragEnd,
  channel: channelProp,
  onChannelChange,
  histogram,
}: CurveEditorProps) {
  const [internalChannel, setInternalChannel] = useState<Channel>('rgb');
  const channel = channelProp ?? internalChannel;
  const setChannel = useCallback(
    (next: Channel) => {
      if (onChannelChange) onChannelChange(next);
      else setInternalChannel(next);
    },
    [onChannelChange],
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const onDragStartRef = useRef(onDragStart);
  onDragStartRef.current = onDragStart;
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;

  const points = value.length === 0 ? identityPoints() : value;
  const sorted = [...points].sort((a, b) => a.x - b.x);

  const reset = useCallback(() => {
    onChange(identityPoints());
  }, [onChange]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      const hitRadius = 12;
      const hitIdx = sorted.findIndex((p) => {
        const c = toSvgCoord(p);
        return Math.abs(c.sx - sx) <= hitRadius && Math.abs(c.sy - sy) <= hitRadius;
      });

      if (hitIdx >= 0) {
        onDragStartRef.current?.();
        setDragIndex(hitIdx);
        setSelectedIndex(hitIdx);
        svgRef.current.focus();
        return;
      }

      onDragStartRef.current?.();
      const newPoint = toCurveCoord(sx, sy);
      onChange([...points, newPoint]);
      onDragEndRef.current?.();
      // Select the newly added point (it's now the last in the unsorted array)
      setSelectedIndex(sorted.length);
    },
    [points, sorted, onChange],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const hitRadius = 12;
      const hitIdx = sorted.findIndex((p) => {
        const c = toSvgCoord(p);
        return Math.abs(c.sx - sx) <= hitRadius && Math.abs(c.sy - sy) <= hitRadius;
      });
      if (hitIdx < 0) return;
      const removedId = sorted[hitIdx];
      if (!removedId) return;
      const remaining = points.filter((p) => p !== removedId);
      if (remaining.length >= 2) {
        onChange(remaining);
      }
    },
    [points, sorted, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<SVGSVGElement>) => {
      if (selectedIndex === null) return;
      const step = e.shiftKey ? 0.05 : 0.02;
      const current = sorted[selectedIndex];
      if (!current) return;

      let newX = current.x;
      let newY = current.y;

      switch (e.key) {
        case 'ArrowUp':
          newY = Math.min(1, newY + step);
          e.preventDefault();
          break;
        case 'ArrowDown':
          newY = Math.max(0, newY - step);
          e.preventDefault();
          break;
        case 'ArrowLeft':
          newX = Math.max(0, newX - step);
          e.preventDefault();
          break;
        case 'ArrowRight':
          newX = Math.min(1, newX + step);
          e.preventDefault();
          break;
        case 'Tab': {
          e.preventDefault();
          const dir = e.shiftKey ? -1 : 1;
          const next = (selectedIndex + dir + sorted.length) % sorted.length;
          setSelectedIndex(next);
          return;
        }
        case 'Delete':
        case 'Backspace': {
          if (sorted.length <= 2) return; // Keep at least 2 points
          e.preventDefault();
          const remaining = points.filter((p) => p !== current);
          if (remaining.length >= 2) {
            onChange(remaining);
            setSelectedIndex(null);
          }
          return;
        }
        case 'Home':
          setSelectedIndex(0);
          e.preventDefault();
          return;
        case 'End':
          setSelectedIndex(sorted.length - 1);
          e.preventDefault();
          return;
        default:
          return;
      }

      if (!e.repeat) {
        onDragStartRef.current?.();
        const onKeyUp = (ke: KeyboardEvent) => {
          if (ke.key.startsWith('Arrow')) {
            onDragEndRef.current?.();
            window.removeEventListener('keyup', onKeyUp);
          }
        };
        window.addEventListener('keyup', onKeyUp);
      }
      const updated = [...points];
      const orig = updated.find((p) => p.x === current.x && p.y === current.y);
      if (orig) {
        const idx = updated.indexOf(orig);
        updated[idx] = { x: newX, y: newY };
        onChange(updated);
      }
    },
    [selectedIndex, sorted, points, onChange],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (dragIndex === null || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const newPoint = toCurveCoord(sx, sy);
      const updated = [...points];
      const target = updated.find((p) => p === sorted[dragIndex]);
      if (!target) return;
      const idx = updated.indexOf(target);
      if (idx >= 0) {
        updated[idx] = newPoint;
        onChange(updated);
      }
    },
    [dragIndex, points, sorted, onChange],
  );

  const handlePointerUp = useCallback(() => {
    setDragIndex(null);
    onDragEndRef.current?.();
  }, []);

  const path = buildSplinePath(points);
  const grid = gridLines();
  const labels = gridLabels();

  useEffect(() => {
    const canvas = svgRef.current?.previousElementSibling;
    if (!(canvas instanceof HTMLCanvasElement)) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (!histogram) return;
    const data = histogram[channel === 'rgb' ? 'luminance' : channel];
    let max = 0;
    for (let i = 0; i < 256; i += 1) max = Math.max(max, data[i]!);
    if (max <= 0) return;
    const computed = getComputedStyle(document.documentElement);
    ctx.fillStyle = computed.getPropertyValue('--color-accent-primary').trim() || '#39d0c6';
    ctx.globalAlpha = 0.18;
    const barW = PLOT_W / 256;
    for (let i = 0; i < 256; i += 1) {
      const height = (data[i]! / max) * PLOT_H;
      ctx.fillRect(PADDING + i * barW, PADDING + PLOT_H - height, Math.max(1, barW), height);
    }
    ctx.globalAlpha = 1;
  }, [channel, histogram]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-1)',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div className="insp-segmented" role="radiogroup" aria-label="Channel">
          {CHANNELS.map((ch) => (
            <label
              key={ch.value}
              className={`insp-segmented__btn${channel === ch.value ? ' insp-segmented__btn--active' : ''}`}
              style={{ fontSize: 'var(--font-size-2xs)', padding: '0 var(--space-1)' }}
            >
              <input
                type="radio"
                name="curve-channel"
                checked={channel === ch.value}
                onChange={() => setChannel(ch.value)}
              />
              {ch.label}
            </label>
          ))}
        </div>
        <button
          type="button"
          className="insp-inline-btn"
          aria-label="Reset curve"
          onClick={reset}
          style={{ fontSize: 'var(--font-size-2xs)' }}
        >
          <Icon name="RotateCcw" label={undefined} size="0.85em" />
        </button>
      </div>
      <div
        style={{
          position: 'relative',
          width: WIDTH,
          height: HEIGHT,
          background: 'var(--color-surface-sunken)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <canvas
          width={WIDTH}
          height={HEIGHT}
          style={{
            position: 'absolute',
            inset: 0,
            width: WIDTH,
            height: HEIGHT,
            borderRadius: 'var(--radius-sm)',
            pointerEvents: 'none',
          }}
        />
        <svg
          ref={svgRef}
          role="img"
          width={WIDTH}
          height={HEIGHT}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          style={{
            background: 'transparent',
            borderRadius: 'var(--radius-sm)',
            cursor: dragIndex !== null ? 'grabbing' : 'crosshair',
            touchAction: 'none',
            userSelect: 'none',
          }}
          aria-label="Curve editor. Use arrow keys to move selected point, Tab to cycle, Delete to remove."
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onDoubleClick={handleDoubleClick}
          onKeyDown={handleKeyDown}
        >
          <rect
            x={PADDING}
            y={PADDING}
            width={PLOT_W}
            height={PLOT_H}
            fill="none"
            stroke="var(--color-border-subtle)"
            strokeWidth="1"
          />
          {grid.map((l) => (
            <line
              key={`${l.x1}-${l.y1}-${l.x2}-${l.y2}`}
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              stroke="var(--color-border-subtle)"
              strokeWidth="0.5"
              opacity="0.5"
            />
          ))}
          {labels.map((l) => (
            <text
              key={`${l.isX}-${l.x}-${l.y}`}
              x={l.isX ? l.x : l.x}
              y={l.isX ? l.y : l.y}
              fill="var(--color-text-muted)"
              fontSize="8"
              textAnchor={l.isX ? 'middle' : 'end'}
              dominantBaseline={l.isX ? 'text-after-edge' : 'central'}
            >
              {l.label}
            </text>
          ))}
          <path
            d={path}
            fill="none"
            stroke="var(--color-accent-primary)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {sorted.map((p, i) => {
            const c = toSvgCoord(p);
            return (
              <circle
                // biome-ignore lint/suspicious/noArrayIndexKey: control points move during drag; index is the stable identity (content keys would remount mid-interaction)
                key={i}
                cx={c.sx}
                cy={c.sy}
                r={HANDLE_R}
                fill={
                  dragIndex === i ? 'var(--color-accent-primary)' : 'var(--color-surface-overlay)'
                }
                stroke="var(--color-accent-primary)"
                strokeWidth="2"
                style={{ cursor: 'grab' }}
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}
