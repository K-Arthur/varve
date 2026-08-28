/**
 * GradientEditor — multi-stop gradient editor for gradient fills.
 *
 * Renders a stop bar with draggable stops, add/delete, position fields, and a
 * rotation control. Stop colours use the accessible ColorPicker.
 *
 * Research basis: Figma/Sketch gradient stop bar; APG Slider for stop
 * positioning; Pointer Events for drag (cross-platform, Linux-first).
 */

import type {
  BitDepth,
  ColorMode,
  GradientFill,
  GradientInterpolationSpace,
  GradientStop,
  GradientTilingMode,
  GradientType,
  HueInterpolation,
  ManagedColor,
} from '@varve/scene';
import type { InterpolationRgba, Rect } from '@varve/shared';
import {
  denormalizeChannel,
  expandGradientStops,
  gradientRotationForBounds,
  interpolateNormalizedColor,
  managedColorToRgba,
  normalizeChannel,
  setGradientRotation,
} from '@varve/shared';
import { Icon, Select } from '@varve/ui';
import { ColorPicker, rgbToHex } from '@varve/ui/components/ColorPicker';
import { useCallback, useId, useRef, useState } from 'react';

export interface GradientEditorProps {
  gradient: GradientFill;
  onChange: (gradient: GradientFill) => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
  documentColorMode?: ColorMode;
  /** Resolved document default used when this gradient inherits it. */
  documentGradientInterpolation?: GradientInterpolationSpace;
  /**
   * When true, the selected gradients disagree on interpolation space. The
   * control shows a "Mixed" placeholder (WCAG 1.4.1 — never colour alone) and
   * a deliberate change applies the chosen value to all selected gradients.
   */
  mixedInterpolationSpace?: boolean;
  /** Mirrors {@link mixedInterpolationSpace} for the cylindrical hue control. */
  mixedHue?: boolean;
  /** Bounds of the single node being edited, for affine geometry controls. */
  gradientBounds?: Rect;
}

const INTERPOLATION_SPACES: { value: GradientInterpolationSpace; label: string }[] = [
  { value: 'oklab', label: 'OKLab' },
  { value: 'oklch', label: 'OKLCH' },
  { value: 'linear-srgb', label: 'Linear RGB' },
  { value: 'hsl', label: 'HSL' },
  { value: 'srgb', label: 'sRGB' },
] as const;

const HUE_INTERPOLATION_OPTIONS: { value: HueInterpolation; label: string }[] = [
  { value: 'shorter', label: 'Shorter' },
  { value: 'longer', label: 'Longer' },
  { value: 'increasing', label: 'Increasing' },
  { value: 'decreasing', label: 'Decreasing' },
];

const GRADIENT_TYPES: { value: GradientType; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'radial', label: 'Radial' },
  { value: 'angular', label: 'Angular' },
  { value: 'diamond', label: 'Diamond' },
];

const TILING_MODES: { value: GradientTilingMode; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'repeat', label: 'Repeat' },
  { value: 'reflect', label: 'Reflect' },
];

function stopColorCss(c: ManagedColor): string {
  const [r, g, b, a] = managedColorToRgba(c);
  return `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`;
}

function gradientCss(
  g: GradientFill,
  documentGradientInterpolation: GradientInterpolationSpace = 'oklab',
): string {
  // CSS is only the inspector preview; use the same sampled engine as the
  // canvas and resolve inheritance without mutating the document.
  const space: GradientInterpolationSpace =
    g.interpolationSource === 'document'
      ? documentGradientInterpolation
      : (g.interpolationSpace ?? 'srgb');
  const inputs = g.stops.map((st) => {
    const [r, gv, b, a] = managedColorToRgba(st.color);
    return {
      position: st.position,
      color: { space: 'rgb' as const, r, g: gv, b, a },
      midpoint: st.midpoint,
    };
  });
  const expanded =
    space === 'srgb'
      ? inputs.map((i) => ({ position: i.position, color: i.color }))
      : expandGradientStops(inputs, space, 12, {
          hueInterpolation: g.hueInterpolation ?? 'shorter',
        });
  const stopCss = expanded
    .map((s) => {
      const [r, gv, b, a] = managedColorToRgba(s.color);
      return `rgba(${r},${gv},${b},${(a / 255).toFixed(2)}) ${(s.position * 100).toFixed(1)}%`;
    })
    .join(', ');
  if (g.type === 'linear') {
    return `linear-gradient(${g.rotation ?? 90}deg, ${stopCss})`;
  }
  if (g.type === 'radial') {
    return `radial-gradient(circle, ${stopCss})`;
  }
  if (g.type === 'angular') {
    return `conic-gradient(from ${g.rotation ?? 0}deg, ${stopCss})`;
  }
  return `radial-gradient(circle, ${stopCss})`;
}

export function GradientEditor({
  gradient,
  onChange,
  onEditStart,
  onEditEnd,
  documentColorMode,
  documentGradientInterpolation = 'oklab',
  mixedInterpolationSpace = false,
  mixedHue = false,
  gradientBounds,
}: GradientEditorProps) {
  const [selectedStop, setSelectedStop] = useState(0);
  const effectiveInterpolationSpace: GradientInterpolationSpace =
    gradient.interpolationSource === 'document'
      ? documentGradientInterpolation
      : (gradient.interpolationSpace ?? 'srgb');
  const barRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const autoId = useId();

  const updateStop = useCallback(
    (index: number, partial: Partial<GradientStop>) => {
      const next = gradient.stops.map((s, i) => (i === index ? { ...s, ...partial } : s));
      onChange({ ...gradient, stops: next });
    },
    [gradient, onChange],
  );

  const addStop = useCallback(
    (position: number) => {
      const sorted = [...gradient.stops].sort((a, b) => a.position - b.position);
      const defaultColor: ManagedColor = { space: 'rgb', r: 57, g: 208, b: 198, a: 255 };
      let color: ManagedColor = sorted[0]?.color ?? defaultColor;
      // Interpolate in normalized 0-1 space so a new stop in a uint16/float
      // document is not collapsed to the 8-bit gradient lattice.
      const toNormalized = (c: ManagedColor): InterpolationRgba => {
        if (c.space === 'rgb') {
          const bd = c.bitDepth ?? 'uint8';
          return {
            r: normalizeChannel(c.r, bd),
            g: normalizeChannel(c.g, bd),
            b: normalizeChannel(c.b, bd),
            a: normalizeChannel(c.a, bd),
          };
        }
        const [r, g, b, a] = managedColorToRgba(c);
        return { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };
      };
      // Storage depth: prefer the neighboring stops' precision, then the
      // document default via the color-config-aware caller-supplied depth.
      const depthOf = (c: ManagedColor): BitDepth =>
        c.space === 'rgb' ? (c.bitDepth ?? 'uint8') : 'uint8';
      const storageDepth: BitDepth = sorted[0]?.color ? depthOf(sorted[0].color) : 'uint8';
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i] as GradientStop;
        const b = sorted[i + 1] as GradientStop;
        if (position >= a.position && position <= b.position) {
          const span = b.position - a.position;
          const linearT = span === 0 ? 0 : (position - a.position) / span;
          const midpoint = a.midpoint ?? 0.5;
          const blendT =
            midpoint === 0.5
              ? linearT
              : linearT <= midpoint
                ? 0.5 * (linearT / midpoint)
                : 0.5 + 0.5 * ((linearT - midpoint) / (1 - midpoint));
          const fromN = toNormalized(a.color);
          const toN = toNormalized(b.color);
          const mid = interpolateNormalizedColor(fromN, toN, blendT, effectiveInterpolationSpace, {
            hueInterpolation: gradient.hueInterpolation ?? 'shorter',
          });
          color = {
            space: 'rgb',
            bitDepth: storageDepth !== 'uint8' ? storageDepth : undefined,
            r: denormalizeChannel(mid.r, storageDepth),
            g: denormalizeChannel(mid.g, storageDepth),
            b: denormalizeChannel(mid.b, storageDepth),
            a: denormalizeChannel(mid.a, storageDepth),
          };
          break;
        }
      }
      const newStops = [...gradient.stops, { position, color }];
      onChange({ ...gradient, stops: newStops });
      setSelectedStop(newStops.length - 1);
    },
    [effectiveInterpolationSpace, gradient, onChange],
  );

  const removeStop = useCallback(
    (index: number) => {
      if (gradient.stops.length <= 2) return;
      const next = gradient.stops.filter((_, i) => i !== index);
      onChange({ ...gradient, stops: next });
      setSelectedStop(Math.max(0, Math.min(selectedStop, next.length - 1)));
    },
    [gradient, onChange, selectedStop],
  );

  const handleBarPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const bar = barRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const near = gradient.stops.findIndex((s) => Math.abs(s.position - pos) < 0.03);
      if (near >= 0) {
        setSelectedStop(near);
        return;
      }
      addStop(pos);
    },
    [gradient.stops, addStop],
  );

  const handleStopDrag = useCallback(
    (index: number, e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      onEditStart?.();
      const bar = barRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      const onMove = (me: PointerEvent) => {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          const pos = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
          updateStop(index, { position: Math.round(pos * 1000) / 1000 });
        });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.style.userSelect = '';
        onEditEnd?.();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      document.body.style.userSelect = 'none';
    },
    [updateStop, onEditStart, onEditEnd],
  );

  const currentStop = gradient.stops[selectedStop];
  const linearGradientBounds = gradient.type === 'linear' ? gradientBounds : undefined;
  const displayRotation = linearGradientBounds
    ? gradientRotationForBounds(gradient, linearGradientBounds)
    : (gradient.rotation ?? 0);

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

  return (
    <div className="gradient-editor">
      <div className="insp-field">
        <span className="insp-field__label">Type</span>
        <div className="insp-field__control">
          <Select
            label="Gradient type"
            value={gradient.type}
            options={GRADIENT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            onChange={(v) => onChange({ ...gradient, type: v as GradientType })}
          />
        </div>
      </div>

      <div className="insp-field">
        <span className="insp-field__label">Interpolation</span>
        <div className="insp-field__control">
          <Select
            label="Gradient interpolation space"
            value={
              mixedInterpolationSpace
                ? ''
                : gradient.interpolationSource === 'document'
                  ? 'document'
                  : (gradient.interpolationSpace ?? 'srgb')
            }
            options={[
              ...(mixedInterpolationSpace ? [{ value: '', label: 'Mixed', disabled: true }] : []),
              {
                value: 'document',
                label: `Document default (${documentGradientInterpolationLabel(documentGradientInterpolation)})`,
              },
              ...INTERPOLATION_SPACES,
            ]}
            onChange={(v) => {
              if (v === 'document') {
                const { interpolationSpace: _space, ...rest } = gradient;
                onChange({ ...rest, interpolationSource: 'document' });
                return;
              }
              const { interpolationSource: _source, ...rest } = gradient;
              onChange({
                ...rest,
                interpolationSpace: v as GradientInterpolationSpace,
              });
            }}
          />
        </div>
        <span className="insp-field__hint" role="note">
          Stop colours interpolate separately from the document working profile. Alpha uses
          premultiplied colour to avoid transparent-stop halos.
        </span>
      </div>

      {(effectiveInterpolationSpace === 'oklch' || effectiveInterpolationSpace === 'hsl') && (
        <div className="insp-field">
          <span className="insp-field__label">Hue</span>
          <div className="insp-field__control">
            <Select
              label="Hue interpolation direction"
              value={mixedHue ? '' : (gradient.hueInterpolation ?? 'shorter')}
              options={[
                ...(mixedHue ? [{ value: '', label: 'Mixed', disabled: true }] : []),
                ...HUE_INTERPOLATION_OPTIONS,
              ]}
              onChange={(v) =>
                onChange({
                  ...gradient,
                  hueInterpolation: v as HueInterpolation,
                })
              }
            />
          </div>
        </div>
      )}

      <div className="insp-field">
        <span className="insp-field__label">Tiling</span>
        <div className="insp-field__control">
          <Select
            label="Gradient tiling mode"
            value={gradient.tilingMode ?? 'none'}
            options={TILING_MODES.map((m) => ({ value: m.value, label: m.label }))}
            onChange={(v) =>
              onChange({
                ...gradient,
                tilingMode: v as GradientTilingMode,
              })
            }
          />
        </div>
      </div>

      <div className="gradient-editor__bar-wrap">
        <div
          ref={barRef}
          role="slider"
          aria-label="Gradient stop bar — click to add, drag stops to reposition"
          aria-valuenow={Math.round((currentStop?.position ?? 0) * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={`${Math.round((currentStop?.position ?? 0) * 100)}%`}
          tabIndex={0}
          onPointerDown={handleBarPointerDown}
          onKeyDown={handleBarKeyDown}
          className="gradient-editor__bar"
          style={{ background: gradientCss(gradient, documentGradientInterpolation) }}
        >
          {gradient.stops.map((stop, i) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: gradient stops have no stable id; position/color change while editing (content keys would remount mid-drag)
              key={`stop-${i}-${autoId}`}
              type="button"
              aria-label={`Stop ${i + 1} at ${Math.round(stop.position * 100)}%, colour ${(() => {
                const [r, g, b] = managedColorToRgba(stop.color);
                return rgbToHex(r, g, b);
              })()}`}
              aria-pressed={selectedStop === i}
              onPointerDown={(e) => {
                e.stopPropagation();
                setSelectedStop(i);
                handleStopDrag(i, e);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  updateStop(i, { position: Math.max(0, stop.position - 0.01) });
                } else if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  updateStop(i, { position: Math.min(1, stop.position + 0.01) });
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  updateStop(i, { position: Math.max(0, stop.position - 0.05) });
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  updateStop(i, { position: Math.min(1, stop.position + 0.05) });
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
              className={`gradient-editor__stop${selectedStop === i ? ' gradient-editor__stop--selected' : ' gradient-editor__stop--idle'}`}
              style={{
                left: `${stop.position * 100}%`,
                background: stopColorCss(stop.color),
              }}
            />
          ))}
        </div>
      </div>

      {currentStop && (
        <div className="gradient-editor__stop-controls">
          <div className="insp-field">
            <span className="insp-field__label">Position</span>
            <div className="insp-field__control">
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
                className="insp-num__input gradient-editor__position-input"
              />
              <span className="gradient-editor__unit">%</span>
              <button
                type="button"
                aria-label={`Remove stop ${selectedStop + 1}`}
                onClick={() => removeStop(selectedStop)}
                disabled={gradient.stops.length <= 2}
                className="gradient-editor__remove-btn"
              >
                <Icon name="Trash2" label={undefined} size="0.85em" />
              </button>
            </div>
          </div>
          <div className="insp-field">
            <span className="insp-field__label">Midpoint</span>
            <div className="insp-field__control">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={currentStop.midpoint ?? 0.5}
                aria-label={`Stop ${selectedStop + 1} midpoint`}
                onChange={(e) => updateStop(selectedStop, { midpoint: Number(e.target.value) })}
                className="gradient-editor__slider"
              />
              <span className="gradient-editor__unit">
                {Math.round((currentStop.midpoint ?? 0.5) * 100)}%
              </span>
            </div>
          </div>
          <ColorPicker
            value={currentStop.color}
            onChange={(c) => updateStop(selectedStop, { color: c as ManagedColor })}
            documentColorMode={documentColorMode}
            onInteractionStart={onEditStart}
            onInteractionEnd={onEditEnd}
          />
        </div>
      )}

      {(gradient.type === 'linear' || gradient.type === 'angular') && (
        <div className="insp-field">
          <span className="insp-field__label">Rotation</span>
          <div className="insp-field__control">
            <input
              type="number"
              min={0}
              max={360}
              step={1}
              value={displayRotation}
              aria-label="Gradient rotation"
              onChange={(e) => {
                const rotation = Number(e.target.value);
                onChange(
                  linearGradientBounds
                    ? setGradientRotation(gradient, linearGradientBounds, rotation)
                    : { ...gradient, rotation },
                );
              }}
              className="insp-num__input gradient-editor__position-input"
            />
            <span className="gradient-editor__unit">deg</span>
          </div>
        </div>
      )}
    </div>
  );
}

function documentGradientInterpolationLabel(space: GradientInterpolationSpace): string {
  return INTERPOLATION_SPACES.find((option) => option.value === space)?.label ?? 'OKLab';
}
