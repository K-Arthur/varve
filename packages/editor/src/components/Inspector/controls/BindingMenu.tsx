/**
 * BindingMenu — portaled combobox for selecting a variable to bind to a property.
 *
 * Shows available variables filtered by type, with a search input.
 * Supports entering a math expression to transform the resolved value.
 *
 * Watches the editor context's `bindingField` — when it matches `targetField`,
 * the menu auto-opens (entry point for keyboard shortcut and shift+click).
 *
 * Research basis: Figma variable binding dropdown; APG Combobox + Listbox.
 */
import { resolve, type VariableStore, type VariableValue } from '@varve/scene';
import { tokenForVariableId } from '@varve/scene/tokens';
import { FloatingPortal } from '@varve/ui';
import { useCallback, useContext, useEffect, useId, useMemo, useState } from 'react';
import { EditorCtx } from '../../../context/types';
import { tokenBindingCompatibilityReason } from '../../../tokenSync/bindingCompatibility';
import { formatVariableValue } from '../../../variableValueFormat';
import './BindingMenu.css';

interface BindingMenuProps {
  variableStore: VariableStore;
  onBind: (variableId: string, expression?: string) => void;
  onClose: () => void;
  targetType?: 'color' | 'number' | 'string' | 'boolean';
  triggerRef: React.RefObject<HTMLElement | null>;
  /**
   * Optional field name to watch from context bindingField.
   * When set and context's bindingField matches, the menu opens automatically.
   */
  targetField?: string;
}

function formatValue(v: VariableValue): string {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `rgba(${v.join(',')})`;
  if (typeof v === 'string') return v;
  return formatVariableValue(v);
}

export function BindingMenu({
  variableStore,
  onBind,
  onClose,
  targetType,
  triggerRef,
  targetField,
}: BindingMenuProps) {
  const [query, setQuery] = useState('');
  const [expression, setExpression] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const listboxId = useId();
  const comboboxId = useId();

  const variables = useMemo(
    () =>
      Object.values(variableStore.variables).filter((v) => {
        if (targetType && v.type !== targetType) return false;
        if (query && !v.name.toLowerCase().includes(query.toLowerCase())) return false;
        return true;
      }),
    [variableStore.variables, targetType, query],
  );

  const ctx = useContext(EditorCtx);
  const property = targetField ?? ctx?.bindingField;
  const tokenValues = useMemo(() => {
    const values = new Map<string, { display: string; error?: string }>();
    for (const variable of variables) {
      const token = tokenForVariableId(variableStore, variable.id);
      if (!token) continue;
      const incompatible = property
        ? tokenBindingCompatibilityReason(token.type, property)
        : undefined;
      if (incompatible) {
        values.set(variable.id, { display: incompatible, error: incompatible });
        continue;
      }
      try {
        values.set(variable.id, { display: formatValue(resolve(variableStore, variable.id)) });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No compatible property mapping.';
        values.set(variable.id, { display: message, error: message });
      }
    }
    return values;
  }, [variableStore, variables, property]);

  useEffect(() => {
    if (targetField && ctx?.bindingField && ctx.bindingField !== targetField) {
      onClose();
    }
  }, [ctx, targetField, onClose]);

  const handleSelect = useCallback(
    (varId: string) => {
      if (tokenValues.get(varId)?.error) return;
      onBind(varId, expression || undefined);
      onClose();
    },
    [onBind, onClose, expression, tokenValues],
  );

  const highlightedId = variables.length > 0 ? `${listboxId}-option-${selectedIdx}` : undefined;

  const handleListKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, variables.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && variables[selectedIdx]) {
        e.preventDefault();
        handleSelect(variables[selectedIdx]?.id);
      }
    },
    [handleSelect, variables, selectedIdx],
  );

  return (
    <FloatingPortal
      anchorRef={triggerRef}
      open
      onClose={onClose}
      placement="bottom-start"
      maxHeight={320}
      kind="combobox-popup"
      dismissOnEscape
      className="varve-floating-layer"
    >
      <div className="binding-menu" role="dialog" onKeyDown={handleListKey}>
        <input
          id={comboboxId}
          type="text"
          role="combobox"
          aria-expanded={variables.length > 0}
          aria-controls={listboxId}
          aria-activedescendant={highlightedId}
          aria-autocomplete="list"
          placeholder="Search variables..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIdx(0);
          }}
          className="binding-menu__input"
          aria-label="Search variables"
        />
        {variables.length > 0 ? (
          <div
            id={listboxId}
            role="listbox"
            aria-label="Available variables"
            className="binding-menu__list"
          >
            {variables.map((v, i) => (
              <div
                key={v.id}
                id={`${listboxId}-option-${i}`}
                role="option"
                aria-selected={selectedIdx === i}
                aria-disabled={tokenValues.get(v.id)?.error ? true : undefined}
                title={tokenValues.get(v.id)?.error}
                className={`binding-menu__item${selectedIdx === i ? ' binding-menu__item--highlighted' : ''}${tokenValues.get(v.id)?.error ? ' binding-menu__item--unavailable' : ''}`}
                onClick={() => handleSelect(v.id)}
                onMouseEnter={() => setSelectedIdx(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelect(v.id);
                  }
                }}
                tabIndex={0}
              >
                <span className="binding-menu__item-name">{v.name}</span>
                <span className="binding-menu__item-value">
                  {(() => {
                    const tokenValue = tokenValues.get(v.id);
                    if (tokenValue) return tokenValue.display;
                    const val: VariableValue | undefined =
                      v.valuesByMode[variableStore.activeMode] ??
                      v.valuesByMode.default ??
                      (variableStore.modes[0] ? v.valuesByMode[variableStore.modes[0]] : undefined);
                    return val !== undefined ? formatValue(val) : '';
                  })()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="binding-menu__empty">
            {query ? 'No matching variables' : 'No variables defined'}
          </p>
        )}
        <div className="binding-menu__expression">
          <input
            type="text"
            placeholder="Expression e.g. {var} * 2 (optional)"
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            className="binding-menu__input"
            aria-label="Binding expression"
          />
        </div>
      </div>
    </FloatingPortal>
  );
}
