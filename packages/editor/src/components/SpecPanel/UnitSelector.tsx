/**
 * UnitSelector — dropdown/segmented control for selecting spec measurement unit.
 *
 * Persisted to localStorage('strata-spec-unit'). Default: 'px'.
 */

import type { SpecUnit } from '@varve/shared';
import { SegmentedControl } from '@varve/ui';
import { useCallback, useState } from 'react';

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
    <SegmentedControl
      label="Measurement unit"
      value={value}
      options={UNIT_OPTIONS}
      onChange={(unit) => {
        onChange(unit);
        try {
          localStorage.setItem(STORAGE_KEY, unit);
        } catch {}
      }}
      className="spec-unit-selector"
    />
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
