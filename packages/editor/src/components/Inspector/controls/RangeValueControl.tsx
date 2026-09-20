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
  /** Optional id for the precision input; the range receives `${id}-range`. */
  id?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  fineStep?: number;
  /** Scale normalized model values for the human-facing precision field. */
  displayScale?: number;
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
  id,
  value,
  min,
  max,
  step = 1,
  fineStep = step / 10,
  displayScale = 1,
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
  const precisionStep = step * displayScale;
  const precisionFineStep = fineStep * displayScale;

  // The canonical skin is not opt-in: every RangeValueControl renders the
  // shared native-range primitive, and `rangeClassName` is a layout modifier.
  const rangeClass = ['varve-native-range', ...(rangeClassName?.split(/\s+/) ?? [])]
    .filter((cls, index, all) => cls !== '' && all.indexOf(cls) === index)
    .join(' ');

  // Announce the displayed value when the raw number would mislead: a
  // normalized 0.65 shown as 65% must not be read as "0.65".
  const scaledValue = Math.round(value * displayScale * 100) / 100;
  const rangeValueText = unit || displayScale !== 1 ? `${scaledValue}${unit ?? ''}` : undefined;

  return (
    <div className="range-value-control">
      <input
        id={id ? `${id}-range` : undefined}
        type="range"
        className={rangeClass}
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={rangeAriaLabel ?? label}
        aria-valuetext={rangeValueText}
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
          id={id}
          label={`${label} value`}
          displayLabel="Value"
          hideLabel
          value={value * displayScale}
          min={min * displayScale}
          max={max * displayScale}
          step={precisionStep}
          altStep={precisionFineStep}
          shiftStep={precisionStep * 10}
          unit={unit}
          disabled={disabled}
          onChange={(precisionValue) => onChange(precisionValue / displayScale)}
        />
      </div>
    </div>
  );
}
