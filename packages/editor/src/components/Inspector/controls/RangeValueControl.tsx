/**
 * Compact slider plus direct numeric entry for effect parameters.
 *
 * Sliders remain useful for exploratory tuning; the NumberField is the
 * precision path, including keyboard stepping and arithmetic expressions.
 */
import type React from 'react';
import { NumberField } from './NumberField';
import './rangeValueControl.css';

export interface RangeValueControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  fineStep?: number;
  unit?: string;
  disabled?: boolean;
  rangeClassName?: string;
  rangeAriaLabel?: string;
  onChange: (value: number) => void;
  onRangePointerDown?: React.PointerEventHandler<HTMLInputElement>;
  onRangePointerUp?: React.PointerEventHandler<HTMLInputElement>;
  onRangePointerCancel?: React.PointerEventHandler<HTMLInputElement>;
  onRangeKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  onRangeKeyUp?: React.KeyboardEventHandler<HTMLInputElement>;
}

export function RangeValueControl({
  label,
  value,
  min,
  max,
  step = 1,
  fineStep = step / 10,
  unit,
  disabled,
  rangeClassName,
  rangeAriaLabel,
  onChange,
  onRangePointerDown,
  onRangePointerUp,
  onRangePointerCancel,
  onRangeKeyDown,
  onRangeKeyUp,
}: RangeValueControlProps) {
  return (
    <div className="range-value-control">
      <input
        type="range"
        className={rangeClassName}
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={rangeAriaLabel ?? label}
        disabled={disabled}
        onPointerDown={onRangePointerDown}
        onPointerUp={onRangePointerUp}
        onPointerCancel={onRangePointerCancel}
        onKeyDown={onRangeKeyDown}
        onKeyUp={onRangeKeyUp}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <div className="range-value-control__number">
        <NumberField
          label={`${label} value`}
          displayLabel="Value"
          hideLabel
          value={value}
          min={min}
          max={max}
          step={step}
          altStep={fineStep}
          shiftStep={step * 10}
          unit={unit}
          disabled={disabled}
          onChange={onChange}
        />
      </div>
    </div>
  );
}
