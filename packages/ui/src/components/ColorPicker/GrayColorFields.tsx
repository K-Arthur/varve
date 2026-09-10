import type { BitDepth, ManagedColor } from '@varve/scene';
import { denormalizeChannel, normalizeChannel } from '@varve/shared';
import { useCallback } from 'react';
import { SpinbuttonRow } from './SpinbuttonRow';

export interface GrayColorFieldsProps {
  value: ManagedColor & { space: 'gray' };
  onChange: (color: ManagedColor) => void;
}

export function GrayColorFields({ value, onChange }: GrayColorFieldsProps) {
  const bitDepth: BitDepth = value.bitDepth ?? 'uint8';
  const toPct = (v: number) => Math.round(normalizeChannel(v, bitDepth) * 100);
  const fromPct = (pct: number) => denormalizeChannel(pct / 100, bitDepth);

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
        value={toPct(value.a)}
        min={0}
        max={100}
        onChange={(v) => emit({ a: fromPct(v) })}
        unit="%"
      />
    </div>
  );
}
