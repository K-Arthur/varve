import { COLOR_DISPLAY_DECIMALS } from '@strata/shared';
import { useCallback } from 'react';
import { SpinbuttonRow } from './SpinbuttonRow';

export interface LabChannelValues {
  l: number;
  av: number;
  b: number;
  /** Alpha as percent (0-100, display form). */
  alpha: number;
}

export interface LabColorFieldsProps {
  value: LabChannelValues;
  onChange: (next: LabChannelValues) => void;
  /** When set, shows an out-of-gamut notice (text, never color-only). */
  outOfGamut?: boolean;
}

/**
 * CIELAB numeric fields: L 0-100, a and b signed, alpha 0-1.
 * Keyboard: arrow keys step by 1 (shift = 10), Home/End to bounds.
 * Decimal formatting is display-only and never rounds the authoritative
 * value.
 */
export function LabColorFields({ value, onChange, outOfGamut = false }: LabColorFieldsProps) {
  const emit = useCallback(
    (partial: Partial<LabChannelValues>) => {
      onChange({ ...value, ...partial });
    },
    [value, onChange],
  );

  return (
    <div className="color-fields">
      <SpinbuttonRow
        label="L"
        value={value.l}
        min={0}
        max={100}
        decimals={COLOR_DISPLAY_DECIMALS}
        onChange={(l) => emit({ l })}
        unit=""
      />
      <SpinbuttonRow
        label="a"
        value={value.av}
        min={-128}
        max={128}
        decimals={COLOR_DISPLAY_DECIMALS}
        signed
        onChange={(av) => emit({ av })}
        unit=""
      />
      <SpinbuttonRow
        label="b"
        value={value.b}
        min={-128}
        max={128}
        decimals={COLOR_DISPLAY_DECIMALS}
        signed
        onChange={(b) => emit({ b })}
        unit=""
      />
      <SpinbuttonRow
        label="Alpha"
        value={value.alpha}
        min={0}
        max={100}
        decimals={0}
        step={1}
        onChange={(alpha) => emit({ alpha })}
        unit="%"
      />
      {outOfGamut && (
        <p className="color-picker__gamut-note" role="note">
          Outside the display gamut — preview is clipped; the Lab value is retained unchanged.
        </p>
      )}
    </div>
  );
}
