/**
 * BindingMenu — popover for selecting a variable to bind to a property.
 *
 * Shows available variables filtered by type, with a search input.
 * Supports entering a math expression to transform the resolved value.
 *
 * Watches the editor context's `bindingField` — when it matches `targetField`,
 * the menu auto-opens (entry point for keyboard shortcut and shift+click).
 *
 * Research basis: Figma variable binding dropdown; APG Listbox + Dialog.
 */
import type { VariableStore, VariableValue } from '@strata/scene';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { EditorCtx } from '../../../context';

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

const POPOVER_STYLE: React.CSSProperties = {
  position: 'fixed',
  zIndex: 'var(--z-overlay, 1000)',
  background: 'var(--color-surface-overlay)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-lg)',
  width: 220,
  padding: 'var(--space-2)',
  fontSize: 'var(--font-size-xs)',
};

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  height: 28,
  fontSize: 'var(--font-size-xs)',
  background: 'var(--color-surface-sunken)',
  color: 'var(--color-text-primary)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 var(--space-2)',
  marginBottom: 'var(--space-1)',
};

const LIST_STYLE: React.CSSProperties = {
  margin: 0,
  padding: 0,
  maxHeight: 180,
  overflowY: 'auto',
};

const ITEM_STYLE: React.CSSProperties = {
  padding: '4px 6px',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 4,
};

function formatValue(v: VariableValue): string {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `rgba(${v.join(',')})`;
  return v;
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
  const listRef = useRef<HTMLDivElement>(null);

  const variables = Object.values(variableStore.variables).filter((v) => {
    if (targetType && v.type !== targetType) return false;
    if (query && !v.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  const ctx = useContext(EditorCtx);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  useEffect(() => {
    const el = triggerRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setPosition({ top: rect.bottom + 4, left: rect.left });
    }
  }, [triggerRef]);

  // When context bindingField changes to something other than our field, close.
  useEffect(() => {
    if (targetField && ctx?.bindingField && ctx.bindingField !== targetField) {
      onClose();
    }
  }, [ctx, targetField, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSelect = useCallback(
    (varId: string) => {
      onBind(varId, expression || undefined);
      onClose();
    },
    [onBind, onClose, expression],
  );

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
    <div
      role="dialog"
      aria-label="Bind variable"
      style={{ ...POPOVER_STYLE, top: position.top, left: position.left }}
      onKeyDown={handleListKey}
    >
      <input
        type="text"
        placeholder="Search variables..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelectedIdx(0);
        }}
        style={INPUT_STYLE}
        aria-label="Search variables"
      />
      {variables.length > 0 && (
        <div ref={listRef} role="listbox" aria-label="Available variables" style={LIST_STYLE}>
          {variables.map((v, i) => (
            <div
              key={v.id}
              role="option"
              aria-selected={selectedIdx === i}
              style={{
                ...ITEM_STYLE,
                background: selectedIdx === i ? 'var(--color-interactive-subtle)' : 'transparent',
              }}
              onClick={() => handleSelect(v.id)}
              onMouseEnter={() => setSelectedIdx(i)}
              tabIndex={-1}
            >
              <span
                style={{
                  fontWeight: 'var(--font-weight-medium)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {v.name}
              </span>
              <span
                style={{
                  color: 'var(--color-text-muted)',
                  fontSize: 10,
                  flexShrink: 0,
                }}
              >
                {(() => {
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
      )}
      {variables.length === 0 && (
        <p style={{ color: 'var(--color-text-muted)', margin: 0, padding: '4px 0' }}>
          {query ? 'No matching variables' : 'No variables defined'}
        </p>
      )}
      <div
        style={{
          marginTop: 'var(--space-1)',
          borderTop: '1px solid var(--color-border-subtle)',
          paddingTop: 'var(--space-1)',
        }}
      >
        <input
          type="text"
          placeholder="Expression e.g. {var} * 2 (optional)"
          value={expression}
          onChange={(e) => setExpression(e.target.value)}
          style={INPUT_STYLE}
          aria-label="Binding expression"
        />
      </div>
    </div>
  );
}
