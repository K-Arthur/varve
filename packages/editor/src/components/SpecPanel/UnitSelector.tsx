/**
 * UnitSelector — dropdown/segmented control for selecting spec measurement unit.
 *
 * Persisted to localStorage('strata-spec-unit'). Default: 'px'.
 */

import { useCallback, useState } from 'react';
import type { SpecUnit } from '@strata/shared';

const STORAGE_KEY = 'strata-spec-unit';

const UNIT_OPTIONS: { value: SpecUnit; label: string }[] = [
  { value: 'px', label: 'px' },
  { value: 'pt', label: 'pt' },
  { value: 'rem', label: 'rem' },
  { value: '%', label: '%' },
];

const INITIAL_UNIT: SpecUnit =
  (typeof localStorage !== 'undefined'
    ? (localStorage.getItem(STORAGE_KEY) as SpecUnit | null)
    : null) ?? 'px';

export interface UnitSelectorProps {
  value: SpecUnit;
  onChange: (unit: SpecUnit) => void;
}

export function UnitSelector({ value, onChange }: UnitSelectorProps) {
  return (
    <div className="spec-unit-selector" role="radiogroup" aria-label="Measurement unit">
      {UNIT_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          className={`spec-unit-selector__btn${value === opt.value ? ' spec-unit-selector__btn--active' : ''}`}
          onClick={() => {
            onChange(opt.value);
            try {
              localStorage.setItem(STORAGE_KEY, opt.value);
            } catch {}
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function useSpecUnit(): [SpecUnit, (u: SpecUnit) => void] {
  const [unit, setUnit] = useState<SpecUnit>(INITIAL_UNIT);
  const setAndPersist = useCallback((u: SpecUnit) => {
    setUnit(u);
    try {
      localStorage.setItem(STORAGE_KEY, u);
    } catch {}
  }, []);
  return [unit, setAndPersist];
}
