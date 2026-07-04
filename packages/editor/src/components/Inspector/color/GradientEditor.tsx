/**
 * GradientEditor — multi-stop gradient editor for gradient fills.
 *
 * Renders a stop bar with draggable stops, add/delete, position fields, and a
 * rotation control. Stop colours use the accessible ColorPicker.
 *
 * Research basis: Figma/Sketch gradient stop bar; APG Slider for stop
 * positioning; Pointer Events for drag (cross-platform, Linux-first).
 */
import { managedColorToRgba } from '@strata/shared';
import type { GradientFill, GradientStop, GradientType, ManagedColor } from '@strata/scene';
import { Icon } from '@strata/ui';
import { ColorPicker, rgbToHex } from '@strata/ui/components/ColorPicker';
import { useCallback, useId, useRef, useState } from 'react';

export interface GradientEditorProps {
  gradient: GradientFill;
  onChange: (gradient: GradientFill) => void;
}

const GRADIENT_TYPES: { value: GradientType; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'radial', label: 'Radial' },
  { value: 'angular', label: 'Angular' },
  { value: 'diamond', label: 'Diamond' },
];

const SELECT_STYLE: React.CSSProperties = {
  flex: 1,
  height: 'var(--space-5)',
  fontSize: 'var(--font-size-xs)',
  background: 'var(--color-surface-sunken)',
  color: 'var(--color-text-primary)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 var(--space-2)',
};

const STOP_BAR_H = 24;

function stopColorCss(c: ManagedColor): string {
  const [r, g, b, a] = managedColorToRgba(c);
  return `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`;
}

function gradientCss(g: GradientFill): string {
  const stops = g.stops
    .map((s) => `${stopColorCss(s.color)} ${(s.position * 100).toFixed(1)}%`)
    .join(', ');
  if (g.type === 'linear') {
    return `linear-gradient(${g.rotation ?? 90}deg, ${stops})`;
  }
  if (g.type === 'radial') {
    return `radial-gradient(circle, ${stops})`;
  }
  if (g.type === 'angular') {
    return `conic-gradient(from ${g.rotation ?? 0}deg, ${stops})`;
  }
  // diamond — approximate with radial for preview
  return `radial-gradient(circle, ${stops})`;
}

export function GradientEditor({ gradient, onChange }: GradientEditorProps) {
  const [selectedStop, setSelectedStop] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
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
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i] as GradientStop;
        const b = sorted[i + 1] as GradientStop;
        if (position >= a.position && position <= b.position) {
          const t =
            b.position === a.position ? 0 : (position - a.position) / (b.position - a.position);
          const [ar, ag, ab, aa] = managedColorToRgba(a.color);
          const [br, bg, bb, ba] = managedColorToRgba(b.color);
          color = {
            space: 'rgb',
            r: Math.round(ar + (br - ar) * t),
            g: Math.round(ag + (bg - ag) * t),
            b: Math.round(ab + (bb - ab) * t),
            a: Math.round(aa + (ba - aa) * t),
          };
          break;
        }
      }
      const newStops = [...gradient.stops, { position, color }];
      onChange({ ...gradient, stops: newStops });
      setSelectedStop(newStops.length - 1);
    },
    [gradient, onChange],
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
      const bar = barRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      const onMove = (me: PointerEvent) => {
        const pos = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
        updateStop(index, { position: Math.round(pos * 1000) / 1000 });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.style.userSelect = '';
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      document.body.style.userSelect = 'none';
    },
    [updateStop],
  );

  const currentStop = gradient.stops[selectedStop];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div className="insp-field">
        <span className="insp-field__label">Type</span>
        <div className="insp-field__control">
          <select
            aria-label="Gradient type"
            value={gradient.type}
            style={SELECT_STYLE}
            onChange={(e) => onChange({ ...gradient, type: e.target.value as GradientType })}
          >
            {GRADIENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

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
        style={{
          position: 'relative',
          height: STOP_BAR_H,
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--color-border-subtle)',
          background: gradientCss(gradient),
          cursor: 'copy',
          userSelect: 'none',
        }}
      >
        {gradient.stops.map((stop, i) => (
          <button
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
              } else if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                removeStop(i);
              }
            }}
            style={{
              position: 'absolute',
              top: '50%',
              left: `${stop.position * 100}%`,
              transform: 'translate(-50%, -50%)',
              width: 14,
              height: 14,
              borderRadius: '50%',
              border:
                selectedStop === i
                  ? '2px solid var(--color-interactive-default)'
                  : '2px solid var(--color-surface-overlay)',
              background: stopColorCss(stop.color),
              cursor: 'grab',
              padding: 0,
              zIndex: 1,
            }}
          />
        ))}
      </div>

      {currentStop && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
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
                className="insp-num__input"
                style={{ width: 60 }}
              />
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                %
              </span>
              <button
                type="button"
                aria-label={`Remove stop ${selectedStop + 1}`}
                onClick={() => removeStop(selectedStop)}
                disabled={gradient.stops.length <= 2}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 24,
                  height: 24,
                  background: 'transparent',
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-muted)',
                  cursor: gradient.stops.length <= 2 ? 'not-allowed' : 'pointer',
                  padding: 0,
                  flexShrink: 0,
                  opacity: gradient.stops.length <= 2 ? 0.5 : 1,
                }}
              >
                <Icon name="Trash2" label={undefined} size="0.85em" />
              </button>
            </div>
          </div>
          <ColorPicker
            value={managedColorToRgba(currentStop.color)}
            onChange={(c) => updateStop(selectedStop, { color: { space: 'rgb' as const, r: c[0], g: c[1], b: c[2], a: c[3] ?? 255 } })}
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
              value={gradient.rotation ?? 0}
              aria-label="Gradient rotation"
              onChange={(e) => onChange({ ...gradient, rotation: Number(e.target.value) })}
              className="insp-num__input"
              style={{ width: 60 }}
            />
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              deg
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
