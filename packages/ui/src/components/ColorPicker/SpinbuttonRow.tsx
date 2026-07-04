import { useCallback, useId } from 'react';

export interface SpinbuttonRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  unit?: string;
}

export function SpinbuttonRow({ label, value, min, max, onChange, unit }: SpinbuttonRowProps) {
  const inputId = useId();
  const clamp = useCallback((v: number) => Math.max(min, Math.min(max, v)), [min, max]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const step = e.shiftKey ? 10 : 1;
    let newValue = value;
    switch (e.key) {
      case 'ArrowUp':
        newValue = clamp(value + step);
        break;
      case 'ArrowDown':
        newValue = clamp(value - step);
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
    const raw = e.target.value;
    if (/^\d+$/.test(raw)) {
      onChange(clamp(Number(raw)));
    }
  };

  return (
    <div className="insp-field">
      <label className="insp-field__label" htmlFor={inputId}>
        {unit ? `${label} (${unit})` : label}
      </label>
      <div className="insp-field__control">
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          role="spinbutton"
          className="insp-num__input color-fields__input-full"
          value={value}
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuetext={unit ? `${value}${unit}` : String(value)}
          aria-label={label}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  );
}
