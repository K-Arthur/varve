import { useCallback, useId } from 'react';

export interface SpinbuttonRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  unit?: string;
  /** Keyboard step (ArrowUp/Down). Default 1. */
  step?: number;
  /** Displayed decimal places. Default 0 (integers). */
  decimals?: number;
  /** Allow negative values (Lab a/b). */
  signed?: boolean;
  /** Wrap at min/max (hue). */
  wrap?: boolean;
}

export function SpinbuttonRow({
  label,
  value,
  min,
  max,
  onChange,
  unit,
  step = 1,
  decimals = 0,
  signed = false,
  wrap = false,
}: SpinbuttonRowProps) {
  const inputId = useId();
  const clamp = useCallback((v: number) => Math.max(min, Math.min(max, v)), [min, max]);
  const wrapValue = useCallback(
    (v: number) => {
      if (!wrap) return clamp(v);
      // Hue-style wrap: 360 -> 0, -1 -> 359 (modulo range).
      const range = max - min;
      if (range <= 0) return min;
      return ((((v - min) % range) + range) % range) + min;
    },
    [clamp, min, max, wrap],
  );

  const display = Number.isFinite(value) ? value.toFixed(decimals) : String(value);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const delta = e.shiftKey ? step * 10 : step;
    let newValue = value;
    switch (e.key) {
      case 'ArrowUp':
        newValue = wrapValue(value + delta);
        break;
      case 'ArrowDown':
        newValue = wrapValue(value - delta);
        break;
      case 'Home':
        newValue = min;
        break;
      case 'End':
        newValue = max;
        break;
      default:
        return;
    }
    e.preventDefault();
    onChange(newValue);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.trim();
    const pattern = signed ? /^-?\d*\.?\d*$/ : /^\d*\.?\d*$/;
    if (!pattern.test(raw) || raw === '' || raw === '-' || raw === '.') return;
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) return;
    onChange(wrapValue(parsed));
  };

  const valueText = unit ? `${display}${unit}` : display;

  return (
    <div className="insp-field">
      <label className="insp-field__label" htmlFor={inputId}>
        {label}
      </label>
      <div className="insp-field__control">
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          role="spinbutton"
          className="insp-num__input color-fields__input-full"
          value={display}
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuetext={valueText}
          aria-label={label}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  );
}
