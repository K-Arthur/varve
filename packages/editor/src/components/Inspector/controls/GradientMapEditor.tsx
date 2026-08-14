import type {
  Color,
  GradientMapLuminanceMode,
  GradientMapOpacityStop,
  GradientMapStop,
} from '@varve/engine';
import type { GradientInterpolationSpace, ManagedColor } from '@varve/scene';
import { rgbFromTuple } from '@varve/scene';
import { denormalizeChannel, managedColorToRgba, normalizeChannel } from '@varve/shared';
import { Select } from '@varve/ui';
import { ColorPicker } from '@varve/ui/components/ColorPicker';
import { useCallback, useId, useMemo, useRef, useState } from 'react';

function colorToManaged(c: Color): ManagedColor {
  return rgbFromTuple(c);
}

function managedToColor(c: ManagedColor): Color {
  // Engine adjustment colors are 0-255 tuples: normalize at the color's own
  // bit depth first, so a uint16/float color cannot corrupt the parameter
  // scale (a raw 32768 channel would be misread as byte 32768).
  if (c.space === 'rgb') {
    const bd = c.bitDepth ?? 'uint8';
    return [
      denormalizeChannel(normalizeChannel(c.r, bd), 'uint8'),
      denormalizeChannel(normalizeChannel(c.g, bd), 'uint8'),
      denormalizeChannel(normalizeChannel(c.b, bd), 'uint8'),
      denormalizeChannel(normalizeChannel(c.a, bd), 'uint8'),
    ] as Color;
  }
  const [r, g, b, a] = managedColorToRgba(c as Parameters<typeof managedColorToRgba>[0]);
  return [r, g, b, a] as Color;
}

function stopColorCss(c: Color): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(2)})`;
}

function gradientCss(stops: GradientMapStop[]): string {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const parts = sorted.map((s) => `${stopColorCss(s.color)} ${(s.position * 100).toFixed(1)}%`);
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

function interpolateColor(a: Color, b: Color, t: number): Color {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
    Math.round(a[3] + (b[3] - a[3]) * t),
  ] as Color;
}

function interpolatedColorAt(stops: GradientMapStop[], position: number): Color {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  if (sorted.length === 0) return [0, 0, 0, 255] as Color;
  if (position <= sorted[0]!.position) return sorted[0]!.color;
  if (position >= sorted[sorted.length - 1]!.position) return sorted[sorted.length - 1]!.color;
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i]!;
    const hi = sorted[i + 1]!;
    if (position >= lo.position && position <= hi.position) {
      const span = hi.position - lo.position;
      const t = span === 0 ? 0 : (position - lo.position) / span;
      return interpolateColor(lo.color, hi.color, t);
    }
  }
  return sorted[sorted.length - 1]!.color;
}

function interpolatedOpacityAt(stops: GradientMapOpacityStop[], position: number): number {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  if (sorted.length === 0) return 1;
  if (position <= sorted[0]!.position) return sorted[0]!.opacity;
  if (position >= sorted[sorted.length - 1]!.position) return sorted[sorted.length - 1]!.opacity;
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i]!;
    const hi = sorted[i + 1]!;
    if (position >= lo.position && position <= hi.position) {
      const span = hi.position - lo.position;
      const t = span === 0 ? 0 : (position - lo.position) / span;
      return lo.opacity + (hi.opacity - lo.opacity) * t;
    }
  }
  return sorted[sorted.length - 1]!.opacity;
}

export interface GradientMapChannelStops {
  r?: GradientMapStop[];
  g?: GradientMapStop[];
  b?: GradientMapStop[];
}

export interface GradientMapEditorProps {
  stops: GradientMapStop[];
  dither: boolean;
  preserveLuminosity: boolean;
  /** Mapping mode: 'luminance' (default) or 'channel'. */
  mode?: 'luminance' | 'channel';
  /** Per-channel gradient stops for channel mode. */
  channelStops?: GradientMapChannelStops;
  /** Independent opacity ramp (optional). */
  opacityStops?: GradientMapOpacityStop[];
  reverse?: boolean;
  /** Mix with the source: 0-1. Default 1. */
  intensity?: number;
  luminanceMode?: GradientMapLuminanceMode;
  preserveSourceAlpha?: boolean;
  interpolation?: GradientInterpolationSpace;
  onChange: (
    patch: Partial<{
      stops: GradientMapStop[];
      dither: boolean;
      preserveLuminosity: boolean;
      mode: 'luminance' | 'channel';
      channelStops: GradientMapChannelStops;
      opacityStops: GradientMapOpacityStop[];
      reverse: boolean;
      intensity: number;
      luminanceMode: GradientMapLuminanceMode;
      preserveSourceAlpha: boolean;
      interpolation: GradientInterpolationSpace;
    }>,
  ) => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
}

const LUMINANCE_OPTIONS: { value: GradientMapLuminanceMode; label: string }[] = [
  { value: 'relative-luminance', label: 'Relative luminance' },
  { value: 'perceptual-lightness', label: 'Perceptual lightness' },
  { value: 'average-rgb', label: 'Average RGB' },
  { value: 'max-channel', label: 'Maximum channel' },
];

const INTERPOLATION_OPTIONS: { value: GradientInterpolationSpace; label: string }[] = [
  { value: 'oklab', label: 'OKLab' },
  { value: 'oklch', label: 'OKLCH' },
  { value: 'srgb', label: 'sRGB' },
  { value: 'hsl', label: 'HSL' },
];

/**
 * Compact per-channel gradient bars for channel mapping mode.
 * Each channel (R, G, B) gets its own gradient bar with editable stops.
 */
function ChannelBars({
  rStops,
  gStops,
  bStops,
  onChange,
  onEditStart,
  onEditEnd,
}: {
  rStops: GradientMapStop[];
  gStops: GradientMapStop[];
  bStops: GradientMapStop[];
  onChange: (ch: GradientMapChannelStops) => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
}) {
  const channels: {
    key: 'r' | 'g' | 'b';
    label: string;
    stops: GradientMapStop[];
    accent: string;
  }[] = [
    { key: 'r', label: 'Red', stops: rStops, accent: '#dc2626' },
    { key: 'g', label: 'Green', stops: gStops, accent: '#16a34a' },
    { key: 'b', label: 'Blue', stops: bStops, accent: '#2563eb' },
  ];

  return (
    <div className="gm-editor__channels">
      {channels.map(({ key, label, stops: channelStops, accent }) => (
        <ChannelBar
          key={key}
          label={label}
          accent={accent}
          stops={channelStops}
          onChange={(next) => onChange({ [key]: next } as GradientMapChannelStops)}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
        />
      ))}
    </div>
  );
}

function ChannelBar({
  label,
  accent,
  stops,
  onChange,
  onEditStart,
  onEditEnd,
}: {
  label: string;
  accent: string;
  stops: GradientMapStop[];
  onChange: (stops: GradientMapStop[]) => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  const sorted = useMemo(() => [...stops].sort((a, b) => a.position - b.position), [stops]);

  const handleBarClick = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const bar = barRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const near = sorted.findIndex((s) => Math.abs(s.position - pos) < 0.04);
      if (near >= 0) {
        setSelected(near);
        return;
      }
      const color = interpolatedColorAt(sorted, pos);
      onChange([...sorted, { position: pos, color }]);
      setSelected(sorted.length);
    },
    [sorted, onChange],
  );

  const updateStop = useCallback(
    (index: number, partial: Partial<GradientMapStop>) => {
      const next = sorted.map((s, i) => (i === index ? { ...s, ...partial } : s));
      onChange(next);
    },
    [sorted, onChange],
  );

  const current = sorted[selected];

  return (
    <div className="gm-editor__channel">
      <div className="gm-editor__channel-header">
        <span className="gm-editor__channel-label" style={{ color: accent }}>
          {label}
        </span>
      </div>
      <div
        ref={barRef}
        className="gm-editor__channel-bar"
        style={{ background: gradientCss(sorted) }}
        onPointerDown={handleBarClick}
      >
        {sorted.map((stop, i) => (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: gradient stops have no stable id; position/color change while editing (content keys would remount mid-drag)
            key={`ch-${label}-${i}`}
            type="button"
            aria-label={`${label} stop ${i + 1} at ${Math.round(stop.position * 100)}%`}
            className={`gm-editor__stop${selected === i ? ' gm-editor__stop--selected' : ' gm-editor__stop--idle'}`}
            style={{ left: `${stop.position * 100}%`, background: stopColorCss(stop.color) }}
            onPointerDown={(e) => {
              e.stopPropagation();
              setSelected(i);
            }}
          />
        ))}
      </div>
      {current && (
        <div className="gm-editor__channel-controls">
          <ColorPicker
            value={colorToManaged(current.color)}
            onChange={(c) => updateStop(selected, { color: managedToColor(c) })}
            onInteractionStart={onEditStart}
            onInteractionEnd={onEditEnd}
          />
          <button
            type="button"
            className="gm-editor__channel-delete"
            disabled={sorted.length <= 2}
            aria-label={`Delete ${label} stop`}
            onClick={() => {
              if (sorted.length <= 2) return;
              const next = sorted.filter((_, i) => i !== selected);
              onChange(next);
              setSelected(Math.max(0, Math.min(selected, next.length - 1)));
            }}
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Opacity stop bar — drag to move, click to add, delete to remove, numeric
 * opacity input for the selected stop. Keyboard operable (arrows/Home/End).
 */
function OpacityStopBar({
  opacityStops,
  onChange,
  onEditStart,
  onEditEnd,
}: {
  opacityStops: GradientMapOpacityStop[];
  onChange: (stops: GradientMapOpacityStop[]) => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
}) {
  const [selected, setSelected] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const sorted = useMemo(
    () => [...opacityStops].sort((a, b) => a.position - b.position),
    [opacityStops],
  );
  const autoId = useId();

  const updateStop = useCallback(
    (index: number, partial: Partial<GradientMapOpacityStop>) => {
      onChange(sorted.map((s, i) => (i === index ? { ...s, ...partial } : s)));
    },
    [sorted, onChange],
  );

  const addStop = useCallback(
    (position: number) => {
      const opacity = interpolatedOpacityAt(sorted, position);
      const next = [...sorted, { position, opacity }];
      onChange(next);
      setSelected(next.length - 1);
    },
    [sorted, onChange],
  );

  const removeStop = useCallback(
    (index: number) => {
      if (sorted.length <= 2) return;
      const next = sorted.filter((_, i) => i !== index);
      onChange(next);
      setSelected(Math.max(0, Math.min(selected, next.length - 1)));
    },
    [sorted, onChange, selected],
  );

  const handleBarPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const bar = barRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const near = sorted.findIndex((s) => Math.abs(s.position - pos) < 0.03);
      if (near >= 0) {
        setSelected(near);
        return;
      }
      addStop(pos);
    },
    [sorted, addStop],
  );

  const handleStopDrag = useCallback(
    (index: number, e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      onEditStart?.();
      const bar = barRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      let draggedOff = false;
      const onMove = (me: PointerEvent) => {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          const pos = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
          updateStop(index, { position: Math.round(pos * 1000) / 1000 });
        });
        draggedOff = me.clientY < rect.top - 40 || me.clientY > rect.bottom + 40;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.style.userSelect = '';
        if (draggedOff) removeStop(index);
        onEditEnd?.();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      document.body.style.userSelect = 'none';
    },
    [updateStop, removeStop, onEditStart, onEditEnd],
  );

  const current = sorted[selected];

  return (
    <div className="gm-editor__opacity">
      <div className="gm-editor__row">
        <span className="gm-editor__label">Opacity stops</span>
      </div>
      <div
        ref={barRef}
        role="slider"
        aria-label="Gradient map opacity stop bar — click to add, drag stops to reposition"
        aria-valuenow={Math.round((current?.position ?? 0) * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        onPointerDown={handleBarPointerDown}
        className="gm-editor__bar gm-editor__bar--opacity"
      >
        {sorted.map((stop, i) => (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: gradient stops have no stable id; position/color change while editing (content keys would remount mid-drag)
            key={`os-stop-${i}-${autoId}`}
            type="button"
            aria-label={`Opacity stop ${i + 1} at ${Math.round(stop.position * 100)}%, opacity ${Math.round(stop.opacity * 100)}%`}
            aria-pressed={selected === i}
            onPointerDown={(e) => {
              e.stopPropagation();
              setSelected(i);
              handleStopDrag(i, e);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') {
                e.preventDefault();
                updateStop(i, { position: Math.max(0, stop.position - 0.01) });
              } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                updateStop(i, { position: Math.min(1, stop.position + 0.01) });
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                updateStop(i, { opacity: Math.min(1, stop.opacity + 0.05) });
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                updateStop(i, { opacity: Math.max(0, stop.opacity - 0.05) });
              } else if (e.key === 'Home') {
                e.preventDefault();
                updateStop(i, { position: 0 });
              } else if (e.key === 'End') {
                e.preventDefault();
                updateStop(i, { position: 1 });
              } else if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                removeStop(i);
              }
            }}
            className={`gm-editor__stop gm-editor__stop--opacity${selected === i ? ' gm-editor__stop--selected' : ' gm-editor__stop--idle'}`}
            style={{ left: `${stop.position * 100}%` }}
          />
        ))}
      </div>
      {current && (
        <div className="gm-editor__row">
          <span className="gm-editor__label">Opacity</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={Math.round(current.opacity * 100)}
            aria-label={`Opacity stop ${selected + 1} value`}
            onChange={(e) =>
              updateStop(selected, {
                opacity: Math.max(0, Math.min(1, Number(e.target.value) / 100)),
              })
            }
            className="gm-editor__number"
          />
          <span className="gm-editor__unit">%</span>
        </div>
      )}
    </div>
  );
}

export function GradientMapEditor({
  stops,
  dither,
  preserveLuminosity,
  mode = 'luminance',
  channelStops,
  opacityStops,
  reverse = false,
  intensity = 1,
  luminanceMode = 'relative-luminance',
  preserveSourceAlpha = true,
  interpolation = 'oklab',
  onChange,
  onEditStart,
  onEditEnd,
}: GradientMapEditorProps) {
  const [selectedStop, setSelectedStop] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const autoId = useId();

  const updateStop = useCallback(
    (index: number, partial: Partial<GradientMapStop>) => {
      const next = stops.map((s, i) => (i === index ? { ...s, ...partial } : s));
      onChange({ stops: next });
    },
    [stops, onChange],
  );

  const addStop = useCallback(
    (position: number) => {
      const color = interpolatedColorAt(stops, position);
      const newStops = [...stops, { position, color }];
      onChange({ stops: newStops });
      setSelectedStop(newStops.length - 1);
    },
    [stops, onChange],
  );

  const removeStop = useCallback(
    (index: number) => {
      if (stops.length <= 2) return;
      const next = stops.filter((_, i) => i !== index);
      onChange({ stops: next });
      setSelectedStop(Math.max(0, Math.min(selectedStop, next.length - 1)));
    },
    [stops, onChange, selectedStop],
  );

  const handleBarPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const bar = barRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const near = stops.findIndex((s) => Math.abs(s.position - pos) < 0.03);
      if (near >= 0) {
        setSelectedStop(near);
        return;
      }
      addStop(pos);
    },
    [stops, addStop],
  );

  const handleStopDrag = useCallback(
    (index: number, e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      onEditStart?.();
      const bar = barRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      let draggedOff = false;
      const onMove = (me: PointerEvent) => {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          const pos = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
          updateStop(index, { position: Math.round(pos * 1000) / 1000 });
        });
        const offY = me.clientY;
        draggedOff = offY < rect.top - 40 || offY > rect.bottom + 40;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.style.userSelect = '';
        if (draggedOff) {
          removeStop(index);
        }
        onEditEnd?.();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      document.body.style.userSelect = 'none';
    },
    [updateStop, removeStop, onEditStart, onEditEnd],
  );

  const currentStop = stops[selectedStop];

  const handleBarKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'a' || e.key === 'A' || e.key === 'Insert') {
        e.preventDefault();
        const pos = currentStop ? Math.min(1, currentStop.position + 0.1) : 0.5;
        addStop(pos);
      }
    },
    [currentStop, addStop],
  );

  const rStops = channelStops?.r ?? [
    { position: 0, color: [0, 0, 0, 255] as Color },
    { position: 1, color: [255, 0, 0, 255] as Color },
  ];
  const gStops = channelStops?.g ?? [
    { position: 0, color: [0, 0, 0, 255] as Color },
    { position: 1, color: [0, 255, 0, 255] as Color },
  ];
  const bStops = channelStops?.b ?? [
    { position: 0, color: [0, 0, 0, 255] as Color },
    { position: 1, color: [0, 0, 255, 255] as Color },
  ];

  const effectiveOpacityStops = opacityStops && opacityStops.length > 0 ? opacityStops : undefined;

  return (
    <div className="gm-editor">
      <div className="gm-editor__row">
        <span className="gm-editor__label">Mode</span>
        <Select
          label="Mapping mode"
          value={mode}
          options={[
            { value: 'luminance', label: 'Luminance' },
            { value: 'channel', label: 'Channel' },
          ]}
          onChange={(v) => onChange({ mode: v as 'luminance' | 'channel' })}
        />
      </div>
      {mode === 'channel' && (
        <ChannelBars
          rStops={rStops}
          gStops={gStops}
          bStops={bStops}
          onChange={(ch) => onChange({ channelStops: ch })}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
        />
      )}
      <div
        ref={barRef}
        role="slider"
        aria-label="Gradient map stop bar — click to add, drag stops to reposition"
        aria-valuenow={Math.round((currentStop?.position ?? 0) * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${Math.round((currentStop?.position ?? 0) * 100)}%`}
        tabIndex={0}
        onPointerDown={handleBarPointerDown}
        onKeyDown={handleBarKeyDown}
        className="gm-editor__bar"
        style={{ background: gradientCss(stops) }}
      >
        {stops.map((stop, i) => (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: gradient stops have no stable id; position/color change while editing (content keys would remount mid-drag)
            key={`gm-stop-${i}-${autoId}`}
            type="button"
            aria-label={`Stop ${i + 1} at ${Math.round(stop.position * 100)}%`}
            aria-pressed={selectedStop === i}
            onPointerDown={(e) => {
              e.stopPropagation();
              setSelectedStop(i);
              handleStopDrag(i, e);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') {
                e.preventDefault();
                updateStop(i, {
                  position: Math.max(0, stop.position - 0.01),
                });
              } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                updateStop(i, {
                  position: Math.min(1, stop.position + 0.01),
                });
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                updateStop(i, {
                  position: Math.max(0, stop.position - 0.05),
                });
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                updateStop(i, {
                  position: Math.min(1, stop.position + 0.05),
                });
              } else if (e.key === 'Home') {
                e.preventDefault();
                updateStop(i, { position: 0 });
              } else if (e.key === 'End') {
                e.preventDefault();
                updateStop(i, { position: 1 });
              } else if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                removeStop(i);
              }
            }}
            className={`gm-editor__stop${selectedStop === i ? ' gm-editor__stop--selected' : ' gm-editor__stop--idle'}`}
            style={{
              left: `${stop.position * 100}%`,
              background: stopColorCss(stop.color),
            }}
          />
        ))}
      </div>

      {currentStop && (
        <div className="gm-editor__stop-controls">
          <div className="gm-editor__row">
            <span className="gm-editor__label">Position</span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={Math.round(currentStop.position * 100)}
              aria-label={`Stop ${selectedStop + 1} position`}
              onChange={(e) =>
                updateStop(selectedStop, {
                  position: Math.max(0, Math.min(1, Number(e.target.value) / 100)),
                })
              }
              className="gm-editor__number"
            />
            <span className="gm-editor__unit">%</span>
          </div>
          <ColorPicker
            value={colorToManaged(currentStop.color)}
            onChange={(c) => updateStop(selectedStop, { color: managedToColor(c) })}
            onInteractionStart={onEditStart}
            onInteractionEnd={onEditEnd}
          />
        </div>
      )}

      <OpacityStopBar
        opacityStops={
          effectiveOpacityStops ?? [
            { position: 0, opacity: 1 },
            { position: 1, opacity: 1 },
          ]
        }
        onChange={(next) => onChange({ opacityStops: next })}
        onEditStart={onEditStart}
        onEditEnd={onEditEnd}
      />

      <div className="gm-editor__row">
        <span className="gm-editor__label">Interpolation</span>
        <Select
          label="Gradient interpolation"
          value={interpolation}
          options={INTERPOLATION_OPTIONS}
          onChange={(v) => onChange({ interpolation: v as GradientInterpolationSpace })}
        />
      </div>

      <div className="gm-editor__row">
        <span className="gm-editor__label">Luminance</span>
        <Select
          label="Luminance source"
          value={luminanceMode}
          options={LUMINANCE_OPTIONS}
          onChange={(v) => onChange({ luminanceMode: v as GradientMapLuminanceMode })}
        />
      </div>

      <div className="gm-editor__row">
        <span className="gm-editor__label">Intensity</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(intensity * 100)}
          onChange={(e) => onChange({ intensity: Number(e.target.value) / 100 })}
          aria-label="Gradient map intensity"
          onPointerDown={onEditStart}
          onPointerUp={onEditEnd}
          className="gm-editor__slider"
        />
        <span className="gm-editor__unit">{Math.round(intensity * 100)}%</span>
      </div>

      <div className="gm-editor__row">
        <span className="gm-editor__label">Reverse</span>
        <input
          type="checkbox"
          checked={reverse}
          onChange={(e) => onChange({ reverse: e.target.checked })}
          aria-label="Reverse gradient map"
        />
      </div>

      <div className="gm-editor__row">
        <span className="gm-editor__label">Dither</span>
        <input
          type="checkbox"
          checked={dither}
          onChange={(e) => onChange({ dither: e.target.checked })}
          aria-label="Dither gradient map"
        />
      </div>

      <div className="gm-editor__row">
        <span className="gm-editor__label">Keep alpha</span>
        <input
          type="checkbox"
          checked={preserveSourceAlpha}
          onChange={(e) => onChange({ preserveSourceAlpha: e.target.checked })}
          aria-label="Preserve source alpha"
        />
      </div>

      <div className="gm-editor__row">
        <span className="gm-editor__label">Luminosity</span>
        <input
          type="checkbox"
          checked={preserveLuminosity}
          onChange={(e) => onChange({ preserveLuminosity: e.target.checked })}
          aria-label="Preserve luminosity"
        />
      </div>
    </div>
  );
}
