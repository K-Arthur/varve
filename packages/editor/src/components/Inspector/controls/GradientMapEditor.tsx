import type { Color, GradientMapStop } from '@strata/engine';
import { GRADIENT_MAP_PRESETS } from '@strata/engine';
import type { ManagedColor } from '@strata/scene';
import { rgbFromTuple } from '@strata/scene';
import { managedColorToRgba } from '@strata/shared';
import { Select } from '@strata/ui';
import { ColorPicker } from '@strata/ui/components/ColorPicker';
import { useCallback, useId, useMemo, useRef, useState } from 'react';

function colorToManaged(c: Color): ManagedColor {
  return rgbFromTuple(c);
}

function managedToColor(c: ManagedColor): Color {
  if (c.space === 'rgb') return [c.r, c.g, c.b, c.a] as Color;
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
  onChange: (
    patch: Partial<{
      stops: GradientMapStop[];
      dither: boolean;
      preserveLuminosity: boolean;
      mode: 'luminance' | 'channel';
      channelStops: GradientMapChannelStops;
    }>,
  ) => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
}

/**
 * Compact per-channel gradient bars for channel mapping mode.
 * Each channel (R, G, B) gets its own gradient bar with editable stops.
 */
function ChannelBars({
  rStops,
  gStops,
  bStops,
  onChange,
}: {
  rStops: GradientMapStop[];
  gStops: GradientMapStop[];
  bStops: GradientMapStop[];
  onChange: (ch: GradientMapChannelStops) => void;
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
      {channels.map(({ key, label, stops, accent }) => (
        <ChannelBar
          key={key}
          label={label}
          accent={accent}
          stops={stops}
          onChange={(next) => onChange({ [key]: next } as GradientMapChannelStops)}
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
}: {
  label: string;
  accent: string;
  stops: GradientMapStop[];
  onChange: (stops: GradientMapStop[]) => void;
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

export function GradientMapEditor({
  stops,
  dither,
  preserveLuminosity,
  mode = 'luminance',
  channelStops,
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

  const currentPresetId = useMemo(() => {
    const match = GRADIENT_MAP_PRESETS.find(
      (p) =>
        p.stops.length === stops.length &&
        p.stops.every(
          (ps, i) =>
            Math.abs(ps.position - stops[i]!.position) < 0.01 &&
            ps.color[0] === stops[i]!.color[0] &&
            ps.color[1] === stops[i]!.color[1] &&
            ps.color[2] === stops[i]!.color[2],
        ),
    );
    return match?.id ?? '';
  }, [stops]);

  const handlePresetSelect = useCallback(
    (value: string) => {
      const preset = GRADIENT_MAP_PRESETS.find((p) => p.id === value);
      if (preset) {
        onChange({
          stops: preset.stops.map((s) => ({ position: s.position, color: [...s.color] as Color })),
        });
        setSelectedStop(0);
      }
    },
    [onChange],
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

  return (
    <div className="gm-editor">
      <div className="gm-editor__row">
        <span className="gm-editor__label">Preset</span>
        <Select
          label="Gradient map preset"
          value={currentPresetId}
          placeholder="Custom"
          options={GRADIENT_MAP_PRESETS.map((p) => ({ value: p.id, label: p.name }))}
          onChange={handlePresetSelect}
        />
      </div>
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
          />
        </div>
      )}

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
        <span className="gm-editor__label">Preserve Luminosity</span>
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
