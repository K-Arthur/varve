import { useCallback, useId, useState } from 'react';
import type { Color } from './color-utils';
import { hexToRgba, hsbToRgb, hslToRgb, rgbToHex, rgbToHsb, rgbToHsl } from './color-utils';
import { SpinbuttonRow } from './SpinbuttonRow';

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

/** Prefix-length check: is this draft a plausible partial hex value? */
function isHexPrefix(raw: string): boolean {
  return /^#?[0-9a-fA-F]{0,8}$/.test(raw);
}

export function ColorFields({ color, onChange }: ColorFieldsProps) {
  const [mode, setMode] = useState<ColorMode>('hex');
  const [hexDraft, setHexDraft] = useState('');
  const [hexError, setHexError] = useState(false);
  const hexId = useId();

  const alphaPct = Math.round((color[3] / 255) * 100);

  const commitHex = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed === '') {
        // Focusing then leaving with no edit is not an error — keep the
        // previous valid color.
        setHexDraft('');
        setHexError(false);
        return;
      }
      const parsed = hexToRgba(trimmed);
      if (parsed) {
        // 8-/4-digit forms carry alpha; 6-/3-digit forms keep the current
        // alpha so entering a plain hex value never silently resets opacity.
        const [, , , hexAlpha] = parsed;
        onChange([parsed[0], parsed[1], parsed[2], hexAlpha ?? color[3]]);
        setHexError(false);
      } else {
        setHexError(true);
      }
      setHexDraft('');
    },
    [color, onChange],
  );

  const handleHexChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setHexDraft(next);
      if (hexError && isHexPrefix(next)) {
        setHexError(false);
      }
    },
    [hexError],
  );

  const handleHexKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitHex(hexDraft);
      } else if (e.key === 'Escape') {
        setHexDraft('');
        setHexError(false);
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
    <div className="color-fields">
      <div className="color-fields__mode-group" role="radiogroup" aria-label="Color format">
        {MODES.map((m) => (
          <button
            type="button"
            key={m.key}
            className={`color-fields__mode-btn${mode === m.key ? ' color-fields__mode-btn--active' : ''}`}
            aria-pressed={mode === m.key}
            onClick={() => setMode(m.key)}
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
              className={`insp-num__input color-fields__input-full${
                hexError ? ' color-fields__input--invalid' : ''
              }`}
              value={hexDraft || currentHex}
              aria-label="Hex color"
              aria-invalid={hexError}
              aria-describedby={hexError ? `${hexId}-error` : undefined}
              spellCheck={false}
              autoComplete="off"
              onChange={handleHexChange}
              onBlur={() => commitHex(hexDraft)}
              onKeyDown={handleHexKeyDown}
            />
          </div>
          {hexError && (
            <span id={`${hexId}-error`} className="color-fields__error" role="status">
              Enter a valid hex color (#RGB, #RRGGBB, #RGBA, or #RRGGBBAA)
            </span>
          )}
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
