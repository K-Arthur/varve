import type { MasterAppliesTo, MasterPage } from '@strata/scene';
import { Select, SOLID_CHROME_ICONS, SolidIcon } from '@strata/ui';
import { useCallback, useState } from 'react';
import { useEditor } from '../../context';
import './master-panel.css';

export function MasterPanel() {
  const {
    state,
    createMaster,
    deleteMaster,
    renameMaster,
    duplicateMaster,
    assignMasterToPage,
    setMasterAppliesTo,
    getPageNumber,
  } = useEditor();

  const doc = state.document;
  const masters = doc.masters;
  const pages = doc.pages ?? [];

  const masterList: MasterPage[] = masters ? Object.values(masters) : [];

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const handleCreate = useCallback(() => {
    createMaster('Master', 1920, 1080);
  }, [createMaster]);

  const handleRemoveFromPage = useCallback(() => {
    if (doc.activePageId) {
      assignMasterToPage(doc.activePageId, null);
    }
  }, [doc.activePageId, assignMasterToPage]);

  const handleRename = useCallback(
    (masterId: string) => {
      if (editName.trim()) {
        renameMaster(masterId, editName.trim());
      }
      setEditingId(null);
    },
    [editName, renameMaster],
  );

  // Master pages propagate a layout across pages and target left/right pages,
  // which only means something in a multi-page print document — the sibling
  // Spreads panel is scoped the same way. Showing it everywhere spent a large
  // block of the sidebar, and the layers tree it shares that column with paid
  // for it, in modes where masters cannot be used.
  if (state.workspaceMode !== 'print') {
    return null;
  }

  // Within print it renders even with no masters: returning null when empty
  // left the "+ New Master" control unreachable — it lives in this markup —
  // and made the empty state below dead code.
  return (
    <div className="master-panel">
      <div className="master-panel__header">
        <span className="master-panel__title">Masters</span>
        <button
          type="button"
          className="master-panel__add-btn"
          onClick={handleCreate}
          aria-label="Create new master page"
          title="Master pages let you define reusable layouts that propagate across pages."
        >
          + New Master
        </button>
      </div>

      {/* One line, not a block: this panel shares a fixed-height sidebar column
       * with the layers tree, and a tall empty state pushed the tree down to its
       * minimum height, hiding most of its rows. The fuller explanation lives on
       * the create button's tooltip. */}
      {masterList.length === 0 && <p className="master-panel__empty-text">No master pages yet.</p>}

      <ul className="master-panel__list" aria-label="Master pages">
        {masterList.map((master) => (
          <li key={master.id} className="master-panel__item">
            {editingId === master.id ? (
              <input
                className="master-panel__rename-input"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => handleRename(master.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename(master.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                // biome-ignore lint/a11y/noAutofocus: rename input needs auto-focus
                autoFocus
                maxLength={64}
                aria-label="Master name"
              />
            ) : (
              <button
                type="button"
                className="master-panel__name"
                onDoubleClick={() => {
                  setEditingId(master.id);
                  setEditName(master.name);
                }}
                aria-label={`Master: ${master.name}`}
              >
                {master.name}
              </button>
            )}

            <div className="master-panel__actions">
              <Select
                label={`Apply to pages: ${master.appliesTo}`}
                value={master.appliesTo}
                options={[
                  { value: 'all', label: 'All pages' },
                  { value: 'left', label: 'Left pages' },
                  { value: 'right', label: 'Right pages' },
                ]}
                onChange={(v) => setMasterAppliesTo(master.id, v as MasterAppliesTo)}
              />

              <button
                type="button"
                className="master-panel__action-btn"
                onClick={() => duplicateMaster(master.id)}
                aria-label={`Duplicate ${master.name}`}
                title="Duplicate"
              >
                <SolidIcon name={SOLID_CHROME_ICONS.copy} label={undefined} size="0.85em" />
              </button>

              <button
                type="button"
                className="master-panel__action-btn master-panel__action-btn--danger"
                onClick={() => {
                  if (window.confirm(`Delete master "${master.name}"?`)) {
                    deleteMaster(master.id);
                  }
                }}
                aria-label={`Delete ${master.name}`}
                title="Delete"
              >
                <SolidIcon name={SOLID_CHROME_ICONS.trash} label={undefined} size="0.85em" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      {doc.activePageId && (
        <div
          className="master-panel__page-status"
          role="status"
          aria-label="Current page master status"
        >
          <span className="master-panel__page-label">Page {getPageNumber(doc.activePageId)}</span>
          {(() => {
            const page = pages.find((p) => p.id === doc.activePageId);
            if (!page) return null;
            if (page.masterPageId) {
              const master = masters?.[page.masterPageId];
              const overrideCount = page.masterOverrides
                ? Object.keys(page.masterOverrides).length
                : 0;
              return (
                <span className="master-panel__active-master">
                  Master: {master?.name ?? 'Unknown'}
                  {overrideCount > 0 && (
                    <span className="master-panel__override-badge">
                      {' '}
                      ({overrideCount} {overrideCount === 1 ? 'override' : 'overrides'})
                    </span>
                  )}
                  <button
                    type="button"
                    className="master-panel__detach-btn"
                    onClick={handleRemoveFromPage}
                    aria-label="Remove master from this page"
                  >
                    Detach
                  </button>
                </span>
              );
            }
            return <span className="master-panel__no-master">No master</span>;
          })()}
        </div>
      )}
    </div>
  );
}
