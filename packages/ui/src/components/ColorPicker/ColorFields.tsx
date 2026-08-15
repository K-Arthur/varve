import type { BitDepth } from '@varve/scene';
import { useCallback, useId, useState } from 'react';
import type { Color } from './color-utils';
import { hexToRgba, hsbToRgb, hslToRgb, rgbToHex, rgbToHsb, rgbToHsl } from './color-utils';
import { SpinbuttonRow } from './SpinbuttonRow';

export interface ColorFieldsProps {
  /** Display tuple (0-255 scale, 8-bit approximation of the canonical value). */
  color: Color;
  /**
   * Storage bit depth. Determines the scale of the numeric RGB fields:
   * uint8 → 0-255, uint16 → 0-65535, float16/float32 → 0-1 with decimals.
   * Default 'uint8'.
   */
  bitDepth?: BitDepth;
  /**
   * Normalized emit (0-1 RGBA). When provided, every edit emits normalized
   * floats so the host can store at any bit depth without an 8-bit
   * intermediate. When absent, `onChange` receives the legacy 0-255 tuple.
   */
  onChangeNormalized?: (r: number, g: number, b: number, a: number) => void;
  /**
   * Canonical normalized (0-1) channels of the current value. Untouched
   * channels are carried from here so editing one channel never quantizes
   * the others (high-precision invariant). Defaults to the 8-bit display
   * tuple when absent.
   */
  canonicalNormalized?: [number, number, number, number];
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

export function ColorFields({
  color,
  onChange,
  bitDepth,
  onChangeNormalized,
  canonicalNormalized,
}: ColorFieldsProps) {
  const [mode, setMode] = useState<ColorMode>('hex');
  const [hexDraft, setHexDraft] = useState('');
  const [hexError, setHexError] = useState(false);
  const hexId = useId();

  const displayScale: 'uint8' | 'uint16' | 'float' =
    bitDepth === 'uint16'
      ? 'uint16'
      : bitDepth === 'float16' || bitDepth === 'float32'
        ? 'float'
        : 'uint8';

  const toNormalized = useCallback(
    (v: number, scale: 'uint8' | 'uint16' | 'float'): number =>
      scale === 'uint16' ? v / 65535 : scale === 'float' ? v : v / 255,
    [],
  );

  // Canonical normalized (0-1) channels: untouched channels are carried from
  // here, never from the 8-bit display tuple, so editing one channel cannot
  // quantize the others (high-precision invariant). Falls back to the
  // display tuple when the host has no canonical RGB value (e.g. a CMYK
  // value shown in RGB display space).
  const canonical = canonicalNormalized ?? [
    color[0] / 255,
    color[1] / 255,
    color[2] / 255,
    color[3] / 255,
  ];

  // Emit either normalized (precision path) or the legacy 0-255 tuple.
  const emit = useCallback(
    (r01: number, g01: number, b01: number, a01: number) => {
      if (onChangeNormalized) {
        onChangeNormalized(r01, g01, b01, a01);
        return;
      }
      onChange([
        Math.round(r01 * 255),
        Math.round(g01 * 255),
        Math.round(b01 * 255),
        Math.round(a01 * 255),
      ]);
    },
    [onChange, onChangeNormalized],
  );

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
        emit(parsed[0] / 255, parsed[1] / 255, parsed[2] / 255, (hexAlpha ?? color[3]) / 255);
        setHexError(false);
      } else {
        setHexError(true);
      }
      setHexDraft('');
    },
    [color, emit],
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

  // RGB channel edits: the edited channel is exact (converted from the
  // field's display scale); the untouched channels come from the canonical
  // normalized value so they are never quantized by the display scale.
  const setR = useCallback(
    (r: number) => emit(toNormalized(r, displayScale), canonical[1], canonical[2], canonical[3]),
    [emit, toNormalized, displayScale, canonical],
  );
  const setG = useCallback(
    (g: number) => emit(canonical[0], toNormalized(g, displayScale), canonical[2], canonical[3]),
    [emit, toNormalized, displayScale, canonical],
  );
  const setB = useCallback(
    (b: number) => emit(canonical[0], canonical[1], toNormalized(b, displayScale), canonical[3]),
    [emit, toNormalized, displayScale, canonical],
  );

  // HSL/HSB modes are full-color representations: all channels are recomputed
  // by design (there is no "untouched" channel to preserve).
  const setH = useCallback(
    (h: number) => {
      const [r, g, b] = hslToRgb(h, hslS, hslL);
      emit(r / 255, g / 255, b / 255, canonical[3]);
    },
    [hslS, hslL, canonical, emit],
  );
  const setS = useCallback(
    (s: number) => {
      const [r, g, b] = hslToRgb(hslH, s, hslL);
      emit(r / 255, g / 255, b / 255, canonical[3]);
    },
    [hslH, hslL, canonical, emit],
  );
  const setL = useCallback(
    (l: number) => {
      const [r, g, b] = hslToRgb(hslH, hslS, l);
      emit(r / 255, g / 255, b / 255, canonical[3]);
    },
    [hslH, hslS, canonical, emit],
  );

  const setHsbH = useCallback(
    (h: number) => {
      const [r, g, b] = hsbToRgb(h, hsbS, hsbB);
      emit(r / 255, g / 255, b / 255, canonical[3]);
    },
    [hsbS, hsbB, canonical, emit],
  );
  const setHsbS = useCallback(
    (s: number) => {
      const [r, g, b] = hsbToRgb(hsbH, s, hsbB);
      emit(r / 255, g / 255, b / 255, canonical[3]);
    },
    [hsbH, hsbB, canonical, emit],
  );
  const setHsbB = useCallback(
    (b: number) => {
      const [r, g, b2] = hsbToRgb(hsbH, hsbS, b);
      emit(r / 255, g / 255, b2 / 255, canonical[3]);
    },
    [hsbH, hsbS, canonical, emit],
  );

  const setAlpha = useCallback(
    (a: number) => {
      emit(canonical[0], canonical[1], canonical[2], a / 100);
    },
    [canonical, emit],
  );

  const rgbFieldRange: { min: number; max: number; step: number; decimals: number } =
    displayScale === 'uint16'
      ? { min: 0, max: 65535, step: 1, decimals: 0 }
      : displayScale === 'float'
        ? { min: 0, max: 1, step: 0.0001, decimals: 5 }
        : { min: 0, max: 255, step: 1, decimals: 0 };

  const rgbFieldValue = (v: number): number =>
    displayScale === 'uint16'
      ? Math.round((v / 255) * 65535)
      : displayScale === 'float'
        ? v / 255
        : v;

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
          <SpinbuttonRow
            label="R"
            value={rgbFieldValue(color[0])}
            min={rgbFieldRange.min}
            max={rgbFieldRange.max}
            step={rgbFieldRange.step}
            decimals={rgbFieldRange.decimals}
            onChange={setR}
          />
          <SpinbuttonRow
            label="G"
            value={rgbFieldValue(color[1])}
            min={rgbFieldRange.min}
            max={rgbFieldRange.max}
            step={rgbFieldRange.step}
            decimals={rgbFieldRange.decimals}
            onChange={setG}
          />
          <SpinbuttonRow
            label="B"
            value={rgbFieldValue(color[2])}
            min={rgbFieldRange.min}
            max={rgbFieldRange.max}
            step={rgbFieldRange.step}
            decimals={rgbFieldRange.decimals}
            onChange={setB}
          />
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
