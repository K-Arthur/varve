import type {
  Color,
  GradientMapLuminanceMode,
  GradientMapOpacityStop,
  GradientMapStop,
} from '@varve/engine';
import { sampleGradientMapAlpha, sampleGradientMapColor } from '@varve/engine';
import type { GradientInterpolationSpace, ManagedColor } from '@varve/scene';
import { cryptoId, rgbFromTuple } from '@varve/scene';
import { denormalizeChannel, managedColorToRgba, normalizeChannel } from '@varve/shared';
import { Select, Switch } from '@varve/ui';
import { ColorPicker } from '@varve/ui/components/ColorPicker';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { RangeValueControl } from './RangeValueControl';

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

function gradientCss(
  stops: GradientMapStop[],
  interpolation: GradientInterpolationSpace,
  reverse: boolean,
  opacityStops: GradientMapOpacityStop[] | undefined,
): string {
  const parts = Array.from({ length: 33 }, (_, index) => index / 32).map((position) => {
    const color = sampleGradientMapColor(stops, position, { interpolation, reverse });
    const alpha = sampleGradientMapAlpha(stops, opacityStops, position, { reverse });
    return `rgba(${color[0]},${color[1]},${color[2]},${alpha.toFixed(3)}) ${(position * 100).toFixed(2)}%`;
  });
  return `linear-gradient(90deg, ${parts.join(', ')})`;
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

type StopIdentityMap = WeakMap<object, string>;

function stableStopId(
  stop: GradientMapStop | GradientMapOpacityStop,
  index: number,
  map: StopIdentityMap,
  prefix: string,
): string {
  if (stop.id) return stop.id;
  const object = stop as object;
  const existing = map.get(object);
  if (existing) return existing;
  const id = `${prefix}-${index + 1}-${cryptoId()}`;
  map.set(object, id);
  return id;
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
  { value: 'linear-srgb', label: 'Linear RGB' },
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
  interpolation,
  reverse,
}: {
  rStops: GradientMapStop[];
  gStops: GradientMapStop[];
  bStops: GradientMapStop[];
  onChange: (ch: GradientMapChannelStops) => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
  interpolation: GradientInterpolationSpace;
  reverse: boolean;
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
          interpolation={interpolation}
          reverse={reverse}
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
  interpolation,
  reverse,
}: {
  label: string;
  accent: string;
  stops: GradientMapStop[];
  onChange: (stops: GradientMapStop[]) => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
  interpolation: GradientInterpolationSpace;
  reverse: boolean;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const idsRef = useRef<StopIdentityMap>(new WeakMap());
  const sorted = useMemo(
    () =>
      stops
        .map((stop, index) => ({
          ...stop,
          id: stableStopId(stop, index, idsRef.current, `gradient-${label.toLowerCase()}`),
        }))
        .sort((a, b) => a.position - b.position),
    [stops, label],
  );
  const [selectedId, setSelectedId] = useState<string | null>(sorted[0]?.id ?? null);

  useEffect(() => {
    if (!selectedId || sorted.some((stop) => stop.id === selectedId)) return;
    setSelectedId(sorted[0]?.id ?? null);
  }, [selectedId, sorted]);

  const handleBarClick = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const bar = barRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const near = sorted.findIndex((s) => Math.abs(s.position - pos) < 0.04);
      if (near >= 0) {
        setSelectedId(sorted[near]!.id);
        return;
      }
      const id = cryptoId();
      const color = sampleGradientMapColor(sorted, pos, { interpolation, reverse });
      onChange([...sorted, { id, position: pos, color }]);
      setSelectedId(id);
    },
    [sorted, onChange, interpolation, reverse],
  );

  const updateStop = useCallback(
    (id: string, partial: Partial<GradientMapStop>) => {
      const next = stops.map((stop, index) =>
        stableStopId(stop, index, idsRef.current, `gradient-${label.toLowerCase()}`) === id
          ? { ...stop, id, ...partial }
          : stop,
      );
      onChange(next);
    },
    [stops, onChange, label],
  );

  const selectedIndex = sorted.findIndex((stop) => stop.id === selectedId);
  const current = selectedIndex >= 0 ? sorted[selectedIndex] : sorted[0];

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
        style={{ background: gradientCss(sorted, interpolation, reverse, undefined) }}
        onPointerDown={handleBarClick}
      >
        {sorted.map((stop, i) => (
          <button
            // Legacy callers may omit ids; the index fallback remains stable for
            // the lifetime of that unnormalized input while editing.
            key={stop.id ?? `ch-${label}-${i}`}
            type="button"
            aria-label={`${label} stop ${i + 1} at ${Math.round(stop.position * 100)}%`}
            className={`gm-editor__stop${selectedId === stop.id ? ' gm-editor__stop--selected' : ' gm-editor__stop--idle'}`}
            style={{ left: `${stop.position * 100}%`, background: stopColorCss(stop.color) }}
            onPointerDown={(e) => {
              e.stopPropagation();
              setSelectedId(stop.id);
            }}
          />
        ))}
      </div>
      {current && (
        <div className="gm-editor__channel-controls">
          <ColorPicker
            value={colorToManaged(current.color)}
            onChange={(c) => updateStop(current.id, { color: managedToColor(c) })}
            onInteractionStart={onEditStart}
            onInteractionEnd={onEditEnd}
          />
          <button
            type="button"
            className="gm-editor__channel-delete"
            disabled={sorted.length <= 2}
            aria-label={`Delete ${label} stop`}
            onClick={() => {
              if (sorted.length <= 2 || !current) return;
              const next = stops.filter(
                (stop, index) =>
                  stableStopId(stop, index, idsRef.current, `gradient-${label.toLowerCase()}`) !==
                  current.id,
              );
              onChange(next);
              const fallback = next[0];
              setSelectedId(
                fallback
                  ? stableStopId(fallback, 0, idsRef.current, `gradient-${label.toLowerCase()}`)
                  : null,
              );
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
  colorStops,
  opacityStops,
  onChange,
  onEditStart,
  onEditEnd,
  reverse,
}: {
  colorStops: GradientMapStop[];
  opacityStops: GradientMapOpacityStop[];
  onChange: (stops: GradientMapOpacityStop[]) => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
  reverse: boolean;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const idsRef = useRef<StopIdentityMap>(new WeakMap());
  const sorted = useMemo(
    () =>
      opacityStops
        .map((stop, index) => ({
          ...stop,
          id: stableStopId(stop, index, idsRef.current, 'gradient-opacity'),
        }))
        .sort((a, b) => a.position - b.position),
    [opacityStops],
  );
  const [selectedId, setSelectedId] = useState<string | null>(sorted[0]?.id ?? null);
  const autoId = useId();

  useEffect(() => {
    if (!selectedId || sorted.some((stop) => stop.id === selectedId)) return;
    setSelectedId(sorted[0]?.id ?? null);
  }, [selectedId, sorted]);

  const updateStop = useCallback(
    (id: string, partial: Partial<GradientMapOpacityStop>) => {
      onChange(
        opacityStops.map((stop, index) =>
          stableStopId(stop, index, idsRef.current, 'gradient-opacity') === id
            ? { ...stop, id, ...partial }
            : stop,
        ),
      );
    },
    [opacityStops, onChange],
  );

  const addStop = useCallback(
    (position: number) => {
      const id = cryptoId();
      const opacity = sampleGradientMapAlpha(colorStops, opacityStops, position, { reverse });
      const next = [...opacityStops, { id, position, opacity }];
      onChange(next);
      setSelectedId(id);
    },
    [colorStops, opacityStops, onChange, reverse],
  );

  const removeStop = useCallback(
    (id: string) => {
      if (sorted.length <= 2) return;
      const next = opacityStops.filter(
        (stop, index) => stableStopId(stop, index, idsRef.current, 'gradient-opacity') !== id,
      );
      onChange(next);
      const fallback = next[0];
      setSelectedId(
        fallback ? stableStopId(fallback, 0, idsRef.current, 'gradient-opacity') : null,
      );
    },
    [sorted, opacityStops, onChange],
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
        setSelectedId(sorted[near]!.id);
        return;
      }
      addStop(pos);
    },
    [sorted, addStop],
  );

  const handleStopDrag = useCallback(
    (id: string, e: React.PointerEvent<HTMLButtonElement>) => {
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
          updateStop(id, { position: Math.round(pos * 1000) / 1000 });
        });
        draggedOff = me.clientY < rect.top - 40 || me.clientY > rect.bottom + 40;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.style.userSelect = '';
        if (draggedOff) removeStop(id);
        onEditEnd?.();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      document.body.style.userSelect = 'none';
    },
    [updateStop, removeStop, onEditStart, onEditEnd],
  );

  const selectedIndex = sorted.findIndex((stop) => stop.id === selectedId);
  const current = selectedIndex >= 0 ? sorted[selectedIndex] : sorted[0];

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
            // Legacy callers may omit ids; the index fallback remains stable for
            // the lifetime of that unnormalized input while editing.
            key={stop.id ?? `os-stop-${i}-${autoId}`}
            type="button"
            aria-label={`Opacity stop ${i + 1} at ${Math.round(stop.position * 100)}%, opacity ${Math.round(stop.opacity * 100)}%`}
            aria-pressed={selectedId === stop.id}
            onPointerDown={(e) => {
              e.stopPropagation();
              setSelectedId(stop.id);
              handleStopDrag(stop.id, e);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') {
                e.preventDefault();
                updateStop(stop.id, { position: Math.max(0, stop.position - 0.01) });
              } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                updateStop(stop.id, { position: Math.min(1, stop.position + 0.01) });
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                updateStop(stop.id, { opacity: Math.min(1, stop.opacity + 0.05) });
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                updateStop(stop.id, { opacity: Math.max(0, stop.opacity - 0.05) });
              } else if (e.key === 'Home') {
                e.preventDefault();
                updateStop(stop.id, { position: 0 });
              } else if (e.key === 'End') {
                e.preventDefault();
                updateStop(stop.id, { position: 1 });
              } else if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                removeStop(stop.id);
              }
            }}
            className={`gm-editor__stop gm-editor__stop--opacity${selectedId === stop.id ? ' gm-editor__stop--selected' : ' gm-editor__stop--idle'}`}
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
            aria-label={`Opacity stop ${(selectedIndex >= 0 ? selectedIndex : 0) + 1} value`}
            onChange={(e) => {
              if (current) {
                updateStop(current.id, {
                  opacity: Math.max(0, Math.min(1, Number(e.target.value) / 100)),
                });
              }
            }}
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
  const barRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const idsRef = useRef<StopIdentityMap>(new WeakMap());
  const sortedStops = useMemo(
    () =>
      stops
        .map((stop, index) => ({
          ...stop,
          id: stableStopId(stop, index, idsRef.current, 'gradient-map'),
        }))
        .sort((a, b) => a.position - b.position),
    [stops],
  );
  const [selectedId, setSelectedId] = useState<string | null>(sortedStops[0]?.id ?? null);

  useEffect(() => {
    if (!selectedId || sortedStops.some((stop) => stop.id === selectedId)) return;
    setSelectedId(sortedStops[0]?.id ?? null);
  }, [selectedId, sortedStops]);

  const updateStop = useCallback(
    (id: string, partial: Partial<GradientMapStop>) => {
      const next = stops.map((stop, index) =>
        stableStopId(stop, index, idsRef.current, 'gradient-map') === id
          ? { ...stop, id, ...partial }
          : stop,
      );
      onChange({ stops: next });
    },
    [stops, onChange],
  );

  const addStop = useCallback(
    (position: number) => {
      const id = cryptoId();
      const color = sampleGradientMapColor(sortedStops, position, { interpolation, reverse });
      const newStops = [...stops, { id, position, color }];
      onChange({ stops: newStops });
      setSelectedId(id);
    },
    [stops, sortedStops, onChange, interpolation, reverse],
  );

  const removeStop = useCallback(
    (id: string) => {
      if (sortedStops.length <= 2) return;
      const next = stops.filter(
        (stop, index) => stableStopId(stop, index, idsRef.current, 'gradient-map') !== id,
      );
      onChange({ stops: next });
      const fallback = next[0];
      setSelectedId(fallback ? stableStopId(fallback, 0, idsRef.current, 'gradient-map') : null);
    },
    [stops, sortedStops, onChange],
  );

  const handleBarPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const bar = barRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const near = sortedStops.findIndex((s) => Math.abs(s.position - pos) < 0.03);
      if (near >= 0) {
        setSelectedId(sortedStops[near]!.id);
        return;
      }
      addStop(pos);
    },
    [sortedStops, addStop],
  );

  const handleStopDrag = useCallback(
    (id: string, e: React.PointerEvent<HTMLButtonElement>) => {
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
          updateStop(id, { position: Math.round(pos * 1000) / 1000 });
        });
        const offY = me.clientY;
        draggedOff = offY < rect.top - 40 || offY > rect.bottom + 40;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.style.userSelect = '';
        if (draggedOff) {
          removeStop(id);
        }
        onEditEnd?.();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      document.body.style.userSelect = 'none';
    },
    [updateStop, removeStop, onEditStart, onEditEnd],
  );

  const selectedIndex = sortedStops.findIndex((stop) => stop.id === selectedId);
  const currentStop = selectedIndex >= 0 ? sortedStops[selectedIndex] : sortedStops[0];

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
          interpolation={interpolation}
          reverse={reverse}
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
        style={{
          background: gradientCss(sortedStops, interpolation, reverse, effectiveOpacityStops),
        }}
      >
        {sortedStops.map((stop, i) => (
          <button
            key={stop.id}
            type="button"
            aria-label={`Stop ${i + 1} at ${Math.round(stop.position * 100)}%`}
            aria-pressed={selectedId === stop.id}
            onPointerDown={(e) => {
              e.stopPropagation();
              setSelectedId(stop.id);
              handleStopDrag(stop.id, e);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') {
                e.preventDefault();
                updateStop(stop.id, {
                  position: Math.max(0, stop.position - 0.01),
                });
              } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                updateStop(stop.id, {
                  position: Math.min(1, stop.position + 0.01),
                });
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                updateStop(stop.id, {
                  position: Math.max(0, stop.position - 0.05),
                });
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                updateStop(stop.id, {
                  position: Math.min(1, stop.position + 0.05),
                });
              } else if (e.key === 'Home') {
                e.preventDefault();
                updateStop(stop.id, { position: 0 });
              } else if (e.key === 'End') {
                e.preventDefault();
                updateStop(stop.id, { position: 1 });
              } else if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                removeStop(stop.id);
              }
            }}
            className={`gm-editor__stop${selectedId === stop.id ? ' gm-editor__stop--selected' : ' gm-editor__stop--idle'}`}
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
              step={0.1}
              value={Number((currentStop.position * 100).toFixed(3))}
              aria-label={`Stop ${selectedIndex + 1} position`}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (Number.isFinite(value)) {
                  updateStop(currentStop.id, {
                    position: Math.max(0, Math.min(1, value / 100)),
                  });
                }
              }}
              className="gm-editor__number"
            />
            <span className="gm-editor__unit">%</span>
          </div>
          <div className="gm-editor__row">
            <span className="gm-editor__label">Midpoint</span>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={Number(((currentStop.midpoint ?? 0.5) * 100).toFixed(3))}
              aria-label={`Stop ${selectedIndex + 1} midpoint`}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (Number.isFinite(value)) {
                  updateStop(currentStop.id, {
                    midpoint: Math.max(0, Math.min(1, value / 100)),
                  });
                }
              }}
              className="gm-editor__number"
            />
            <span className="gm-editor__unit">%</span>
          </div>
          <ColorPicker
            value={colorToManaged(currentStop.color)}
            onChange={(c) => updateStop(currentStop.id, { color: managedToColor(c) })}
            onInteractionStart={onEditStart}
            onInteractionEnd={onEditEnd}
          />
        </div>
      )}

      <OpacityStopBar
        colorStops={sortedStops}
        opacityStops={
          effectiveOpacityStops ?? [
            { position: 0, opacity: 1 },
            { position: 1, opacity: 1 },
          ]
        }
        onChange={(next) => onChange({ opacityStops: next })}
        onEditStart={onEditStart}
        onEditEnd={onEditEnd}
        reverse={reverse}
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
        <RangeValueControl
          id="gradient-map-intensity"
          label="Gradient map intensity"
          value={intensity * 100}
          min={0}
          max={100}
          step={1}
          unit="%"
          rangeClassName="varve-native-range gm-editor__slider"
          rangeAriaLabel="Gradient map intensity"
          onRangePointerDown={onEditStart}
          onRangePointerUp={onEditEnd}
          onChange={(value) => onChange({ intensity: value / 100 })}
        />
      </div>

      <Switch
        className="gm-editor__switch"
        label="Reverse"
        checked={reverse}
        onChange={(e) => onChange({ reverse: e.target.checked })}
        aria-label="Reverse gradient map"
      />
      <Switch
        className="gm-editor__switch"
        label="Dither"
        checked={dither}
        onChange={(e) => onChange({ dither: e.target.checked })}
        aria-label="Dither gradient map"
      />
      <Switch
        className="gm-editor__switch"
        label="Keep alpha"
        checked={preserveSourceAlpha}
        onChange={(e) => onChange({ preserveSourceAlpha: e.target.checked })}
        aria-label="Preserve source alpha"
      />
      <Switch
        className="gm-editor__switch"
        label="Luminosity"
        checked={preserveLuminosity}
        onChange={(e) => onChange({ preserveLuminosity: e.target.checked })}
        aria-label="Preserve luminosity"
      />
    </div>
  );
}
