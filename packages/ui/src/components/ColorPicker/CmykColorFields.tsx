import { useCallback } from 'react';
import type { ManagedColor } from '@strata/scene';
import { SpinbuttonRow } from './SpinbuttonRow';

export interface CmykColorFieldsProps {
  value: ManagedColor & { space: 'cmyk' };
  onChange: (color: ManagedColor) => void;
}

export function CmykColorFields({ value, onChange }: CmykColorFieldsProps) {
  const toPct = (v: number) => Math.round((v / 255) * 100);
  const fromPct = (pct: number) => Math.round((pct / 100) * 255);

  const emit = useCallback(
    (partial: Partial<{ c: number; m: number; y: number; k: number; a: number }>) => {
      onChange({
        ...value,
        ...partial,
      });
    },
    [value, onChange],
  );

  return (
    <div className="color-fields">
      <SpinbuttonRow
        label="C"
        value={toPct(value.c)}
        min={0}
        max={100}
        onChange={(v) => emit({ c: fromPct(v) })}
        unit="%"
      />
      <SpinbuttonRow
        label="M"
        value={toPct(value.m)}
        min={0}
        max={100}
        onChange={(v) => emit({ m: fromPct(v) })}
        unit="%"
      />
      <SpinbuttonRow
        label="Y"
        value={toPct(value.y)}
        min={0}
        max={100}
        onChange={(v) => emit({ y: fromPct(v) })}
        unit="%"
      />
      <SpinbuttonRow
        label="K"
        value={toPct(value.k)}
        min={0}
        max={100}
        onChange={(v) => emit({ k: fromPct(v) })}
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
