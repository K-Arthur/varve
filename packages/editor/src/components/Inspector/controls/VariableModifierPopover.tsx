/**
 * VariableModifierPopover — edit the typed alpha modifier stack on a color
 * variable binding (ADR-0016 D5, §16).
 *
 * Operation semantics are explicit and unambiguous:
 * - Multiply: effective = tokenAlpha × factor (relative opacity)
 * - Set:      effective = absolute alpha (RGB stays linked)
 * - Offset:   effective = clamp(tokenAlpha + delta, 0, 1)
 *
 * Keyboard accessible: operation buttons, numeric field, and slider; Escape
 * closes without committing; Reset removes the modifier while preserving the
 * variable binding.
 */

import type { AlphaModifier, AlphaModifierOperation, ManagedColor } from '@varve/scene';
import { alphaModifierLabel, normalizedAlpha } from '@varve/scene';
import { Icon } from '@varve/ui';
import { useEffect, useMemo, useState } from 'react';

interface Props {
  /** Token color (pre-modifier, resolved). */
  tokenColor: ManagedColor;
  /** Current modifier stack (alpha modifier shown first). */
  modifiers: AlphaModifier[];
  onCommit: (modifiers: AlphaModifier[] | undefined) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

const OPERATIONS: { value: AlphaModifierOperation; label: string }[] = [
  { value: 'multiply', label: 'Multiply' },
  { value: 'set', label: 'Set' },
  { value: 'offset', label: 'Offset' },
];

export function VariableModifierPopover({
  tokenColor,
  modifiers,
  onCommit,
  onClose,
  anchorRef,
}: Props) {
  const [operation, setOperation] = useState<AlphaModifierOperation>(
    modifiers[0]?.operation ?? 'multiply',
  );
  const [value, setValue] = useState<number>(() => {
    const m = modifiers[0];
    if (!m) return 0.5;
    // Preserve the stored modifier value so reopening the popover shows
    // the actual applied value, not a fresh default.
    return m.operation === 'offset' ? m.value : m.value;
  });

  const anchor = anchorRef.current;
  const rect = anchor?.getBoundingClientRect();

  // Position below the anchor, clamped to the viewport. When there is not
  // enough room below (the anchor badge sits at the bottom of a scrolled
  // inspector), flip above the anchor instead so the popover never renders
  // off-screen.
  const POPOVER_W = 300;
  const POPOVER_H_EST = 300;
  const left = rect
    ? Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - POPOVER_W - 8))
    : 8;
  const spaceBelow = rect ? window.innerHeight - rect.bottom - 6 : 0;
  const top =
    rect && spaceBelow < POPOVER_H_EST
      ? Math.max(8, rect.top - POPOVER_H_EST - 6)
      : rect
        ? rect.bottom + 6
        : 8;

  const tokenAlpha = normalizedAlpha(tokenColor);
  const effectiveAlpha = useMemo(() => {
    let a = tokenAlpha;
    switch (operation) {
      case 'multiply':
        a = a * value;
        break;
      case 'set':
        a = value;
        break;
      case 'offset':
        a = a + value;
        break;
    }
    return Math.min(1, Math.max(0, a));
  }, [tokenAlpha, operation, value]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const displayValue = value * 100;

  const sliderMin = operation === 'multiply' ? 0 : operation === 'set' ? 0 : -100;
  const sliderMax = operation === 'multiply' ? 200 : operation === 'set' ? 100 : 100;

  const commit = (mods: AlphaModifier[] | undefined): void => {
    onCommit(mods);
    onClose();
  };

  const currentModifiers = modifiers.filter((m) => m.kind === 'alpha');

  return (
    <div
      className="varve-modifier-popover"
      role="dialog"
      aria-label="Alpha modifier"
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 1000,
        minWidth: 240,
        maxWidth: POPOVER_W,
        background: 'var(--color-surface-raised, #fff)',
        border: '1px solid var(--color-border-strong, #cdd3de)',
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,0.16)',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div className="insp-field-row__split" style={{ justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 12 }}>Alpha modifier</strong>
        <button type="button" className="insp-inline-btn" aria-label="Close" onClick={onClose}>
          <Icon name="X" label={undefined} size="0.9em" />
        </button>
      </div>

      <fieldset
        style={{ display: 'flex', gap: 4, margin: 0, padding: 0, border: 'none', minInlineSize: 0 }}
      >
        <legend className="varve-visually-hidden">Operation</legend>
        {OPERATIONS.map((op) => (
          <button
            key={op.value}
            type="button"
            className="insp-inline-btn"
            aria-pressed={operation === op.value}
            style={{
              fontWeight: operation === op.value ? 700 : 400,
              borderBottom:
                operation === op.value
                  ? '2px solid var(--color-accent-primary, #39d0c6)'
                  : '2px solid transparent',
            }}
            onClick={() => setOperation(op.value)}
          >
            {op.label}
          </button>
        ))}
      </fieldset>

      <label style={{ fontSize: 12 }}>
        {operation === 'multiply'
          ? 'Factor (%)'
          : operation === 'set'
            ? 'Alpha (%)'
            : 'Delta (percentage points)'}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="range"
            aria-label="Modifier value"
            min={sliderMin}
            max={sliderMax}
            step={1}
            value={displayValue}
            onChange={(e) => setValue(Number(e.target.value) / 100)}
            style={{ flex: 1 }}
          />
          <input
            type="number"
            aria-label="Modifier value"
            min={sliderMin}
            max={sliderMax}
            step={1}
            value={Math.round(displayValue * 10) / 10}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setValue(n / 100);
            }}
            style={{ width: 64 }}
          />
        </div>
      </label>

      <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span>
          Token alpha: <strong>{Math.round(tokenAlpha * 100)}%</strong>
        </span>
        <span>
          Effective alpha: <strong>{Math.round(effectiveAlpha * 100)}%</strong>
        </span>
        {operation === 'multiply' && (
          <span className="insp-empty-message" style={{ fontSize: 11 }}>
            Relative: follows the variable when its alpha changes
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="insp-inline-btn"
          disabled={currentModifiers.length === 0}
          onClick={() => commit(undefined)}
        >
          Reset
        </button>
        <button
          type="button"
          className="insp-add-btn"
          onClick={() =>
            commit([
              {
                kind: 'alpha',
                operation,
                value,
              },
            ])
          }
        >
          Apply
        </button>
      </div>
      {currentModifiers.length > 0 && (
        <span style={{ fontSize: 11 }}>
          Current: {currentModifiers.map((m) => alphaModifierLabel(m)).join(', ')}
        </span>
      )}
    </div>
  );
}
