import type { BitDepth, ManagedColor } from '@varve/scene';
import { denormalizeChannel, normalizeChannel } from '@varve/shared';
import { useCallback } from 'react';
import { SpinbuttonRow } from './SpinbuttonRow';

export interface CmykColorFieldsProps {
  value: ManagedColor & { space: 'cmyk' };
  onChange: (color: ManagedColor) => void;
}

export function CmykColorFields({ value, onChange }: CmykColorFieldsProps) {
  const bitDepth: BitDepth = value.bitDepth ?? 'uint8';
  const toPct = (v: number) => Math.round(normalizeChannel(v, bitDepth) * 100);
  const fromPct = (pct: number) => denormalizeChannel(pct / 100, bitDepth);

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
        value={toPct(value.a)}
        min={0}
        max={100}
        onChange={(v) => emit({ a: fromPct(v) })}
        unit="%"
      />
    </div>
  );
}
