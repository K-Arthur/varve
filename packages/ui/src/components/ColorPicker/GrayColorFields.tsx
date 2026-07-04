import { useCallback } from 'react';
import type { ManagedColor } from '@strata/scene';
import { SpinbuttonRow } from './SpinbuttonRow';

export interface GrayColorFieldsProps {
  value: ManagedColor & { space: 'gray' };
  onChange: (color: ManagedColor) => void;
}

export function GrayColorFields({ value, onChange }: GrayColorFieldsProps) {
  const toPct = (v: number) => Math.round((v / 255) * 100);
  const fromPct = (pct: number) => Math.round((pct / 100) * 255);

  const emit = useCallback(
    (partial: Partial<{ v: number; a: number }>) => {
      onChange({ ...value, ...partial });
    },
    [value, onChange],
  );

  return (
    <div className="color-fields">
      <SpinbuttonRow
        label="Gray"
        value={toPct(value.v)}
        min={0}
        max={100}
        onChange={(v) => emit({ v: fromPct(v) })}
        unit="%"
      />
      <SpinbuttonRow
        label="A"
        value={Math.round((value.a / 255) * 100)}
        min={0}
        max={100}
        onChange={(v) => emit({ a: Math.round((v / 100) * 255) })}
        unit="%"
      />
    </div>
  );
}
