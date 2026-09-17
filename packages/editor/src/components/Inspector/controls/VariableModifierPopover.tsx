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
import {
  FloatingPortal,
  FocusTrap,
  Icon,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@varve/ui';
import { useMemo, useState } from 'react';

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

  const displayValue = value * 100;

  const sliderMin = operation === 'multiply' ? 0 : operation === 'set' ? 0 : -100;
  const sliderMax = operation === 'multiply' ? 200 : operation === 'set' ? 100 : 100;

  const commit = (mods: AlphaModifier[] | undefined): void => {
    onCommit(mods);
    onClose();
  };

  const currentModifiers = modifiers.filter((m) => m.kind === 'alpha');

  return (
    <FloatingPortal
      anchorRef={anchorRef}
      open
      placement="bottom-start"
      fallbackPlacements={['top-start', 'bottom-end', 'top-end']}
      maxHeight={360}
      kind="popover"
      dismissOnEscape
      onClose={() => onClose()}
      className="varve-modifier-popover"
    >
      <FocusTrap active onClose={onClose}>
        <div role="dialog" aria-label="Alpha modifier" className="varve-modifier-popover__panel">
          <div className="varve-modifier-popover__header">
            <strong className="varve-modifier-popover__title">Alpha modifier</strong>
            <button type="button" className="insp-inline-btn" aria-label="Close" onClick={onClose}>
              <Icon name="X" label={undefined} size="0.9em" />
            </button>
          </div>

          <fieldset className="varve-modifier-popover__ops">
            <legend className="varve-visually-hidden">Operation</legend>
            {OPERATIONS.map((op) => (
              <button
                key={op.value}
                type="button"
                className="insp-inline-btn varve-modifier-popover__op-btn"
                aria-pressed={operation === op.value}
                onClick={() => setOperation(op.value)}
              >
                {op.label}
              </button>
            ))}
          </fieldset>

          <label className="varve-modifier-popover__value-label">
            {operation === 'multiply'
              ? 'Factor (%)'
              : operation === 'set'
                ? 'Alpha (%)'
                : 'Delta (percentage points)'}
            <div className="varve-modifier-popover__value-row">
              <input
                type="range"
                aria-label="Modifier value"
                min={sliderMin}
                max={sliderMax}
                step={1}
                value={displayValue}
                onChange={(e) => setValue(Number(e.target.value) / 100)}
                className="varve-modifier-popover__slider"
              />
              <InputGroup className="varve-modifier-popover__value-group">
                <InputGroupInput
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
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>%</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            </div>
          </label>

          <div className="varve-modifier-popover__summary">
            <span>
              Token alpha: <strong>{Math.round(tokenAlpha * 100)}%</strong>
            </span>
            <span>
              Effective alpha: <strong>{Math.round(effectiveAlpha * 100)}%</strong>
            </span>
            {operation === 'multiply' && (
              <span className="insp-empty-message varve-modifier-popover__hint">
                Relative: follows the variable when its alpha changes
              </span>
            )}
          </div>

          <div className="varve-modifier-popover__actions">
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
            <span className="varve-modifier-popover__current">
              Current: {currentModifiers.map((m) => alphaModifierLabel(m)).join(', ')}
            </span>
          )}
        </div>
      </FocusTrap>
    </FloatingPortal>
  );
}
