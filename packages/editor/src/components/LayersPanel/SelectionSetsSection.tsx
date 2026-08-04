/**
 * SelectionSetsSection — save, restore, and manage named selections.
 *
 * Each set stores a list of node ids scoped to the document or active page.
 * Restoring a set selects only the members that still exist in the document.
 */

import { SOLID_CHROME_ICONS, SolidIcon, Tooltip } from '@varve/ui';
import { useCallback, useMemo, useState } from 'react';
import { useEditor } from '../../context';
import { SectionCollapseToggle } from '../SectionCollapseToggle';
import './selectionSetsSection.css';

export function SelectionSetsSection() {
  const {
    state,
    createSelectionSet,
    updateSelectionSet,
    deleteSelectionSet,
    renameSelectionSet,
    duplicateSelectionSet,
    selectSelectionSet,
    addToSelectionSet,
    removeFromSelectionSet,
  } = useEditor();

  const [editingId, setEditingId] = useState<string | null>(null);
  // Collapsible like its sibling sidebar sections: they stack above the layers
  // tree in one fixed-height column.
  const [collapsed, setCollapsed] = useState(false);
  const [editingName, setEditingName] = useState('');

  const sets = state.document.selectionSets?.sets ?? [];
  const selectedIds = new Set(state.selection);
  const selCount = selectedIds.size;

  const setMembership = useMemo(() => {
    const map = new Map<string, number>();
    for (const set of sets) {
      let count = 0;
      for (const id of set.nodeIds) {
        if (selectedIds.has(id)) count++;
      }
      map.set(set.id, count);
    }
    return map;
  }, [sets, selectedIds]);

  const handleCreate = useCallback(() => {
    createSelectionSet();
  }, [createSelectionSet]);

  const handleRenameStart = useCallback((setId: string, name: string) => {
    setEditingId(setId);
    setEditingName(name);
  }, []);

  const handleRenameCommit = useCallback(
    (setId: string) => {
      if (editingName.trim()) {
        renameSelectionSet(setId, editingName.trim());
      }
      setEditingId(null);
      setEditingName('');
    },
    [editingName, renameSelectionSet],
  );

  const handleRenameCancel = useCallback(() => {
    setEditingId(null);
    setEditingName('');
  }, []);

  if (sets.length === 0 && selCount === 0) {
    return null;
  }

  return (
    <div className="selection-sets">
      <div className="selection-sets__header">
        <SectionCollapseToggle
          collapsed={collapsed}
          onToggle={() => setCollapsed((value) => !value)}
          label="selection sets"
        />
        <span className="selection-sets__title">Selection Sets</span>
        {selCount > 0 && (
          <Tooltip label={`Save current selection (${selCount})`}>
            <button
              type="button"
              className="selection-sets__create-btn"
              onClick={handleCreate}
              aria-label={`Save current selection (${selCount})`}
            >
              <SolidIcon name={SOLID_CHROME_ICONS.plus} size="0.75em" />
            </button>
          </Tooltip>
        )}
      </div>
      {!collapsed && (
        <div className="selection-sets__list" role="listbox" aria-label="Selection sets">
          {sets.map((set) => {
            const isEditing = editingId === set.id;
            const memberCount = setMembership.get(set.id) ?? 0;
            const totalCount = set.nodeIds.length;
            return (
              <div key={set.id} className="selection-sets__item" role="option" tabIndex={0}>
                {isEditing ? (
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => handleRenameCommit(set.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRenameCommit(set.id);
                      if (e.key === 'Escape') handleRenameCancel();
                    }}
                    className="selection-sets__name-input"
                  />
                ) : (
                  <Tooltip label={`Select ${totalCount} member(s)`}>
                    <button
                      type="button"
                      className="selection-sets__name-btn"
                      onClick={() => selectSelectionSet(set.id)}
                    >
                      <span className="selection-sets__name">{set.name}</span>
                      <span className="selection-sets__count">
                        {memberCount > 0 ? `${memberCount}/` : ''}
                        {totalCount}
                      </span>
                    </button>
                  </Tooltip>
                )}
                <div className="selection-sets__actions">
                  {selCount > 0 && (
                    <>
                      <Tooltip label="Replace with current selection">
                        <button
                          type="button"
                          className="selection-sets__action-btn"
                          onClick={() => updateSelectionSet(set.id)}
                          aria-label="Replace with current selection"
                        >
                          <SolidIcon name={SOLID_CHROME_ICONS.download} size="0.7em" />
                        </button>
                      </Tooltip>
                      <Tooltip label="Add current selection">
                        <button
                          type="button"
                          className="selection-sets__action-btn"
                          onClick={() => addToSelectionSet(set.id)}
                          aria-label="Add current selection"
                        >
                          <SolidIcon name={SOLID_CHROME_ICONS.plus} size="0.7em" />
                        </button>
                      </Tooltip>
                      {memberCount > 0 && (
                        <Tooltip label="Remove current selection">
                          <button
                            type="button"
                            className="selection-sets__action-btn"
                            onClick={() => removeFromSelectionSet(set.id)}
                            aria-label="Remove current selection"
                          >
                            <SolidIcon name={SOLID_CHROME_ICONS.minus} size="0.7em" />
                          </button>
                        </Tooltip>
                      )}
                    </>
                  )}
                  <Tooltip label="Rename">
                    <button
                      type="button"
                      className="selection-sets__action-btn"
                      onClick={() => handleRenameStart(set.id, set.name)}
                      aria-label={`Rename ${set.name}`}
                    >
                      <SolidIcon name={SOLID_CHROME_ICONS.fileText} size="0.7em" />
                    </button>
                  </Tooltip>
                  <Tooltip label="Duplicate">
                    <button
                      type="button"
                      className="selection-sets__action-btn"
                      onClick={() => duplicateSelectionSet(set.id)}
                      aria-label={`Duplicate ${set.name}`}
                    >
                      <SolidIcon name={SOLID_CHROME_ICONS.copy} size="0.7em" />
                    </button>
                  </Tooltip>
                  <Tooltip label="Delete">
                    <button
                      type="button"
                      className="selection-sets__action-btn selection-sets__action-btn--danger"
                      onClick={() => deleteSelectionSet(set.id)}
                      aria-label={`Delete ${set.name}`}
                    >
                      <SolidIcon name={SOLID_CHROME_ICONS.trash} size="0.7em" />
                    </button>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
