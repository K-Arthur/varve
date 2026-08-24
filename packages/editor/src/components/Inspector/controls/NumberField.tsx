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
 * @varve/scene (`evaluate`). Supports `{alias}` references resolved against
 * the active variable mode. No `eval`, no mathjs — stays local-first/offline
 * (Strata plan §0.1, §8.0). Invalid input sets `aria-invalid` + an inline,
 * `aria-describedby` error and does NOT commit.
 */
import { evaluate } from '@varve/scene';
import { useCallback, useContext, useId, useRef, useState } from 'react';
import { EditorCtx } from '../../../context';

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
  /** Optional compact visual label while preserving the full accessible name. */
  displayLabel?: string;
  /** Resolved numeric variable aliases for `{name}` math expressions. */
  aliases?: Record<string, number>;
  disabled?: boolean;
  /** When true the field renders a "Mixed" placeholder (multi-select batch edit). */
  mixed?: boolean;
  id?: string;
  /** Field name for variable binding (e.g. "x", "y", "width", "height"). */
  fieldName?: string;
  /** Called when user shift+clicks the field to open binding menu. */
  onShiftClick?: () => void;
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
  displayLabel,
  aliases = {},
  disabled = false,
  mixed = false,
  id,
  fieldName,
  onShiftClick,
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

  // Access editor context for setBindingField
  const ctx = useContext(EditorCtx);

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
      if (e.key === '=' && fieldName && ctx) {
        e.preventDefault();
        ctx.setBindingField(fieldName);
        return;
      }
      const factor = e.shiftKey ? shiftStep : e.altKey ? altStep : step;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        // Coalesce rapid arrow repeats into a single undo step.
        // On first press (not repeat), begin a transaction. On repeat, keep
        // updating within the same transaction. On key up, commit.
        if (ctx) {
          if (!e.repeat) {
            ctx.beginTransaction();
          }
          const dir = e.key === 'ArrowUp' ? 1 : -1;
          onChange(clamp(value + dir * factor));
          // Commit on key up via a one-shot listener
          if (!e.repeat) {
            const onKeyUp = (ke: KeyboardEvent) => {
              if (ke.key === 'ArrowUp' || ke.key === 'ArrowDown') {
                ctx.commitTransaction();
                window.removeEventListener('keyup', onKeyUp);
              }
            };
            window.addEventListener('keyup', onKeyUp);
          }
        } else {
          const dir = e.key === 'ArrowUp' ? 1 : -1;
          onChange(clamp(value + dir * factor));
        }
      }
    },
    [altStep, clamp, commit, ctx, dirty, fieldName, max, min, onChange, shiftStep, step, value],
  );

  // Drag-on-label scrubbing (Pointer Events — works on Wayland/X11/macOS/Windows).
  // Transaction coalescing: begin on first move, commit on pointer up → single undo.
  const handleLabelPointerDown = useCallback(
    (e: React.PointerEvent<HTMLLabelElement>) => {
      if (disabled || e.button !== 0) return;
      if (e.shiftKey && onShiftClick) {
        e.preventDefault();
        onShiftClick();
        return;
      }
      const startX = e.clientX;
      const startValue = value;
      let active = false;
      let transactionOpen = false;
      const onMove = (me: PointerEvent) => {
        const dx = me.clientX - startX;
        if (!active && Math.abs(dx) < 2) return;
        if (!active) {
          active = true;
          // Begin transaction on first actual move — coalesces all scrub updates
          if (ctx) {
            ctx.beginTransaction();
            transactionOpen = true;
          }
        }
        const f = me.shiftKey ? shiftStep / step : me.altKey ? altStep / step : 1;
        const next = clamp(Math.round((startValue + dx * step * f) * 100) / 100);
        onChange(next);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        // Commit the scrub transaction — all intermediate values become one undo step
        if (transactionOpen && ctx) {
          ctx.commitTransaction();
        }
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
    [altStep, clamp, ctx, disabled, onChange, onShiftClick, shiftStep, step, value],
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
        {displayLabel ?? name}
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
          onFocus={() => fieldName && ctx?.setFocusedField(fieldName)}
          onBlur={() => {
            if (dirty !== null) commit(dirty);
            if (fieldName && ctx?.setFocusedField) ctx.setFocusedField(null);
          }}
          onWheel={onWheel}
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
