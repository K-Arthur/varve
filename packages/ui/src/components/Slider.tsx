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
    <fieldset className={`varve-slider${disabled ? ' varve-slider--disabled' : ''}`}>
      <legend className="varve-slider__legend" id={`${id}-label`}>
        {label}
      </legend>
      <div className="varve-slider__row">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: presentational track; keyboard handled by slider thumb */}
        <div
          ref={trackRef}
          className="varve-slider__track"
          role="presentation"
          onClick={handleTrackClick}
        >
          <div className="varve-slider__fill" style={{ width: `${fraction * 100}%` }} />
          <div
            ref={thumbRef}
            className="varve-slider__thumb"
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
            style={{ left: `${fraction * 100}%` }}
          />
        </div>
        <output className="varve-slider__value" htmlFor={`${id}-label`}>
          {valueText}
        </output>
      </div>
    </fieldset>
  );
}
