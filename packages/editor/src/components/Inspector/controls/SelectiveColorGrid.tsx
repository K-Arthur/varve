/**
 * SelectiveColorGrid — 3x3 grid of color target controls for Selective Color.
 *
 * Each cell shows a color swatch, target name, and four NumberInput sliders
 * for Cyan/Magenta/Yellow/Black. A method toggle (Absolute/Relative) applies
 * to all targets.
 *
 * Research basis: Photoshop Selective Color panel.
 */
import type { SelectiveColorParams, SelectiveColorTarget } from '@varve/engine';
import { useCallback } from 'react';
import { NumberField } from './NumberField';

const TARGETS: { target: SelectiveColorTarget; label: string; color: string }[] = [
  { target: 'red', label: 'Reds', color: '#e74c3c' },
  { target: 'green', label: 'Greens', color: '#2ecc71' },
  { target: 'blue', label: 'Blues', color: '#3498db' },
  { target: 'cyan', label: 'Cyans', color: '#1abc9c' },
  { target: 'magenta', label: 'Magentas', color: '#9b59b6' },
  { target: 'yellow', label: 'Yellows', color: '#f1c40f' },
  { target: 'white', label: 'Whites', color: '#ecf0f1' },
  { target: 'neutral', label: 'Neutrals', color: '#95a5a6' },
  { target: 'black', label: 'Blacks', color: '#2c3e50' },
];

function defaultParams(method: 'absolute' | 'relative'): SelectiveColorParams[] {
  return TARGETS.map((t) => ({
    color: t.target,
    cyan: 0,
    magenta: 0,
    yellow: 0,
    black: 0,
    method,
  }));
}

export interface SelectiveColorGridProps {
  value: SelectiveColorParams[];
  onChange: (params: SelectiveColorParams[]) => void;
}

export function SelectiveColorGrid({ value, onChange }: SelectiveColorGridProps) {
  const method = value.length > 0 ? (value[0]?.method ?? 'relative') : 'relative';

  const getParams = useCallback(
    (target: SelectiveColorTarget): SelectiveColorParams => {
      return (
        value.find((p) => p.color === target) ?? {
          color: target,
          cyan: 0,
          magenta: 0,
          yellow: 0,
          black: 0,
          method,
        }
      );
    },
    [value, method],
  );

  const updateParam = useCallback(
    (target: SelectiveColorTarget, updater: (p: SelectiveColorParams) => SelectiveColorParams) => {
      const existing = value.findIndex((p) => p.color === target);
      let next: SelectiveColorParams[];
      if (existing >= 0) {
        next = value.map((p, i) => (i === existing ? updater(p) : p));
      } else {
        const defaults = defaultParams(method).find((p) => p.color === target);
        next = [
          ...value,
          updater(defaults ?? { color: target, cyan: 0, magenta: 0, yellow: 0, black: 0, method }),
        ];
      }
      onChange(next);
    },
    [value, method, onChange],
  );

  const setMethod = useCallback(
    (m: 'absolute' | 'relative') => {
      onChange(value.map((p) => ({ ...p, method: m })));
    },
    [value, onChange],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div
        className="insp-segmented"
        role="radiogroup"
        aria-label="Method"
        style={{ alignSelf: 'flex-start' }}
      >
        {(['relative', 'absolute'] as const).map((m) => (
          <label
            key={m}
            className={`insp-segmented__btn${method === m ? ' insp-segmented__btn--active' : ''}`}
          >
            <input
              type="radio"
              name="adjustment-method"
              checked={method === m}
              onChange={() => setMethod(m)}
            />
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </label>
        ))}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 'var(--space-1)',
        }}
      >
        {TARGETS.map((t) => {
          const params = getParams(t.target);
          return (
            <div
              key={t.target}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-1)',
                padding: 'var(--space-1)',
                background: 'var(--color-surface-sunken)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border-subtle)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '2px',
                    background: t.color,
                    flexShrink: 0,
                    border: '1px solid var(--color-border-subtle)',
                  }}
                />
                <span
                  style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--color-text-muted)' }}
                >
                  {t.label}
                </span>
              </div>
              <NumberField
                label="C"
                value={params.cyan}
                min={-100}
                max={100}
                step={1}
                onChange={(v) => updateParam(t.target, (p) => ({ ...p, cyan: v }))}
              />
              <NumberField
                label="M"
                value={params.magenta}
                min={-100}
                max={100}
                step={1}
                onChange={(v) => updateParam(t.target, (p) => ({ ...p, magenta: v }))}
              />
              <NumberField
                label="Y"
                value={params.yellow}
                min={-100}
                max={100}
                step={1}
                onChange={(v) => updateParam(t.target, (p) => ({ ...p, yellow: v }))}
              />
              <NumberField
                label="K"
                value={params.black}
                min={-100}
                max={100}
                step={1}
                onChange={(v) => updateParam(t.target, (p) => ({ ...p, black: v }))}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
