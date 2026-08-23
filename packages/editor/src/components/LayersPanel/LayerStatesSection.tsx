/**
 * LayerStatesSection — capture, apply, rename, and delete saved layer states.
 *
 * A layer state is a sparse, node-id-keyed delta (visibility / transforms /
 * appearance) over the current selection. Applying a state restores those
 * properties on still-valid nodes only; deleted nodes are skipped silently.
 */

import { SOLID_CHROME_ICONS, SolidIcon, Tooltip } from '@varve/ui';
import { useCallback, useMemo, useState } from 'react';
import { useEditor } from '../../context';
import { SectionCollapseToggle } from '../SectionCollapseToggle';
import './layerStatesSection.css';

const CATEGORY_LABEL: Record<string, string> = {
  visibility: 'vis',
  transforms: 'xf',
  appearance: 'app',
};

export function LayerStatesSection() {
  const {
    state,
    captureLayerState,
    applyLayerState,
    recaptureLayerState,
    renameLayerState,
    deleteLayerState,
    duplicateLayerState,
  } = useEditor();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [lastSkipped, setLastSkipped] = useState<{ id: string; count: number } | null>(null);

  const states = state.document.layerStates ?? [];
  const selCount = state.selection.length;

  const handleCreate = useCallback(() => {
    captureLayerState();
  }, [captureLayerState]);

  const handleApply = useCallback(
    (stateId: string) => {
      const skipped = applyLayerState(stateId);
      setLastSkipped(skipped > 0 ? { id: stateId, count: skipped } : null);
    },
    [applyLayerState],
  );

  const handleRenameStart = useCallback((stateId: string, name: string) => {
    setEditingId(stateId);
    setEditingName(name);
  }, []);

  const handleRenameCommit = useCallback(
    (stateId: string) => {
      if (editingName.trim()) {
        renameLayerState(stateId, editingName.trim());
      }
      setEditingId(null);
      setEditingName('');
    },
    [editingName, renameLayerState],
  );

  const handleRenameCancel = useCallback(() => {
    setEditingId(null);
    setEditingName('');
  }, []);

  const badgeList = useMemo(() => (cats: string[]) => cats.map((c) => CATEGORY_LABEL[c] ?? c), []);

  if (states.length === 0 && selCount === 0) {
    return null;
  }

  return (
    <div className="layer-states">
      <div className="layer-states__header">
        <SectionCollapseToggle
          collapsed={collapsed}
          onToggle={() => setCollapsed((value) => !value)}
          label="layer states"
        />
        <span className="layer-states__title">Layer States</span>
        {selCount > 0 && (
          <Tooltip label={`Capture state from selection (${selCount})`}>
            <button
              type="button"
              className="layer-states__create-btn"
              onClick={handleCreate}
              aria-label={`Capture state from selection (${selCount})`}
            >
              <SolidIcon name={SOLID_CHROME_ICONS.plus} size="0.75em" />
            </button>
          </Tooltip>
        )}
      </div>
      {!collapsed && (
        <div className="layer-states__list" role="listbox" aria-label="Layer states">
          {states.map((ls) => {
            const isEditing = editingId === ls.id;
            return (
              <div key={ls.id} className="layer-states__item" role="option" tabIndex={0}>
                {isEditing ? (
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => handleRenameCommit(ls.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRenameCommit(ls.id);
                      if (e.key === 'Escape') handleRenameCancel();
                    }}
                    className="layer-states__name-input"
                  />
                ) : (
                  <Tooltip label="Apply state">
                    <button
                      type="button"
                      className="layer-states__name-btn"
                      onClick={() => handleApply(ls.id)}
                    >
                      <span className="layer-states__name">{ls.name}</span>
                      <span className="layer-states__badges">
                        {badgeList(ls.categories).map((b) => (
                          <span key={b} className="layer-states__badge">
                            {b}
                          </span>
                        ))}
                      </span>
                    </button>
                  </Tooltip>
                )}
                <div className="layer-states__actions">
                  <Tooltip label="Rename">
                    <button
                      type="button"
                      className="layer-states__action-btn"
                      onClick={() => handleRenameStart(ls.id, ls.name)}
                      aria-label={`Rename ${ls.name}`}
                    >
                      <SolidIcon name={SOLID_CHROME_ICONS.fileText} size="0.7em" />
                    </button>
                  </Tooltip>
                  <Tooltip label="Recapture from selection">
                    <button
                      type="button"
                      className="layer-states__action-btn"
                      onClick={() => recaptureLayerState(ls.id)}
                      aria-label={`Recapture ${ls.name} from selection`}
                    >
                      <SolidIcon name={SOLID_CHROME_ICONS.download} size="0.7em" />
                    </button>
                  </Tooltip>
                  <Tooltip label="Duplicate">
                    <button
                      type="button"
                      className="layer-states__action-btn"
                      onClick={() => duplicateLayerState(ls.id)}
                      aria-label={`Duplicate ${ls.name}`}
                    >
                      <SolidIcon name={SOLID_CHROME_ICONS.copy} size="0.7em" />
                    </button>
                  </Tooltip>
                  <Tooltip label="Delete">
                    <button
                      type="button"
                      className="layer-states__action-btn layer-states__action-btn--danger"
                      onClick={() => deleteLayerState(ls.id)}
                      aria-label={`Delete ${ls.name}`}
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
      {lastSkipped && (
        <p className="layer-states__conflict" role="status" aria-live="polite">
          Applied, but {lastSkipped.count} node
          {lastSkipped.count === 1 ? '' : 's'} in this state no longer exist
          <button
            type="button"
            className="layer-states__conflict-dismiss"
            onClick={() => setLastSkipped(null)}
            aria-label="Dismiss conflict notice"
          >
            <SolidIcon name={SOLID_CHROME_ICONS.close} size="0.7em" />
          </button>
        </p>
      )}
    </div>
  );
}
