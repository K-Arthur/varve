import { useCallback, useId, useRef } from 'react';

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  disabled?: boolean;
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  label,
  onChange,
  formatValue,
  disabled,
}: SliderProps) {
  const id = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  const fraction = max === min ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min)));
  const bigStep = step * 10;

  const clamp = useCallback((v: number) => Math.min(max, Math.max(min, v)), [min, max]);
  const roundToStep = useCallback((v: number) => Math.round(v / step) * step, [step]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    let newVal = value;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        newVal = clamp(value + step);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        newVal = clamp(value - step);
        break;
      case 'PageUp':
        newVal = clamp(value + bigStep);
        break;
      case 'PageDown':
        newVal = clamp(value - bigStep);
        break;
      case 'Home':
        newVal = min;
        break;
      case 'End':
        newVal = max;
        break;
      default:
        return;
    }
    e.preventDefault();
    if (newVal !== value) onChange(newVal);
  }

  function handleTrackClick(e: React.MouseEvent<HTMLDivElement>) {
    if (disabled || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const raw = min + frac * (max - min);
    onChange(clamp(roundToStep(raw)));
  }

  function handleThumbPointerDown(e: React.PointerEvent) {
    if (disabled) return;
    e.preventDefault();
    const thumbEl = thumbRef.current;
    if (!thumbEl) return;
    thumbEl.setPointerCapture(e.pointerId);

    function handlePointerMove(me: PointerEvent) {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
      const raw = min + frac * (max - min);
      onChange(clamp(roundToStep(raw)));
    }

    function handlePointerUp() {
      thumbEl?.removeEventListener('pointermove', handlePointerMove);
      thumbEl?.removeEventListener('pointerup', handlePointerUp);
    }

    thumbEl?.addEventListener('pointermove', handlePointerMove);
    thumbEl?.addEventListener('pointerup', handlePointerUp);
  }

  const valueText = formatValue ? formatValue(value) : `${value}`;

  return (
    <fieldset
      className="slider"
      style={{
        border: 'none',
        padding: 0,
        margin: 0,
        ...(disabled ? { opacity: 0.5, pointerEvents: 'none' } : {}),
      }}
    >
      <legend
        id={`${id}-label`}
        style={{
          display: 'block',
          marginBottom: 'var(--space-1)',
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-secondary)',
          padding: 0,
        }}
      >
        {label}
      </legend>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: presentational track; keyboard handled by slider thumb */}
        <div
          ref={trackRef}
          role="presentation"
          onClick={handleTrackClick}
          style={{
            flex: 1,
            height: 'var(--space-1)',
            background: 'var(--color-border-subtle)',
            borderRadius: 'var(--radius-sm)',
            position: 'relative',
            cursor: disabled ? 'default' : 'pointer',
          }}
        >
          <div
            style={{
              width: `${fraction * 100}%`,
              height: '100%',
              background: 'var(--color-interactive-default)',
              borderRadius: 'var(--radius-sm)',
            }}
          />
          <div
            ref={thumbRef}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-labelledby={`${id}-label`}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={value}
            aria-valuetext={valueText}
            aria-disabled={disabled}
            onKeyDown={handleKeyDown}
            onPointerDown={handleThumbPointerDown}
            style={{
              position: 'absolute',
              top: '50%',
              left: `${fraction * 100}%`,
              transform: 'translate(-50%, -50%)',
              width: 'var(--space-4)',
              height: 'var(--space-4)',
              borderRadius: '50%',
              background: 'var(--color-interactive-default)',
              border: '2px solid var(--color-surface-app)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              cursor: disabled ? 'default' : 'grab',
              touchAction: 'none',
            }}
          />
        </div>
        <output
          htmlFor={`${id}-label`}
          style={{
            minWidth: 'var(--space-8)',
            textAlign: 'right',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-primary)',
          }}
        >
          {valueText}
        </output>
      </div>
    </fieldset>
  );
}
