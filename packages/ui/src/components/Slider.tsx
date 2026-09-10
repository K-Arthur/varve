import { useCallback, useId, useRef, useState } from 'react';
import { Icon } from '../icons/Icon';

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  disabled?: boolean;
  /** Show an inline numeric input instead of the value display. */
  showInput?: boolean;
  /** When provided, renders a reset button that calls this handler. */
  onReset?: () => void;
  /** Size variant: 'sm' (14px thumb), 'md' (20px default), 'lg' (24px thumb). */
  size?: 'sm' | 'md' | 'lg';
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
  showInput,
  onReset,
  size,
}: SliderProps) {
  const id = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputRaw, setInputRaw] = useState<string | null>(null);

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

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    setInputRaw(raw);
    if (raw === '' || raw === '-' || raw === '.') return;
    const num = parseFloat(raw);
    if (!Number.isNaN(num)) {
      onChange(clamp(roundToStep(num)));
    }
  }

  function handleInputBlur() {
    setInputRaw(null);
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      inputRef.current?.blur();
    }
  }

  const valueText = formatValue ? formatValue(value) : `${value}`;
  const displayValue = inputRaw !== null ? inputRaw : valueText;

  const sizeClass = size ? ` varve-slider--${size}` : '';

  return (
    <fieldset className={`varve-slider${disabled ? ' varve-slider--disabled' : ''}${sizeClass}`}>
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
        {showInput ? (
          <input
            ref={inputRef}
            type="number"
            className="varve-slider__input"
            value={displayValue}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            aria-label={label}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            onKeyDown={handleInputKeyDown}
          />
        ) : (
          <output className="varve-slider__value" htmlFor={`${id}-label`}>
            {valueText}
          </output>
        )}
        {onReset && (
          <button
            type="button"
            className="varve-slider__reset"
            onClick={onReset}
            disabled={disabled}
            aria-label={`Reset ${label}`}
          >
            <Icon name="RotateCcw" size="0.75em" />
          </button>
        )}
      </div>
    </fieldset>
  );
}
