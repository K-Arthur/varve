import { type CSSProperties, useId, useRef, useState } from 'react';
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
  /** Size variant: 'sm' (14px thumb), 'md' (18px default), 'lg' (24px thumb). */
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Labelled slider composition over the shared native range primitive.
 *
 * The browser owns the interaction contract — arrows, Home/End,
 * PageUp/PageDown, click-to-set (WCAG 2.5.7), touch, and assistive-technology
 * exposure — while `@varve/ui`'s `.varve-native-range` owns the visuals. The
 * optional numeric input is the precision path; it edits the same value and
 * stays synchronized. See docs/architecture/slider-system.md.
 */
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputRaw, setInputRaw] = useState<string | null>(null);

  const valueText = formatValue ? formatValue(value) : `${value}`;

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    setInputRaw(raw);
    if (raw === '' || raw === '-' || raw === '.') return;
    const num = parseFloat(raw);
    if (!Number.isNaN(num)) {
      onChange(Math.min(max, Math.max(min, Math.round(num / step) * step)));
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

  const displayValue = inputRaw !== null ? inputRaw : valueText;

  const sizeClass = size ? ` varve-slider--${size}` : '';
  const fillPercent = max === min ? 0 : ((value - min) / (max - min)) * 100;

  return (
    <fieldset className={`varve-slider${disabled ? ' varve-slider--disabled' : ''}${sizeClass}`}>
      <legend className="varve-slider__legend" id={`${id}-label`}>
        {label}
      </legend>
      <div className="varve-slider__row">
        <input
          type="range"
          className="varve-native-range varve-slider__range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-labelledby={`${id}-label`}
          // Announce the formatted value only when the raw number would
          // mislead; a plain 0-100 value speaks for itself.
          aria-valuetext={formatValue ? valueText : undefined}
          // The shared skin reads this to paint the progress fill; it is
          // synced to the value on every render so it cannot drift.
          style={{ '--varve-native-range-fill': `${fillPercent}%` } as CSSProperties}
          onChange={(e) => onChange(Number(e.target.value))}
        />
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
