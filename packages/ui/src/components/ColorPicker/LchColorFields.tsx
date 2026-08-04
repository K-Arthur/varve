import {
  COLOR_DISPLAY_DECIMALS,
  COLOR_HUE_DISPLAY_DECIMALS,
  normalizeHueDegrees,
} from '@varve/shared';
import { useCallback } from 'react';
import { SpinbuttonRow } from './SpinbuttonRow';

export interface LchChannelValues {
  l: number;
  c: number;
  h: number;
  /** Alpha as percent (0-100, display form). */
  alpha: number;
}

export interface LchColorFieldsProps {
  value: LchChannelValues;
  onChange: (next: LchChannelValues) => void;
  /** When set, shows an out-of-gamut notice (text, never color-only). */
  outOfGamut?: boolean;
}

/**
 * CIELCH numeric fields: L 0-100, C 0-150 (bounded for sane editing;
 * authoritative values may exceed it), hue 0-360 with wrap.
 *
 * Hue wrapping is deterministic: 360 wraps to 0 and -1 wraps to 359.
 * When chroma approaches zero, hue is perceptually undefined; the picker
 * keeps the last meaningful hue for editing continuity while the
 * serialized value stays valid (chroma 0).
 */
export function LchColorFields({ value, onChange, outOfGamut = false }: LchColorFieldsProps) {
  const emit = useCallback(
    (partial: Partial<LchChannelValues>) => {
      const next = { ...value, ...partial };
      if (partial.h !== undefined) {
        next.h = normalizeHueDegrees(partial.h);
      }
      onChange(next);
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
        label="C"
        value={value.c}
        min={0}
        max={150}
        decimals={COLOR_DISPLAY_DECIMALS}
        signed
        onChange={(c) => emit({ c: Math.max(0, c) })}
        unit=""
      />
      <SpinbuttonRow
        label="H"
        value={value.h}
        min={0}
        max={360}
        decimals={COLOR_HUE_DISPLAY_DECIMALS}
        wrap
        onChange={(h) => emit({ h })}
        unit="°"
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
          Outside the display gamut — preview is clipped; the LCH value is retained unchanged.
        </p>
      )}
    </div>
  );
}
