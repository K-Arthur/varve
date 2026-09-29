import { type CurveAlgorithm, type CurvePoint, compileCurve, type Histogram } from '@varve/engine';
import { Button, SegmentedControl, Select } from '@varve/ui';
import { useEffect, useRef, useState } from 'react';
import { NumberField } from './NumberField';
import './curveEditor.css';

const WIDTH = 300,
  HEIGHT = 240,
  PAD = 30,
  PLOT_W = 240,
  PLOT_H = 180;
type Channel = 'rgb' | 'red' | 'green' | 'blue';
const CHANNELS = [
  { value: 'rgb', label: 'RGB' },
  { value: 'red', label: 'R' },
  { value: 'green', label: 'G' },
  { value: 'blue', label: 'B' },
] as const;
const identity = (): CurvePoint[] => [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];
const clamp = (v: number) => Math.max(0, Math.min(1, v));

function pointerPoint(svg: SVGSVGElement, clientX: number, clientY: number): CurvePoint {
  const matrix = svg.getScreenCTM?.();
  if (matrix && typeof DOMPoint !== 'undefined') {
    const p = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: clamp((p.x - PAD) / PLOT_W), y: clamp(1 - (p.y - PAD) / PLOT_H) };
  }
  const rect = svg.getBoundingClientRect();
  const x = ((clientX - rect.left) * WIDTH) / (rect.width || WIDTH);
  const y = ((clientY - rect.top) * HEIGHT) / (rect.height || HEIGHT);
  return { x: clamp((x - PAD) / PLOT_W), y: clamp(1 - (y - PAD) / PLOT_H) };
}

export interface CurveEditorProps {
  value: CurvePoint[];
  onChange: (points: CurvePoint[]) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  channel?: Channel;
  onChannelChange?: (channel: Channel) => void;
  histogram?: Histogram;
  algorithm?: CurveAlgorithm;
}

export function CurveEditor({
  value,
  onChange,
  onDragStart,
  onDragEnd,
  channel: controlled,
  onChannelChange,
  histogram,
  algorithm = 'legacy',
}: CurveEditorProps) {
  const [internalChannel, setInternalChannel] = useState<Channel>('rgb');
  const channel = controlled ?? internalChannel;
  const [selected, setSelected] = useState(0);
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<{ index: number; original: CurvePoint[]; pointer?: number } | null>(null);
  const callbacks = useRef({ onChange, onDragStart, onDragEnd });
  callbacks.current = { onChange, onDragStart, onDragEnd };
  const points = value.length ? value : identity();
  const selectedPoint = points[Math.min(selected, points.length - 1)]!;
  const evaluate = compileCurve(points, algorithm);
  const path = Array.from(
    { length: 257 },
    (_, i) =>
      `${i ? 'L' : 'M'} ${PAD + (i / 256) * PLOT_W} ${PAD + (1 - evaluate(i / 256)) * PLOT_H}`,
  ).join(' ');

  function finish(cancel = false) {
    const active = gesture.current;
    if (!active) return;
    gesture.current = null;
    setDragging(false);
    if (cancel) callbacks.current.onChange(active.original);
    callbacks.current.onDragEnd?.();
  }
  function begin(index: number, pointer?: number) {
    if (gesture.current) finish();
    gesture.current = { index, original: points.map((p) => ({ ...p })), pointer };
    callbacks.current.onDragStart?.();
    setSelected(index);
    setDragging(pointer !== undefined);
  }
  function update(index: number, patch: Partial<CurvePoint>) {
    onChange(points.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }
  function add(point: CurvePoint) {
    if (points.length >= 256) return;
    onChange([...points, { ...point, id: crypto.randomUUID() }]);
    setSelected(points.length);
  }
  function remove(index: number) {
    if (points.length <= 2) return;
    onChange(points.filter((_, i) => i !== index));
    setSelected(Math.max(0, index - 1));
  }
  function hit(point: CurvePoint) {
    const rect = svgRef.current?.getBoundingClientRect();
    const scale = (rect?.width || WIDTH) / WIDTH;
    let closest = -1,
      distance = 10;
    points.forEach((p, i) => {
      const d = Math.hypot((p.x - point.x) * PLOT_W * scale, (p.y - point.y) * PLOT_H * scale);
      if (d < distance) {
        distance = d;
        closest = i;
      }
    });
    return closest;
  }
  useEffect(() => {
    const end = (event: KeyboardEvent) => {
      if (event.key.startsWith('Arrow')) {
        const active = gesture.current;
        if (active && active.pointer === undefined) {
          gesture.current = null;
          callbacks.current.onDragEnd?.();
        }
      }
    };
    window.addEventListener('keyup', end);
    return () => {
      window.removeEventListener('keyup', end);
      if (gesture.current) {
        gesture.current = null;
        callbacks.current.onDragEnd?.();
      }
    };
  }, []);
  useEffect(() => {
    setSelected(0);
  }, [channel]);
  useEffect(() => {
    const canvas = svgRef.current?.previousElementSibling;
    if (!(canvas instanceof HTMLCanvasElement)) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (!histogram) return;
    const bins = histogram[channel === 'rgb' ? 'luminance' : channel];
    const max = Math.max(...bins);
    if (max <= 0) return;
    ctx.fillStyle = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-accent-primary')
      .trim();
    ctx.globalAlpha = 0.18;
    for (let i = 0; i < 256; i++) {
      const height = (bins[i]! / max) * PLOT_H;
      ctx.fillRect(PAD + (i / 256) * PLOT_W, PAD + PLOT_H - height, PLOT_W / 256, height);
    }
    ctx.globalAlpha = 1;
  }, [histogram, channel]);

  return (
    <fieldset
      className="curve-editor"
      aria-label="Curve controls"
      onKeyDown={(e) => {
        e.stopPropagation();
      }}
    >
      <SegmentedControl
        label="Channel"
        value={channel}
        options={CHANNELS}
        onChange={(next) => {
          finish();
          if (onChannelChange) onChannelChange(next);
          else setInternalChannel(next);
        }}
        className="insp-curve-channel"
      />
      <div className="curve-editor__plot">
        <canvas width={WIDTH} height={HEIGHT} />
        <svg
          ref={svgRef}
          width={WIDTH}
          height={HEIGHT}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label="Curve editor. Input horizontal, output vertical. Arrow keys move point, Tab cycles points, Delete removes."
          onPointerDown={(e) => {
            if (e.button > 0) return;
            const svg = e.currentTarget;
            const point = pointerPoint(svg, e.clientX, e.clientY);
            const index = hit(point);
            (
              svg.querySelector(`[data-point-index="${Math.max(0, index)}"]`) as SVGElement | null
            )?.focus();
            if (index >= 0) {
              begin(index, e.pointerId);
              svg.setPointerCapture?.(e.pointerId);
            } else {
              onDragStart?.();
              add(point);
              onDragEnd?.();
            }
          }}
          onPointerMove={(e) => {
            const active = gesture.current;
            if (!active || active.pointer !== e.pointerId) return;
            update(active.index, pointerPoint(e.currentTarget, e.clientX, e.clientY));
          }}
          onPointerUp={() => finish()}
          onPointerCancel={() => finish(true)}
          onLostPointerCapture={() => finish()}
          onBlur={() => finish()}
          onDoubleClick={(e) => {
            const index = hit(pointerPoint(e.currentTarget, e.clientX, e.clientY));
            if (index >= 0) remove(index);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              finish(true);
              return;
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
              e.preventDefault();
              finish();
              remove(selected);
              return;
            }
            const moves: Record<string, [number, number]> = {
              ArrowLeft: [-1, 0],
              ArrowRight: [1, 0],
              ArrowDown: [0, -1],
              ArrowUp: [0, 1],
            };
            const delta = moves[e.key];
            if (!delta) return;
            e.preventDefault();
            if (!e.repeat) begin(selected);
            const step = (e.shiftKey ? 10 : 1) / 255;
            update(selected, {
              x: clamp(selectedPoint.x + delta[0] * step),
              y: clamp(selectedPoint.y + delta[1] * step),
            });
          }}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
            <g key={fraction}>
              <line
                x1={PAD + fraction * PLOT_W}
                x2={PAD + fraction * PLOT_W}
                y1={PAD}
                y2={PAD + PLOT_H}
                stroke="var(--color-border-subtle)"
              />
              <line
                x1={PAD}
                x2={PAD + PLOT_W}
                y1={PAD + fraction * PLOT_H}
                y2={PAD + fraction * PLOT_H}
                stroke="var(--color-border-subtle)"
              />
              <text
                x={PAD + fraction * PLOT_W}
                y={HEIGHT - 8}
                textAnchor="middle"
                fill="var(--color-text-muted)"
                fontSize="9"
              >
                {fraction * 100}%
              </text>
              <text
                x={PAD - 4}
                y={PAD + (1 - fraction) * PLOT_H}
                textAnchor="end"
                dominantBaseline="central"
                fill="var(--color-text-muted)"
                fontSize="9"
              >
                {fraction * 100}%
              </text>
            </g>
          ))}
          <path
            data-curve-transfer
            d={path}
            fill="none"
            stroke="var(--color-accent-primary)"
            strokeWidth="2"
          />
          {points.map((p, i) => (
            // biome-ignore lint/a11y/useSemanticElements: an SVG point cannot contain an HTML button; the numeric controls provide equivalent editing.
            <g
              role="button"
              tabIndex={0}
              data-point-index={i}
              aria-label={`Curve point ${i + 1}`}
              onFocus={() => setSelected(i)}
              key={p.id ?? `point-${i}`}
            >
              <circle
                cx={PAD + p.x * PLOT_W}
                cy={PAD + (1 - p.y) * PLOT_H}
                r={i === selected ? 6 : 4}
                fill={
                  i === selected ? 'var(--color-accent-primary)' : 'var(--color-surface-overlay)'
                }
                stroke="var(--color-accent-primary)"
                strokeWidth="2"
              />
            </g>
          ))}
        </svg>
      </div>
      <Select
        label="Selected curve point"
        value={String(Math.min(selected, points.length - 1))}
        options={points.map((p, i) => ({
          value: String(i),
          label: `Point ${i + 1}: ${Math.round(p.x * 255)} to ${Math.round(p.y * 255)}`,
        }))}
        onChange={(next) => setSelected(Number(next))}
      />
      <div className="curve-editor__fields">
        <NumberField
          label="Curve input"
          displayLabel="Input"
          value={selectedPoint.x * 255}
          min={0}
          max={255}
          step={0.1}
          onChange={(v) => update(selected, { x: v / 255 })}
        />
        <NumberField
          label="Curve output"
          displayLabel="Output"
          value={selectedPoint.y * 255}
          min={0}
          max={255}
          step={0.1}
          onChange={(v) => update(selected, { y: v / 255 })}
        />
      </div>
      <div className="curve-editor__actions">
        <Button
          size="sm"
          variant="ghost"
          disabled={points.length >= 256}
          onClick={() => add({ x: 0.5, y: evaluate(0.5) })}
        >
          Add point
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={points.length <= 2}
          onClick={() => remove(selected)}
        >
          Delete point
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Reset curve"
          onClick={() => {
            finish();
            onChange(identity());
            setSelected(0);
          }}
        >
          Reset curve
        </Button>
      </div>
      <span className="curve-editor__hint">
        {dragging
          ? 'Editing point'
          : `${algorithm === 'pchip' ? 'Shape preserving' : 'Legacy'} · input/output 0–255 · RGB applies to components`}
      </span>
    </fieldset>
  );
}
