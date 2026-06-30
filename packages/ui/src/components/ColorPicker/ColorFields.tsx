import { useCallback, useId, useState } from 'react';
import type { Color } from './color-utils';
import { hexToRgb, hslToRgb, hsbToRgb, rgbToHex, rgbToHsl, rgbToHsb } from './color-utils';

export interface ColorFieldsProps {
  color: Color;
  onChange: (color: Color) => void;
}

type ColorMode = 'hex' | 'rgb' | 'hsl' | 'hsb';

const MODES: { key: ColorMode; label: string }[] = [
  { key: 'hex', label: 'HEX' },
  { key: 'rgb', label: 'RGB' },
  { key: 'hsl', label: 'HSL' },
  { key: 'hsb', label: 'HSB' },
];

export function ColorFields({ color, onChange }: ColorFieldsProps) {
  const [mode, setMode] = useState<ColorMode>('hex');
  const [hexDraft, setHexDraft] = useState('');
  const hexId = useId();

  const alphaPct = Math.round((color[3] / 255) * 100);

  const commitHex = useCallback(
    (raw: string) => {
      const parsed = hexToRgb(raw);
      if (parsed) {
        onChange([parsed[0], parsed[1], parsed[2], color[3]]);
      }
      setHexDraft('');
    },
    [color, onChange],
  );

  const handleHexKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitHex(hexDraft);
      } else if (e.key === 'Escape') {
        setHexDraft('');
      }
    },
    [hexDraft, commitHex],
  );

  const currentHex = rgbToHex(color[0], color[1], color[2]);

  const [hslH, hslS, hslL] = rgbToHsl(color[0], color[1], color[2]);
  const [hsbH, hsbS, hsbB] = rgbToHsb(color[0], color[1], color[2]);

  const rgbOnChange = useCallback(
    (r: number, g: number, b: number, a: number) => {
      onChange([r, g, b, a]);
    },
    [onChange],
  );

  const setR = useCallback(
    (r: number) => rgbOnChange(r, color[1], color[2], color[3]),
    [rgbOnChange, color],
  );
  const setG = useCallback(
    (g: number) => rgbOnChange(color[0], g, color[2], color[3]),
    [rgbOnChange, color],
  );
  const setB = useCallback(
    (b: number) => rgbOnChange(color[0], color[1], b, color[3]),
    [rgbOnChange, color],
  );

  const setH = useCallback(
    (h: number) => {
      const [r, g, b] = hslToRgb(h, hslS, hslL);
      onChange([r, g, b, color[3]]);
    },
    [hslS, hslL, color, onChange],
  );
  const setS = useCallback(
    (s: number) => {
      const [r, g, b] = hslToRgb(hslH, s, hslL);
      onChange([r, g, b, color[3]]);
    },
    [hslH, hslL, color, onChange],
  );
  const setL = useCallback(
    (l: number) => {
      const [r, g, b] = hslToRgb(hslH, hslS, l);
      onChange([r, g, b, color[3]]);
    },
    [hslH, hslS, color, onChange],
  );

  const setHsbH = useCallback(
    (h: number) => {
      const [r, g, b] = hsbToRgb(h, hsbS, hsbB);
      onChange([r, g, b, color[3]]);
    },
    [hsbS, hsbB, color, onChange],
  );
  const setHsbS = useCallback(
    (s: number) => {
      const [r, g, b] = hsbToRgb(hsbH, s, hsbB);
      onChange([r, g, b, color[3]]);
    },
    [hsbH, hsbB, color, onChange],
  );
  const setHsbB = useCallback(
    (b: number) => {
      const [r, g, b2] = hsbToRgb(hsbH, hsbS, b);
      onChange([r, g, b2, color[3]]);
    },
    [hsbH, hsbS, color, onChange],
  );

  const setAlpha = useCallback(
    (a: number) => {
      onChange([color[0], color[1], color[2], Math.round(a * 2.55)]);
    },
    [color, onChange],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <div
        style={{
          display: 'inline-flex',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-sm)',
          overflow: 'hidden',
          alignSelf: 'flex-start',
        }}
        role="radiogroup"
        aria-label="Color format"
      >
        {MODES.map((m) => (
          <button
            type="button"
            key={m.key}
            aria-pressed={mode === m.key}
            onClick={() => setMode(m.key)}
            style={{
              padding: '0 var(--space-2)',
              height: 'var(--space-5)',
              background: mode === m.key ? 'var(--color-interactive-default)' : 'transparent',
              color: mode === m.key ? 'var(--color-text-on-accent)' : 'var(--color-text-muted)',
              border: 'none',
              borderRight: '1px solid var(--color-border-subtle)',
              font: 'inherit',
              fontSize: 'var(--font-size-xs)',
              cursor: 'pointer',
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'hex' && (
        <div className="insp-field">
          <label className="insp-field__label" htmlFor={hexId}>
            HEX
          </label>
          <div className="insp-field__control">
            <input
              id={hexId}
              type="text"
              className="insp-num__input"
              value={hexDraft || currentHex}
              aria-label="Hex color"
              style={{ width: '100%' }}
              onChange={(e) => setHexDraft(e.target.value)}
              onBlur={() => commitHex(hexDraft)}
              onKeyDown={handleHexKeyDown}
            />
          </div>
        </div>
      )}

      {mode === 'rgb' && (
        <>
          <SpinbuttonRow label="R" value={color[0]} min={0} max={255} onChange={setR} />
          <SpinbuttonRow label="G" value={color[1]} min={0} max={255} onChange={setG} />
          <SpinbuttonRow label="B" value={color[2]} min={0} max={255} onChange={setB} />
          <SpinbuttonRow
            label="A"
            value={alphaPct}
            min={0}
            max={100}
            onChange={setAlpha}
            unit="%"
          />
        </>
      )}

      {mode === 'hsl' && (
        <>
          <SpinbuttonRow label="H" value={hslH} min={0} max={360} onChange={setH} unit="°" />
          <SpinbuttonRow label="S" value={hslS} min={0} max={100} onChange={setS} unit="%" />
          <SpinbuttonRow label="L" value={hslL} min={0} max={100} onChange={setL} unit="%" />
          <SpinbuttonRow
            label="A"
            value={alphaPct}
            min={0}
            max={100}
            onChange={setAlpha}
            unit="%"
          />
        </>
      )}

      {mode === 'hsb' && (
        <>
          <SpinbuttonRow label="H" value={hsbH} min={0} max={360} onChange={setHsbH} unit="°" />
          <SpinbuttonRow label="S" value={hsbS} min={0} max={100} onChange={setHsbS} unit="%" />
          <SpinbuttonRow label="B" value={hsbB} min={0} max={100} onChange={setHsbB} unit="%" />
          <SpinbuttonRow
            label="A"
            value={alphaPct}
            min={0}
            max={100}
            onChange={setAlpha}
            unit="%"
          />
        </>
      )}
    </div>
  );
}

interface SpinbuttonRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  unit?: string;
}

function SpinbuttonRow({ label, value, min, max, onChange, unit }: SpinbuttonRowProps) {
  const inputId = useId();
  const clamp = (v: number) => Math.max(min, Math.min(max, v));

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const step = e.shiftKey ? 10 : 1;
    let newValue = value;
    switch (e.key) {
      case 'ArrowUp':
        newValue = clamp(value + step);
        break;
      case 'ArrowDown':
        newValue = clamp(value - step);
        break;
      case 'Home':
        newValue = min;
        break;
      case 'End':
        newValue = max;
        break;
      default:
        return;
    }
    e.preventDefault();
    onChange(newValue);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (/^\d+$/.test(raw)) {
      onChange(clamp(Number(raw)));
    }
  };

  return (
    <div className="insp-field">
      <label className="insp-field__label" htmlFor={inputId}>
        {unit ? `${label} (${unit})` : label}
      </label>
      <div className="insp-field__control">
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          role="spinbutton"
          className="insp-num__input"
          value={value}
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuetext={unit ? `${value}${unit}` : String(value)}
          aria-label={label}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          style={{ width: '100%' }}
        />
      </div>
    </div>
  );
}
