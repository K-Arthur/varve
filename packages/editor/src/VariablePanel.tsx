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

import { Select, Tooltip } from '@varve/ui';
import { useEffect, useRef, useState } from 'react';
import { SectionCollapseToggle } from './components/SectionCollapseToggle';
import { useEditor } from './context';
import { docVariableStore } from './docVariableStore';
import './VariablePanel.css';

const TYPE_OPTIONS = ['number', 'string', 'boolean', 'color'] as const;

export function VariablePanel() {
  const { state, addVariable, updateVariable, deleteVariable, setVariableMode, resolveVariable } =
    useEditor();
  const variableStore = docVariableStore(state.document);
  const vars = Object.values(variableStore.variables);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'number' | 'string' | 'boolean' | 'color'>('number');
  const [newValue, setNewValue] = useState('');
  const [adding, setAdding] = useState(false);
  // Collapsible like its sibling sidebar sections: they stack above the layers
  // tree in one fixed-height column.
  const [collapsed, setCollapsed] = useState(false);
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
    // Infer a color type when the value looks like a hex color, so pasting
    // #39d0c6 creates a color variable without a manual type pick.
    const looksLikeColor = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(newValue.trim());
    const effectiveType = looksLikeColor ? 'color' : newType;
    const rawValue: string | number | boolean =
      effectiveType === 'number'
        ? Number(newValue) || 0
        : effectiveType === 'boolean'
          ? newValue === 'true'
          : newValue;
    addVariable({
      name: newName.trim(),
      type: effectiveType,
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

  // When there are no variables yet, still render the header so the first
  // variable can be created (the add form lives below the header).

  return (
    <div className="editor-inspector__group">
      <div className="variable-panel__header">
        <SectionCollapseToggle
          collapsed={collapsed}
          onToggle={() => setCollapsed((value) => !value)}
          label="variables"
        />
        <span className="editor-inspector__group-title variable-panel__title">Variables</span>
        <div className="variable-panel__controls">
          {variableStore.modes.length > 1 && (
            <Select
              label="Variable mode"
              value={variableStore.activeMode}
              options={variableStore.modes.map((m) => ({ value: m, label: m }))}
              onChange={(v) => setVariableMode(v)}
            />
          )}
          <button type="button" onClick={() => setAdding(true)} className="variable-panel__add-btn">
            + Add
          </button>
        </div>
      </div>

      {!collapsed && vars.length > 0 && (
        <table className="variable-panel__table" aria-label="Variables">
          <thead>
            <tr className="variable-panel__table-header">
              <th className="variable-panel__table-header th--name">Name</th>
              <th className="variable-panel__table-header th--value">Value</th>
              <th className="variable-panel__table-header th--resolved">Resolved</th>
              <th className="variable-panel__table-header th--actions" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {vars.map((v) => {
              const currentVal = String(
                v.valuesByMode[variableStore.activeMode] ?? v.valuesByMode.default ?? '',
              );
              return (
                <tr key={v.id} className="variable-panel__table-row">
                  <td className="variable-panel__table-cell variable-panel__table-cell--name">
                    <Tooltip label={`${v.type} · ${v.id}`}>
                      <span>{v.name}</span>
                    </Tooltip>
                  </td>
                  <td className="variable-panel__table-cell variable-panel__table-cell--value">
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
                        className="variable-panel__edit-input"
                        aria-label="Variable value"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(v.id);
                          setEditValue(currentVal);
                        }}
                        className="variable-panel__value-btn"
                      >
                        {currentVal}
                      </button>
                    )}
                  </td>
                  <td className="variable-panel__table-cell variable-panel__table-cell--resolved">
                    {resolvedDisplay(v.id)}
                  </td>
                  <td className="variable-panel__table-cell variable-panel__table-cell--actions">
                    <button
                      type="button"
                      aria-label={`Delete variable ${v.name}`}
                      onClick={() => deleteVariable(v.id)}
                      className="variable-panel__delete-btn"
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
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

      {!collapsed && adding && (
        <div className="variable-panel__add-form">
          <input
            ref={addNameRef}
            placeholder="name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') setAdding(false);
            }}
            className="variable-panel__add-input"
          />
          <Select
            label="Variable type"
            value={newType}
            options={TYPE_OPTIONS.map((t) => ({ value: t, label: t }))}
            onChange={(v) => setNewType(v as typeof newType)}
          />
          <input
            placeholder="value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') setAdding(false);
            }}
            className="variable-panel__add-value-input"
          />
          <button type="button" onClick={handleAdd} className="variable-panel__add-submit-btn">
            Add variable
          </button>
        </div>
      )}
    </div>
  );
}
