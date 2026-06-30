/**
 * VariablePanel — B1: surfaces the variables+math engine in the UI.
 *
 * Shows the active session's VariableStore as an editable table.
 * Supports all four variable types (color, number, string, boolean),
 * mode-aware values, inline editing, resolved-value preview, and add/delete.
 *
 * The underlying engine (expr.ts + variables.ts) handles {alias}*math expressions.
 * Research basis: Figma "Variables" panel; Tokens Studio table conventions.
 */
import { useEffect, useRef, useState } from 'react';
import { useEditor } from './context';

const TYPE_OPTIONS = ['number', 'string', 'boolean', 'color'] as const;

export function VariablePanel() {
  const { state, addVariable, updateVariable, deleteVariable, setVariableMode, resolveVariable } =
    useEditor();
  const { variableStore } = state;
  const vars = Object.values(variableStore.variables);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'number' | 'string' | 'boolean' | 'color'>('number');
  const [newValue, setNewValue] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);
  const addNameRef = useRef<HTMLInputElement>(null);

  // Focus edit/add inputs on state change (replaces autoFocus for a11y)
  useEffect(() => {
    if (editingId) editInputRef.current?.focus();
  }, [editingId]);
  useEffect(() => {
    if (adding) addNameRef.current?.focus();
  }, [adding]);

  function handleAdd() {
    if (!newName.trim()) return;
    const rawValue: string | number | boolean =
      newType === 'number'
        ? Number(newValue) || 0
        : newType === 'boolean'
          ? newValue === 'true'
          : newValue;
    addVariable({
      name: newName.trim(),
      type: newType,
      valuesByMode: { [variableStore.activeMode]: rawValue },
    });
    setNewName('');
    setNewValue('');
    setAdding(false);
  }

  function commitEdit(id: string) {
    const v = variableStore.variables[id];
    if (!v) return;
    const rawValue: string | number | boolean =
      v.type === 'number'
        ? Number(editValue) || 0
        : v.type === 'boolean'
          ? editValue === 'true'
          : editValue;
    updateVariable(id, {
      valuesByMode: { ...v.valuesByMode, [variableStore.activeMode]: rawValue },
    });
    setEditingId(null);
  }

  function resolvedDisplay(nameOrId: string): string {
    try {
      const val = resolveVariable(nameOrId);
      return String(val);
    } catch {
      return '—';
    }
  }

  return (
    <div className="editor-inspector__group">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-2)',
        }}
      >
        <span className="editor-inspector__group-title" style={{ margin: 0 }}>
          Variables
        </span>
        <div style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center' }}>
          {variableStore.modes.length > 1 && (
            <select
              value={variableStore.activeMode}
              onChange={(e) => setVariableMode(e.target.value)}
              style={{
                fontSize: 'var(--font-size-xs)',
                background: 'var(--color-surface-raised)',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '1px 4px',
              }}
            >
              {variableStore.modes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => setAdding(true)}
            style={{
              fontSize: 'var(--font-size-xs)',
              padding: '2px 6px',
              background: 'var(--color-interactive-default)',
              color: 'var(--color-text-on-accent)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
            }}
          >
            + Add
          </button>
        </div>
      </div>

      {vars.length === 0 && !adding && (
        <p
          style={{
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-muted)',
            margin: 0,
          }}
        >
          No variables yet. Use variables to share values across nodes.
        </p>
      )}

      {vars.length > 0 && (
        <table
          style={{
            width: '100%',
            fontSize: 'var(--font-size-xs)',
            borderCollapse: 'collapse',
          }}
        >
          <thead>
            <tr style={{ color: 'var(--color-text-muted)' }}>
              <th style={{ textAlign: 'left', fontWeight: 'normal', paddingBottom: 4 }}>Name</th>
              <th style={{ textAlign: 'left', fontWeight: 'normal', paddingBottom: 4 }}>Value</th>
              <th style={{ textAlign: 'left', fontWeight: 'normal', paddingBottom: 4 }}>
                Resolved
              </th>
              <th style={{ width: 20 }} />
            </tr>
          </thead>
          <tbody>
            {vars.map((v) => {
              const currentVal = String(
                v.valuesByMode[variableStore.activeMode] ?? v.valuesByMode.default ?? '',
              );
              return (
                <tr key={v.id} style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                  <td style={{ padding: '3px 0', verticalAlign: 'middle' }}>
                    <span title={`${v.type} · ${v.id}`}>{v.name}</span>
                  </td>
                  <td style={{ padding: '3px 4px', verticalAlign: 'middle' }}>
                    {editingId === v.id ? (
                      <input
                        ref={editInputRef}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => commitEdit(v.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEdit(v.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        style={{
                          width: '100%',
                          fontSize: 'inherit',
                          background: 'var(--color-surface-app)',
                          color: 'var(--color-text-primary)',
                          border: '1px solid var(--color-interactive-default)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '1px 4px',
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(v.id);
                          setEditValue(currentVal);
                        }}
                        style={{
                          all: 'unset',
                          cursor: 'text',
                          fontFamily: 'inherit',
                          fontSize: 'inherit',
                          color: 'inherit',
                          display: 'block',
                          width: '100%',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {currentVal}
                      </button>
                    )}
                  </td>
                  <td
                    style={{
                      padding: '3px 0',
                      verticalAlign: 'middle',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {resolvedDisplay(v.id)}
                  </td>
                  <td style={{ padding: '3px 0', textAlign: 'right', verticalAlign: 'middle' }}>
                    <button
                      type="button"
                      aria-label={`Delete variable ${v.name}`}
                      onClick={() => deleteVariable(v.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--color-text-muted)',
                        fontSize: 10,
                        padding: '1px 2px',
                      }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M18 6 6 18" />
                        <path d="m6 6 12 12" />
                      </svg>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {adding && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto auto',
            gap: 'var(--space-1)',
            marginTop: 'var(--space-2)',
            alignItems: 'center',
          }}
        >
          <input
            ref={addNameRef}
            placeholder="name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') setAdding(false);
            }}
            style={{
              fontSize: 'var(--font-size-xs)',
              background: 'var(--color-surface-app)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 4px',
            }}
          />
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as typeof newType)}
            style={{
              fontSize: 'var(--font-size-xs)',
              background: 'var(--color-surface-raised)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 4px',
            }}
          >
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            placeholder="value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') setAdding(false);
            }}
            style={{
              fontSize: 'var(--font-size-xs)',
              background: 'var(--color-surface-app)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 4px',
              width: 64,
            }}
          />
          <button
            type="button"
            onClick={handleAdd}
            style={{
              gridColumn: '1 / -1',
              fontSize: 'var(--font-size-xs)',
              background: 'var(--color-interactive-default)',
              color: 'var(--color-text-on-accent)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: '3px 8px',
              cursor: 'pointer',
            }}
          >
            Add variable
          </button>
        </div>
      )}
    </div>
  );
}
