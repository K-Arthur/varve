/**
 * NumberField — the Inspector's numeric spinbutton (Strata plan §2, §9).
 *
 * APG Spinbutton pattern (research basis: WAI-ARIA Authoring Practices 1.2,
 * "Spinbutton" design pattern). A real, associated <label> drives the
 * accessible name (including the unit suffix); the field is keyboard-operable
 * (ArrowUp/Down, Shift x10, Alt x0.1, Home/End = min/max), scroll-to-change,
 * and drag-on-label scrubbing (Pointer Events — cross-platform, Linux-first).
 *
 * Math: commits evaluate arithmetic expressions via the safe Pratt parser in
 * @strata/scene (`evaluate`). Supports `{alias}` references resolved against
 * the active variable mode. No `eval`, no mathjs — stays local-first/offline
 * (Strata plan §0.1, §8.0). Invalid input sets `aria-invalid` + an inline,
 * `aria-describedby` error and does NOT commit.
 */
import { evaluate } from '@strata/scene';
import { useCallback, useId, useRef, useState } from 'react';

export interface NumberFieldProps {
  /** Visible label text; also the accessible name (plus unit, if any). */
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  shiftStep?: number;
  altStep?: number;
  min?: number;
  max?: number;
  /** Unit suffix folded into the accessible name and aria-valuetext (px, %, deg…). */
  unit?: string;
  /** Resolved numeric variable aliases for `{name}` math expressions. */
  aliases?: Record<string, number>;
  disabled?: boolean;
  /** When true the field renders a "Mixed" placeholder (multi-select batch edit). */
  mixed?: boolean;
  id?: string;
}

/** Parse a committed string into a number, honouring math + aliases. null = invalid. */
export function parseField(raw: string, aliases: Record<string, number>): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const isPlain = /^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(trimmed);
  if (isPlain) {
    const n = Number.parseFloat(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  try {
    return evaluate(trimmed, aliases);
  } catch {
    return null;
  }
}

export function NumberField({
  label,
  value,
  onChange,
  step = 1,
  shiftStep = 10,
  altStep = 0.1,
  min = -Infinity,
  max = Infinity,
  unit,
  aliases = {},
  disabled = false,
  mixed = false,
  id,
}: NumberFieldProps) {
  const autoId = useId();
  const inputId = id ?? `nf-${autoId}`;
  const errorId = `${inputId}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dirty, setDirty] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrub = useRef<{ startX: number; startValue: number; active: boolean } | null>(null);

  const clamp = useCallback((v: number) => Math.min(max, Math.max(min, v)), [min, max]);

  const commit = useCallback(
    (raw: string) => {
      const parsed = parseField(raw, aliases);
      if (parsed === null) {
        setError('Not a valid number or expression');
        return false;
      }
      onChange(clamp(parsed));
      setError(null);
      setDirty(null);
      return true;
    },
    [aliases, clamp, onChange],
  );

  const displayed = mixed ? '—' : (dirty ?? String(value));
  const name = unit ? `${label} (${unit})` : label;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (dirty !== null) commit(dirty);
        return;
      }
      if (e.key === 'Escape' && dirty !== null) {
        e.preventDefault();
        setDirty(null);
        setError(null);
        return;
      }
      if (e.key === 'Home' && Number.isFinite(min)) {
        e.preventDefault();
        onChange(clamp(min));
        return;
      }
      if (e.key === 'End' && Number.isFinite(max)) {
        e.preventDefault();
        onChange(clamp(max));
        return;
      }
      const factor = e.shiftKey ? shiftStep : e.altKey ? altStep : step;
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        onChange(clamp(value + factor));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        onChange(clamp(value - factor));
      }
    },
    [altStep, clamp, commit, dirty, max, min, onChange, shiftStep, step, value],
  );

  // Drag-on-label scrubbing (Pointer Events — works on Wayland/X11/macOS/Windows).
  const handleLabelPointerDown = useCallback(
    (e: React.PointerEvent<HTMLLabelElement>) => {
      if (disabled || e.button !== 0) return;
      const startX = e.clientX;
      const startValue = value;
      let active = false;
      const onMove = (me: PointerEvent) => {
        const dx = me.clientX - startX;
        if (!active && Math.abs(dx) < 2) return;
        active = true;
        const f = me.shiftKey ? shiftStep / step : me.altKey ? altStep / step : 1;
        const next = clamp(Math.round((startValue + dx * step * f) * 100) / 100);
        onChange(next);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (!active) {
          // treat as a label click — focus & select the field
          inputRef.current?.focus();
          inputRef.current?.select();
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
      scrub.current = { startX, startValue, active: false };
    },
    [altStep, clamp, disabled, onChange, shiftStep, step, value],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLInputElement>) => {
      if (document.activeElement !== e.currentTarget) return;
      const dir = e.deltaY < 0 ? 1 : -1;
      onChange(clamp(value + dir * step));
    },
    [clamp, onChange, step, value],
  );

  const ariaNow = mixed ? undefined : Math.round(value * 100) / 100;
  const ariaText = unit ? `${value}${unit}` : String(value);

  return (
    <div className="insp-field">
      <label
        htmlFor={inputId}
        className={`insp-field__label${disabled ? ' insp-field__label--disabled' : ''}`}
        onPointerDown={disabled ? undefined : handleLabelPointerDown}
      >
        {name}
      </label>
      <div className="insp-field__control">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          inputMode="decimal"
          role="spinbutton"
          className={`insp-num__input${mixed ? ' insp-num__input--mixed' : ''}`}
          value={displayed}
          disabled={disabled}
          aria-label={name}
          aria-valuenow={ariaNow}
          aria-valuemin={Number.isFinite(min) ? min : undefined}
          aria-valuemax={Number.isFinite(max) ? max : undefined}
          aria-valuetext={mixed ? 'Mixed values' : ariaText}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => {
            setDirty(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKeyDown}
          onWheel={onWheel}
          onBlur={() => {
            if (dirty !== null) commit(dirty);
          }}
        />
        {error && (
          <div className="insp-num__error" id={errorId} role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
