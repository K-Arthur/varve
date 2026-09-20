/**
 * Labelled range row for photo-source recipes: name, live value, and the
 * shared native-range primitive.
 *
 * One implementation for the photo source, HDR source, HDR merge, and gain-map
 * surfaces — previously four copies that had drifted (some inputs had an
 * accessible name, some relied on the wrapping label and its output text).
 */
import './photoRangeControl.css';

export interface PhotoRangeControlProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  onChange: (value: number) => void;
}

/** Decimals that make the readout stable for the step in use. */
function formatRangeValue(value: number, step: number): string {
  return value.toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0);
}

export function PhotoRangeControl({
  label,
  min,
  max,
  step,
  value,
  unit = '',
  onChange,
}: PhotoRangeControlProps) {
  return (
    <label className="photo-range">
      <span>
        {label}{' '}
        <output>
          {formatRangeValue(value, step)}
          {unit}
        </output>
      </span>
      <input
        type="range"
        className="varve-native-range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
