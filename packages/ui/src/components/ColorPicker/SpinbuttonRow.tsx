import { useCallback, useEffect, useId, useRef, useState } from 'react';

export interface SpinbuttonRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  unit?: string;
  /** Keyboard step (ArrowUp/Down). Default 1. */
  step?: number;
  /** Displayed decimal places. Default 0 (integers). */
  decimals?: number;
  /** Allow negative values (Lab a/b). */
  signed?: boolean;
  /** Wrap at min/max (hue). */
  wrap?: boolean;
}

export function SpinbuttonRow({
  label,
  value,
  min,
  max,
  onChange,
  unit,
  step = 1,
  decimals = 0,
  signed = false,
  wrap = false,
}: SpinbuttonRowProps) {
  const inputId = useId();
  const clamp = useCallback((v: number) => Math.max(min, Math.min(max, v)), [min, max]);
  const wrapValue = useCallback(
    (v: number) => {
      if (!wrap) return clamp(v);
      // Hue-style wrap: 360 -> 0, -1 -> 359 (modulo range).
      const range = max - min;
      if (range <= 0) return min;
      return ((((v - min) % range) + range) % range) + min;
    },
    [clamp, min, max, wrap],
  );

  const format = useCallback(
    (next: number) => (Number.isFinite(next) ? next.toFixed(decimals) : String(next)),
    [decimals],
  );
  const [draft, setDraft] = useState(() => format(value));
  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) setDraft(format(value));
  }, [format, value]);

  const commitDraft = useCallback(() => {
    const raw = draft.trim();
    const pattern = signed ? /^-?(?:\d+(?:\.\d*)?|\.\d+)$/ : /^(?:\d+(?:\.\d*)?|\.\d+)$/;
    if (!pattern.test(raw)) {
      setDraft(format(value));
      editingRef.current = false;
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      setDraft(format(value));
      editingRef.current = false;
      return;
    }
    onChange(wrapValue(parsed));
    editingRef.current = false;
    setDraft(format(wrapValue(parsed)));
  }, [draft, format, onChange, signed, value, wrapValue]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const delta = e.shiftKey ? step * 10 : step;
    let newValue = value;
    switch (e.key) {
      case 'ArrowUp':
        newValue = wrapValue(value + delta);
        break;
      case 'ArrowDown':
        newValue = wrapValue(value - delta);
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
    editingRef.current = false;
    setDraft(format(newValue));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.trim();
    const pattern = signed ? /^-?\d*\.?\d*$/ : /^\d*\.?\d*$/;
    if (!pattern.test(raw)) return;
    editingRef.current = true;
    setDraft(raw);
    // Preserve the existing immediate-update contract for complete values,
    // while allowing empty, signed, and decimal intermediate drafts.
    if (raw === '' || raw === '-' || raw === '.') return;
    const parsed = Number(raw);
    if (!Number.isNaN(parsed)) onChange(wrapValue(parsed));
  };

  const handleBlur = () => commitDraft();

  const handleKeyDownWithCommit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitDraft();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      editingRef.current = false;
      setDraft(format(value));
      return;
    }
    handleKeyDown(e);
  };

  const display = draft;

  const valueText = unit ? `${display}${unit}` : display;

  return (
    <div className="insp-field">
      <label className="insp-field__label" htmlFor={inputId}>
        {label}
      </label>
      <div className="insp-field__control">
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          role="spinbutton"
          className="insp-num__input color-fields__input-full"
          value={display}
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuetext={valueText}
          aria-label={label}
          onChange={handleChange}
          onKeyDown={handleKeyDownWithCommit}
          onBlur={handleBlur}
        />
      </div>
    </div>
  );
}
