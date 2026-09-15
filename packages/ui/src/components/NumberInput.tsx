/**
 * NumberInput — compact numeric field for dialogs, settings, and the align bar.
 *
 * Drag-to-scrub lives on the field itself (the `ew-resize` cursor advertises
 * it), so the whole gesture is Pointer Events driven and shares one path for
 * mouse, pen, and touch:
 *
 * - modifier changes mid-drag rebase the accumulator instead of rescaling
 *   travel that already happened;
 * - values are never quantized to a decimal grid (`toPrecision(12)` only
 *   removes binary residue);
 * - a gesture that cannot change the value emits nothing;
 * - Escape, `pointercancel`, window blur, and unmount end the gesture, release
 *   pointer capture, and restore the global cursor/user-select override.
 *
 * These fields edit dialog and settings values, not document nodes, so there
 * is no undo transaction here; the long-lived document spinbutton is
 * `@varve/editor`'s NumberField.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

/** Pointer travel (CSS px) that turns a press into a scrub, not a click. */
const SCRUB_ACTIVATION_PX = 2;

/**
 * Remove binary floating-point residue (270.40000000000003 → 270.4) without
 * imposing a decimal grid, so fine steps survive a drag.
 */
export function stripFloatResidue(value: number): number {
  if (!Number.isFinite(value)) return value;
  const next = Number(value.toPrecision(12));
  return Object.is(next, -0) ? 0 : next;
}

// Overlapping gestures (two pointers on two fields) restore the previous
// inline styles only when the last one ends.
let activeScrubSessions = 0;
let savedBodyCursor = '';
let savedBodyUserSelect = '';

function acquireScrubStyles() {
  if (activeScrubSessions === 0) {
    savedBodyCursor = document.body.style.cursor;
    savedBodyUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }
  activeScrubSessions += 1;
}

function releaseScrubStyles() {
  activeScrubSessions = Math.max(0, activeScrubSessions - 1);
  if (activeScrubSessions === 0) {
    document.body.style.cursor = savedBodyCursor;
    document.body.style.userSelect = savedBodyUserSelect;
  }
}

export interface NumberInputProps {
  value: number;
  step?: number;
  shiftStep?: number;
  altStep?: number;
  min?: number;
  max?: number;
  /** Accessible name. When omitted, an external <label htmlFor> must provide the name. */
  label?: string;
  onChange: (value: number) => void;
  id?: string;
}

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  {
    value,
    step = 1,
    shiftStep = 10,
    altStep = 0.1,
    min = -99999,
    max = 99999,
    label,
    onChange,
    id,
  },
  ref,
) {
  const [dirty, setDirty] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inputRef.current!, []);
  const dragRef = useRef<{
    pointerId: number;
    scrubbing: boolean;
    /** Value at press; restored when the gesture is cancelled. */
    startValue: number;
    cleanup: () => void;
  } | null>(null);

  const clamp = useCallback((v: number) => Math.min(max, Math.max(min, v)), [min, max]);

  const commitValue = useCallback(
    (raw: string) => {
      const parsed = Number.parseFloat(raw);
      if (!Number.isNaN(parsed)) {
        const next = clamp(parsed);
        if (next !== value) onChange(next);
      }
      setDirty(null);
    },
    [clamp, onChange, value],
  );

  const finishScrub = useCallback(
    (cancel: boolean) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      drag.cleanup();
      releaseScrubStyles();
      if (cancel) {
        // These fields have no undo stack; cancelling restores the value the
        // gesture started from.
        if (drag.scrubbing && drag.startValue !== undefined) onChange(drag.startValue);
        return;
      }
      if (!drag.scrubbing) {
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    },
    [onChange],
  );

  useEffect(() => () => finishScrub(true), [finishScrub]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLInputElement>) => {
      if (e.button !== 0 || dragRef.current) return;
      const target = e.currentTarget;
      const pointerId = e.pointerId;
      const startX = e.clientX;
      const denominator = step > 0 && Number.isFinite(step) ? step : 1;
      const factorFor = (ev: { shiftKey: boolean; altKey: boolean }) =>
        ev.shiftKey ? shiftStep / denominator : ev.altKey ? altStep / denominator : 1;

      let scrubbing = false;
      let current = value;
      let base = value;
      let baseX = startX;
      let factor = factorFor(e);

      // Mouse/pen: keep the drag from starting a text selection; a press
      // without movement still focuses + selects in finishScrub. Touch keeps
      // the native tap-to-focus (and on-screen keyboard) behaviour.
      if (e.pointerType !== 'touch') e.preventDefault();

      const onMove = (me: PointerEvent) => {
        if (me.pointerId !== pointerId) return;
        const nextFactor = factorFor(me);
        if (nextFactor !== factor) {
          base = current;
          baseX = me.clientX;
          factor = nextFactor;
        }
        if (!scrubbing && Math.abs(me.clientX - startX) < SCRUB_ACTIVATION_PX) return;
        const next = clamp(stripFloatResidue(base + (me.clientX - baseX) * denominator * factor));
        if (next === current) return;
        if (!scrubbing) {
          scrubbing = true;
          if (dragRef.current) dragRef.current.scrubbing = true;
        }
        current = next;
        onChange(next);
      };
      const onUp = () => finishScrub(false);
      const onCancel = () => finishScrub(true);
      const onWindowBlur = () => finishScrub(true);
      const onKeyDown = (ke: KeyboardEvent) => {
        if (ke.key !== 'Escape') return;
        ke.preventDefault();
        finishScrub(true);
      };
      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('blur', onWindowBlur);
        window.removeEventListener('keydown', onKeyDown, true);
        try {
          if (typeof target.releasePointerCapture === 'function') {
            target.releasePointerCapture(pointerId);
          }
        } catch {
          // Capture may already be released (pointerup/pointercancel ran).
        }
      };
      dragRef.current = { pointerId, scrubbing: false, startValue: value, cleanup };
      try {
        if (typeof target.setPointerCapture === 'function') target.setPointerCapture(pointerId);
      } catch {
        // Pointer capture is an enhancement; window listeners still work.
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('blur', onWindowBlur);
      window.addEventListener('keydown', onKeyDown, true);
      acquireScrubStyles();
    },
    [altStep, clamp, finishScrub, onChange, shiftStep, step, value],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const factor = e.shiftKey ? shiftStep : e.altKey ? altStep : step;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = clamp(stripFloatResidue(value + (e.key === 'ArrowUp' ? factor : -factor)));
        if (next !== value) onChange(next);
      } else if (e.key === 'Enter' && dirty !== null) {
        e.preventDefault();
        commitValue(dirty);
      }
    },
    [altStep, clamp, commitValue, dirty, onChange, shiftStep, step, value],
  );

  return (
    <input
      ref={inputRef}
      id={id}
      type="text"
      inputMode="decimal"
      className="varve-number-input"
      value={dirty ?? String(value)}
      onChange={(e) => setDirty(e.target.value)}
      onPointerDown={handlePointerDown}
      onBlur={() => {
        if (dirty !== null) commitValue(dirty);
      }}
      onKeyDown={handleKeyDown}
      aria-label={label}
    />
  );
});
