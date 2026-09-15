/**
 * NumberField — the Inspector's numeric spinbutton (Strata plan §2, §9).
 *
 * APG Spinbutton pattern (research basis: WAI-ARIA Authoring Practices 1.2,
 * "Spinbutton" design pattern, plus the 2026 APG Task Force decision in
 * w3c/aria-practices#3377 to stop hijacking Home/End in editable spinbuttons).
 * A real, associated <label> drives the accessible name (including the unit
 * suffix); the field is keyboard-operable (ArrowUp/Down, Shift x10, Alt x0.1,
 * PageUp/PageDown = at least 10 steps), wheel-to-change while focused, and
 * drag-on-label scrubbing (Pointer Events — cross-platform, Linux-first).
 * Home/End keep their native single-line editing behaviour (caret movement).
 *
 * Math: commits evaluate arithmetic expressions via the safe Pratt parser in
 * @varve/scene (`evaluate`). Supports `{alias}` references resolved against
 * the active variable mode. No `eval`, no mathjs — stays local-first/offline
 * (Strata plan §0.1, §8.0). Invalid input sets `aria-invalid` + an inline,
 * `aria-describedby` error and does NOT commit.
 */
import { evaluate } from '@varve/scene';
import { type Ref, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { EditorCtx } from '../../../context/types';
import { describePropertyState, type InspectorPropertyState } from '../propertyState';
import { TokenBindIndicator } from './TokenBindIndicator';

/** Pointer travel (CSS px) that turns a label press into a scrub, not a click. */
const SCRUB_ACTIVATION_PX = 2;
/** Idle gap that ends a wheel-to-change transaction (one undo step per gesture). */
const WHEEL_IDLE_COMMIT_MS = 200;
/** PageUp/PageDown step is at least this many base steps (APG spinbutton). */
const PAGE_STEP_MULTIPLIER = 10;

const isStepKey = (key: string) =>
  key === 'ArrowUp' || key === 'ArrowDown' || key === 'PageUp' || key === 'PageDown';

/**
 * Remove binary floating-point residue (270.40000000000003 → 270.4) without
 * imposing a decimal grid. Scrub and wheel edits must be able to land on fine
 * steps (0.001) and must not rewrite precision the document already holds.
 */
export function stripFloatResidue(value: number): number {
  if (!Number.isFinite(value)) return value;
  const next = Number(value.toPrecision(12));
  return Object.is(next, -0) ? 0 : next;
}

// One gesture may own the global cursor/user-select override; overlapping
// sessions (two pointers, two fields) restore the previous inline styles only
// when the last session ends.
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
  /** Optional display formatter; editing and stored values remain full precision. */
  formatValue?: (value: number) => string;
  /** Keep the associated label available to assistive technology but hide it visually. */
  hideLabel?: boolean;
  /** Resolved numeric variable aliases for `{name}` math expressions. */
  aliases?: Record<string, number>;
  disabled?: boolean;
  /** When true the field renders a "Mixed" placeholder (multi-select batch edit). */
  mixed?: boolean;
  /** Derived target identity; changing it cancels an uncommitted draft. */
  draftKey?: string;
  /** Rich property state used to explain inherited, bound, or unavailable values. */
  propertyState?: InspectorPropertyState<number>;
  /** Keep a resolved bound value inspectable without allowing a misleading literal edit. */
  readOnly?: boolean;
  /** Human-readable binding source shown beside a bound value. */
  bindingLabel?: string;
  /** Explicitly remove the binding so the user can resume literal editing. */
  onUnbind?: () => void;
  id?: string;
  /** Field name for variable binding (e.g. "x", "y", "width", "height"). */
  fieldName?: string;
  /** Called when user shift+clicks the field to open binding menu. */
  onShiftClick?: () => void;
  /** Optional ref for popovers anchored to the field's existing root element. */
  containerRef?: Ref<HTMLDivElement>;
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

/**
 * Resting display for a stored number: at most two decimals (more when the
 * field steps finer), trailing zeros trimmed, never "-0". Pointer and
 * arithmetic edits leave float residue (270.40000000000003) in the document;
 * that precision is kept in storage and only hidden here.
 */
export function formatRestingValue(value: number, step?: number): string {
  if (!Number.isFinite(value)) return String(value);
  const stepDecimals =
    step && Number.isFinite(step) && step > 0 ? Math.max(0, -Math.floor(Math.log10(step))) : 0;
  const decimals = Math.min(6, Math.max(2, stepDecimals));
  const rounded = Number(value.toFixed(decimals));
  return String(Object.is(rounded, -0) ? 0 : rounded);
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
  formatValue,
  hideLabel = false,
  aliases = {},
  disabled = false,
  mixed = false,
  draftKey,
  propertyState,
  readOnly = false,
  bindingLabel,
  onUnbind,
  id,
  fieldName,
  onShiftClick,
  containerRef,
}: NumberFieldProps) {
  const autoId = useId();
  const inputId = id ?? `nf-${autoId}`;
  const errorId = `${inputId}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dirty, setDirty] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrub = useRef<{
    pointerId: number;
    startX: number;
    /** Last value emitted by this gesture (the incremental accumulator). */
    current: number;
    /** Accumulator origin; rebased when a modifier changes mid-gesture. */
    base: number;
    baseX: number;
    /** Active step multiplier (1, shiftStep/step, altStep/step). */
    factor: number;
    active: boolean;
    transactionOpen: boolean;
    draftKey?: string;
    cleanup: () => void;
  } | null>(null);
  const arrowTransaction = useRef<{ draftKey?: string; cleanup: () => void } | null>(null);
  const wheelTransaction = useRef<{
    draftKey?: string;
    timer: number;
    cleanup: () => void;
  } | null>(null);
  const ctx = useContext(EditorCtx);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const wheelValueRef = useRef(value);
  wheelValueRef.current = value;

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

  const visualMixed =
    mixed || propertyState?.kind === 'mixed' || propertyState?.kind === 'partially-applicable';
  const isReadOnly = readOnly || propertyState?.kind === 'bound';
  const displayed = visualMixed
    ? 'Mixed'
    : (dirty ?? (formatValue ? formatValue(value) : formatRestingValue(value, step)));
  const name = unit ? `${label} (${unit})` : label;

  const finishArrowTransaction = useCallback((cancel: boolean) => {
    const session = arrowTransaction.current;
    if (!session) return;
    session.cleanup();
    arrowTransaction.current = null;
    const currentContext = ctxRef.current;
    if (!currentContext) return;
    if (cancel) currentContext.abortTransaction();
    else currentContext.commitTransaction();
  }, []);

  const finishWheelTransaction = useCallback((cancel: boolean) => {
    const session = wheelTransaction.current;
    if (!session) return;
    session.cleanup();
    wheelTransaction.current = null;
    const currentContext = ctxRef.current;
    if (!currentContext) return;
    if (cancel) currentContext.abortTransaction();
    else currentContext.commitTransaction();
  }, []);

  const finishScrub = useCallback((cancel: boolean) => {
    const session = scrub.current;
    if (!session) return;
    session.cleanup();
    scrub.current = null;
    releaseScrubStyles();
    const currentContext = ctxRef.current;
    if (session.transactionOpen && currentContext) {
      if (cancel) currentContext.abortTransaction();
      else currentContext.commitTransaction();
    }
    if (!cancel && !session.active) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    if (cancel) {
      setDirty(null);
      setError(null);
    }
  }, []);

  useEffect(
    () => () => {
      finishArrowTransaction(true);
      finishWheelTransaction(true);
      finishScrub(true);
    },
    [finishArrowTransaction, finishScrub, finishWheelTransaction],
  );

  const previousDraftKey = useRef(draftKey);
  useEffect(() => {
    if (previousDraftKey.current === draftKey) return;
    previousDraftKey.current = draftKey;
    finishArrowTransaction(true);
    finishWheelTransaction(true);
    finishScrub(true);
    setDirty(null);
    setError(null);
  }, [draftKey, finishArrowTransaction, finishScrub, finishWheelTransaction]);

  useEffect(() => {
    if (!isReadOnly) return;
    setDirty(null);
    setError(null);
    finishArrowTransaction(true);
    finishWheelTransaction(true);
    finishScrub(true);
  }, [finishArrowTransaction, finishScrub, finishWheelTransaction, isReadOnly]);

  /** Base for the next step: a valid in-progress draft, else the model value. */
  const stepBase = useCallback((): number | null => {
    if (dirty === null) return clamp(value);
    const parsed = parseField(dirty, aliases);
    return parsed === null ? null : clamp(parsed);
  }, [aliases, clamp, dirty, value]);

  /** Next value for a signed delta; null means the value would not change. */
  const stepFrom = useCallback(
    (delta: number): number | null => {
      const base = stepBase();
      if (base === null) return null;
      const next = clamp(stripFloatResidue(base + delta));
      return next === base ? null : next;
    },
    [clamp, stepBase],
  );

  const applySteppedValue = useCallback(
    (next: number) => {
      if (dirty !== null) {
        setDirty(null);
        setError(null);
      }
      onChange(next);
    },
    [dirty, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (isReadOnly) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        if (dirty !== null) commit(dirty);
        return;
      }
      if (
        e.key === 'Escape' &&
        (dirty !== null || arrowTransaction.current || wheelTransaction.current)
      ) {
        e.preventDefault();
        setDirty(null);
        setError(null);
        finishArrowTransaction(true);
        finishWheelTransaction(true);
        return;
      }
      if (e.key === '=' && fieldName && ctx) {
        e.preventDefault();
        ctx.setBindingField(fieldName);
        return;
      }
      // Home/End intentionally stay native: the APG spinbutton Task Force
      // removed the min/max guidance because it breaks single-line editing
      // (w3c/aria-practices#3377). PageUp/PageDown are the larger-step route.
      if (!isStepKey(e.key)) return;
      e.preventDefault();
      const magnitude =
        e.key === 'PageUp' || e.key === 'PageDown'
          ? Math.max(shiftStep, step * PAGE_STEP_MULTIPLIER)
          : e.shiftKey
            ? shiftStep
            : e.altKey
              ? altStep
              : step;
      const dir = e.key === 'ArrowUp' || e.key === 'PageUp' ? 1 : -1;
      const next = stepFrom(dir * magnitude);
      if (next === null) return;
      if (ctx && !e.repeat && !arrowTransaction.current) {
        // Coalesce rapid repeats into a single undo step: begin on first
        // press, commit on key up (or abort if the window loses focus).
        ctx.beginTransaction();
        const onKeyUp = (ke: KeyboardEvent) => {
          if (isStepKey(ke.key)) finishArrowTransaction(false);
        };
        const onWindowBlur = () => finishArrowTransaction(true);
        const cleanup = () => {
          window.removeEventListener('keyup', onKeyUp);
          window.removeEventListener('blur', onWindowBlur);
        };
        arrowTransaction.current = { draftKey, cleanup };
        window.addEventListener('keyup', onKeyUp);
        window.addEventListener('blur', onWindowBlur);
      }
      applySteppedValue(next);
    },
    [
      altStep,
      applySteppedValue,
      commit,
      ctx,
      dirty,
      draftKey,
      fieldName,
      finishArrowTransaction,
      finishWheelTransaction,
      isReadOnly,
      shiftStep,
      step,
      stepFrom,
    ],
  );

  // Drag-on-label scrubbing (Pointer Events — works on Wayland/X11/macOS/Windows).
  // Transaction coalescing: begin on first movement, commit on pointer up → one
  // undo step. Escape, pointercancel, window blur, or unmount cancels.
  const handleLabelPointerDown = useCallback(
    (e: React.PointerEvent<HTMLLabelElement>) => {
      if (disabled || isReadOnly || e.button !== 0) return;
      finishScrub(true);
      if (e.shiftKey && onShiftClick) {
        e.preventDefault();
        onShiftClick();
        return;
      }
      const label = e.currentTarget;
      const pointerId = e.pointerId;
      const startX = e.clientX;
      const denominator = step > 0 && Number.isFinite(step) ? step : 1;
      const factorFor = (ev: { shiftKey: boolean; altKey: boolean }) =>
        ev.shiftKey ? shiftStep / denominator : ev.altKey ? altStep / denominator : 1;

      // A drag-scrub must not steal focus into the text field: keeping the
      // user's focus context preserves global shortcuts (Ctrl+Z, Delete …).
      // A press without movement still focuses + selects via finishScrub.
      e.preventDefault();

      let active = false;
      let current = value;
      let base = value;
      let baseX = startX;
      let factor = factorFor(e);
      let lastClientX = startX;

      const rebaseForModifiers = (ev: { shiftKey: boolean; altKey: boolean }) => {
        const nextFactor = factorFor(ev);
        if (nextFactor === factor) return;
        // Modifier changed: keep everything accumulated so far and apply the
        // new factor only to travel after this point.
        base = current;
        baseX = lastClientX;
        factor = nextFactor;
      };

      const onMove = (me: PointerEvent) => {
        if (me.pointerId !== pointerId) return;
        lastClientX = me.clientX;
        if (!active && Math.abs(me.clientX - startX) < SCRUB_ACTIVATION_PX) return;
        const next = clamp(stripFloatResidue(base + (me.clientX - baseX) * denominator * factor));
        if (next === current) return;
        if (!active) {
          active = true;
          if (scrub.current) scrub.current.active = true;
          if (ctx) {
            ctx.beginTransaction();
            if (scrub.current) scrub.current.transactionOpen = true;
          }
        }
        current = next;
        onChange(next);
      };
      const onUp = () => finishScrub(false);
      const onCancel = () => finishScrub(true);
      const onWindowBlur = () => finishScrub(true);
      const onScrubKey = (ke: KeyboardEvent) => {
        if (ke.key === 'Escape') {
          ke.preventDefault();
          finishScrub(true);
          return;
        }
        if (ke.key === 'Shift' || ke.key === 'Alt') rebaseForModifiers(ke);
      };
      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('blur', onWindowBlur);
        window.removeEventListener('keydown', onScrubKey, true);
        window.removeEventListener('keyup', onScrubKey, true);
        try {
          if (typeof label.releasePointerCapture === 'function') {
            label.releasePointerCapture(pointerId);
          }
        } catch {
          // Capture may already be released (pointerup/pointercancel already ran).
        }
      };
      scrub.current = {
        pointerId,
        startX,
        current,
        base,
        baseX,
        factor,
        active: false,
        transactionOpen: false,
        draftKey,
        cleanup,
      };
      try {
        // Keep the pointer stream alive over the label. Window listeners remain
        // the source of truth, so a host that refuses capture still works.
        if (typeof label.setPointerCapture === 'function') label.setPointerCapture(pointerId);
      } catch {
        // Pointer capture is an enhancement, not a requirement.
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('blur', onWindowBlur);
      window.addEventListener('keydown', onScrubKey, true);
      window.addEventListener('keyup', onScrubKey, true);
      acquireScrubStyles();
    },
    [
      altStep,
      clamp,
      ctx,
      disabled,
      draftKey,
      finishScrub,
      isReadOnly,
      onChange,
      onShiftClick,
      shiftStep,
      step,
      value,
    ],
  );

  // Wheel-to-change is a focused-field convention (never hover; see the
  // 2026-09-14 research record). React attaches `wheel` passively at the root,
  // so preventDefault inside React's onWheel is a no-op — the panel scrolls,
  // the field slides out from under the pointer, and the gesture can change a
  // different field. Attach a native non-passive listener instead.
  const wheelHandlerRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelHandlerRef.current = (e: WheelEvent) => {
    if (isReadOnly || e.deltaY === 0) return;
    const el = inputRef.current;
    if (!el || document.activeElement !== el) return;
    const session = wheelTransaction.current;
    const base = session ? wheelValueRef.current : stepBase();
    if (base === null) return;
    const dir = e.deltaY < 0 ? 1 : -1;
    const next = clamp(stripFloatResidue(base + dir * step));
    // At a bound, leave the wheel to scroll the panel rather than trapping it.
    if (next === base) return;
    e.preventDefault();
    if (ctx) {
      if (!session || session.draftKey !== draftKey) {
        finishWheelTransaction(true);
        ctx.beginTransaction();
        const cleanup = () => window.clearTimeout(wheelTransaction.current?.timer);
        wheelTransaction.current = { draftKey, timer: 0, cleanup };
      } else {
        window.clearTimeout(session.timer);
      }
      const currentSession = wheelTransaction.current;
      if (currentSession) {
        currentSession.timer = window.setTimeout(
          () => finishWheelTransaction(false),
          WHEEL_IDLE_COMMIT_MS,
        );
      }
    }
    wheelValueRef.current = next;
    if (dirty !== null) {
      setDirty(null);
      setError(null);
    }
    onChange(next);
  };

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const listener = (event: WheelEvent) => wheelHandlerRef.current(event);
    el.addEventListener('wheel', listener, { passive: false });
    return () => el.removeEventListener('wheel', listener);
  }, []);

  const ariaNow = visualMixed ? undefined : Math.round(value * 100) / 100;
  const stateText = propertyState ? describePropertyState(propertyState) : undefined;
  const showStateText = Boolean(
    stateText && !['mixed', 'partially-applicable', 'bound'].includes(propertyState?.kind ?? ''),
  );
  const stateId = `${inputId}-state`;
  const describedBy = [error ? errorId : null, showStateText ? stateId : null]
    .filter((item): item is string => Boolean(item))
    .join(' ');
  const ariaText =
    stateText ?? (visualMixed ? 'Mixed values' : unit ? `${value}${unit}` : String(value));

  return (
    <div
      ref={containerRef}
      className={hideLabel ? 'insp-field insp-field--label-hidden' : 'insp-field'}
    >
      <label
        htmlFor={inputId}
        className={
          hideLabel
            ? 'varve-visually-hidden'
            : `insp-field__label${disabled ? ' insp-field__label--disabled' : ''}${isReadOnly ? ' insp-field__label--readonly' : ''}`
        }
        onPointerDown={disabled || hideLabel ? undefined : handleLabelPointerDown}
      >
        {displayLabel ?? name}
      </label>
      <div className="insp-field__control insp-num__control">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          inputMode="decimal"
          role="spinbutton"
          className={`insp-num__input${visualMixed ? ' insp-num__input--mixed' : ''}${isReadOnly ? ' insp-num__input--readonly' : ''}`}
          value={displayed}
          disabled={disabled}
          readOnly={isReadOnly}
          aria-label={name}
          aria-valuenow={ariaNow}
          aria-valuemin={Number.isFinite(min) ? min : undefined}
          aria-valuemax={Number.isFinite(max) ? max : undefined}
          aria-valuetext={ariaText}
          aria-invalid={error ? 'true' : 'false'}
          aria-readonly={isReadOnly ? 'true' : undefined}
          aria-describedby={describedBy || undefined}
          onChange={(e) => {
            if (isReadOnly) return;
            const next = e.target.value;
            setDirty(next === 'Mixed' || next === '—' ? '' : next);
            if (error) setError(null);
          }}
          onKeyDown={handleKeyDown}
          onFocus={(e) => {
            // Click-to-type replaces the value (design-tool convention); a
            // second click places the caret for partial edits.
            e.currentTarget.select();
            if (fieldName) ctx?.setFocusedField(fieldName);
          }}
          onBlur={() => {
            if (dirty !== null) commit(dirty);
            finishWheelTransaction(false);
            if (fieldName && ctx?.setFocusedField) ctx.setFocusedField(null);
          }}
        />
        {/* With the label hidden, the unit would otherwise be invisible; the
            accessible name already carries it. */}
        {hideLabel && unit && (
          <span className="insp-num__unit" aria-hidden="true">
            {unit}
          </span>
        )}
        {bindingLabel && onUnbind && (
          <TokenBindIndicator variableName={bindingLabel} onUnbind={onUnbind} />
        )}
        {showStateText && (
          <div
            id={stateId}
            className={`insp-num__state${propertyState?.kind === 'error' ? ' insp-num__state--error' : ''}`}
            role={propertyState?.kind === 'error' ? 'alert' : 'status'}
          >
            {stateText}
          </div>
        )}
        {error && (
          <div className="insp-num__error" id={errorId} role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
