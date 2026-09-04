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
import { type Ref, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { EditorCtx } from '../../../context/types';
import { describePropertyState, type InspectorPropertyState } from '../propertyState';
import { TokenBindIndicator } from './TokenBindIndicator';

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
    startX: number;
    startValue: number;
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
  const displayed = visualMixed ? 'Mixed' : (dirty ?? String(value));
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
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
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
          if (!e.repeat && !arrowTransaction.current) {
            ctx.beginTransaction();
            const onKeyUp = (ke: KeyboardEvent) => {
              if (ke.key === 'ArrowUp' || ke.key === 'ArrowDown') {
                finishArrowTransaction(false);
              }
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
          const dir = e.key === 'ArrowUp' ? 1 : -1;
          onChange(clamp(value + dir * factor));
        } else {
          const dir = e.key === 'ArrowUp' ? 1 : -1;
          onChange(clamp(value + dir * factor));
        }
      }
    },
    [
      altStep,
      clamp,
      commit,
      ctx,
      dirty,
      draftKey,
      fieldName,
      finishArrowTransaction,
      finishWheelTransaction,
      max,
      min,
      onChange,
      isReadOnly,
      shiftStep,
      step,
      value,
    ],
  );

  // Drag-on-label scrubbing (Pointer Events — works on Wayland/X11/macOS/Windows).
  // Transaction coalescing: begin on first move, commit on pointer up → single undo.
  const handleLabelPointerDown = useCallback(
    (e: React.PointerEvent<HTMLLabelElement>) => {
      if (disabled || isReadOnly || e.button !== 0) return;
      finishScrub(true);
      if (e.shiftKey && onShiftClick) {
        e.preventDefault();
        onShiftClick();
        return;
      }
      const startX = e.clientX;
      const startValue = value;
      let active = false;
      const onMove = (me: PointerEvent) => {
        const dx = me.clientX - startX;
        if (!active && Math.abs(dx) < 2) return;
        if (!active) {
          active = true;
          if (scrub.current) scrub.current.active = true;
          // Begin transaction on first actual move — coalesces all scrub updates
          if (ctx) {
            ctx.beginTransaction();
            if (scrub.current) {
              scrub.current.transactionOpen = true;
            }
          }
        }
        const f = me.shiftKey ? shiftStep / step : me.altKey ? altStep / step : 1;
        const next = clamp(Math.round((startValue + dx * step * f) * 100) / 100);
        onChange(next);
      };
      const onUp = () => finishScrub(false);
      const onCancel = () => finishScrub(true);
      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('blur', onWindowBlur);
      };
      const onWindowBlur = () => finishScrub(true);
      scrub.current = {
        startX,
        startValue,
        active: false,
        transactionOpen: false,
        draftKey,
        cleanup,
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('blur', onWindowBlur);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    },
    [
      altStep,
      clamp,
      ctx,
      disabled,
      draftKey,
      finishScrub,
      onChange,
      onShiftClick,
      isReadOnly,
      shiftStep,
      step,
    ],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLInputElement>) => {
      if (isReadOnly || document.activeElement !== e.currentTarget || e.deltaY === 0) return;
      e.preventDefault();
      if (ctx) {
        const session = wheelTransaction.current;
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
          currentSession.timer = window.setTimeout(() => finishWheelTransaction(false), 200);
        }
      }
      const dir = e.deltaY < 0 ? 1 : -1;
      const next = clamp(wheelValueRef.current + dir * step);
      wheelValueRef.current = next;
      onChange(next);
    },
    [clamp, ctx, draftKey, finishWheelTransaction, isReadOnly, onChange, step],
  );

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
    <div ref={containerRef} className="insp-field">
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
            if (visualMixed) e.currentTarget.select();
            if (fieldName) ctx?.setFocusedField(fieldName);
          }}
          onBlur={() => {
            if (dirty !== null) commit(dirty);
            finishWheelTransaction(false);
            if (fieldName && ctx?.setFocusedField) ctx.setFocusedField(null);
          }}
          onWheel={onWheel}
        />
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
