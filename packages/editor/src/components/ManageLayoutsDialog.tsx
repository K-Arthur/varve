/**
 * ManageLayoutsDialog — save, apply, rename, duplicate, delete, import, and
 * export named single-window layout variants.
 *
 * Semantics, made visible in the UI:
 * - Apply immediately replaces the active workspace's arrangement (panel
 *   visibility/widths, inspector tabs, status sections, toolbar tools, and
 *   chrome) and persists. It never switches workspace mode.
 * - "Save current…" never overwrites: a duplicate name is an error.
 * - Resetting a workspace captures a local snapshot; it can be restored here
 *   until the next reset.
 * - Layouts are structured data over registered capabilities. Imports are
 *   validated and can only reference known panels, tabs, sections, and tools.
 */
import { Button, Dialog, SearchField } from '@varve/ui';
import { useCallback, useMemo, useState } from 'react';
import { useEditor } from '../context';
import {
  addImportedLayoutVariant,
  addLayoutVariant,
  BUILT_IN_LAYOUT_VARIANTS,
  captureLayoutPayload,
  deleteLayoutVariant,
  duplicateLayoutVariant,
  exportLayoutVariant,
  getLayoutStore,
  importLayoutVariantFromJson,
  isLayoutVariantApplied,
  renameLayoutVariant,
  setLayoutStore,
  updateLayoutVariantPayload,
  type WorkspaceLayoutVariant,
} from '../workspace/layoutVariants';
import { useLayoutStoreState } from '../workspace/useLayoutVariants';
import { getWorkspacePreferences } from '../workspace/workspaceStore';
import { WORKSPACE_LABELS } from '../workspace/workspaceTypes';
import { promptDialog } from './PromptDialog';

function formatSavedAt(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return 'unknown time';
  }
}

export function ManageLayoutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const editor = useEditor();
  const store = useLayoutStoreState();
  const mode = editor.state.workspaceMode;
  const [newName, setNewName] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<WorkspaceLayoutVariant | null>(null);
  const [importText, setImportText] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<WorkspaceLayoutVariant | null>(null);

  const filter = search.trim().toLocaleLowerCase();
  const userVariants = useMemo(
    () =>
      store.variants.filter((variant) =>
        filter ? variant.name.toLocaleLowerCase().includes(filter) : true,
      ),
    [filter, store.variants],
  );
  const builtIns = useMemo(
    () =>
      BUILT_IN_LAYOUT_VARIANTS.filter((variant) =>
        filter ? variant.name.toLocaleLowerCase().includes(filter) : true,
      ),
    [filter],
  );

  const handleApply = useCallback(
    (variant: WorkspaceLayoutVariant) => {
      setError('');
      setStatus('');
      if (editor.applyWorkspaceLayout(variant)) {
        setStatus(`Applied “${variant.name}” to ${WORKSPACE_LABELS[mode]}.`);
      } else {
        setError('This layout could not be applied.');
      }
    },
    [editor, mode],
  );

  const handleSaveCurrent = useCallback(() => {
    setError('');
    setStatus('');
    const result = addLayoutVariant(getLayoutStore(), {
      name: newName,
      sourceMode: mode,
      payload: captureLayoutPayload(mode, getWorkspacePreferences()),
    });
    if (!result.ok) {
      setError(
        result.reason === 'duplicate-name'
          ? 'A layout with that name already exists. Choose another name.'
          : result.reason === 'limit'
            ? 'The layout limit was reached. Delete a layout before adding another.'
            : 'Enter a name for the layout.',
      );
      return;
    }
    setLayoutStore(result.state);
    setNewName('');
    setStatus(`Saved “${result.variant.name}”.`);
  }, [mode, newName]);

  const handleUpdate = useCallback(
    (variant: WorkspaceLayoutVariant) => {
      const result = updateLayoutVariantPayload(
        getLayoutStore(),
        variant.id,
        captureLayoutPayload(mode, getWorkspacePreferences()),
      );
      if (!result.ok) {
        setError('That layout could not be updated.');
        return;
      }
      setLayoutStore(result.state);
      setStatus(`Updated “${result.variant.name}” to the current arrangement.`);
    },
    [mode],
  );

  const handleRename = useCallback(async (variant: WorkspaceLayoutVariant) => {
    const next = await promptDialog('Rename layout', variant.name);
    if (next === null) return;
    const result = renameLayoutVariant(getLayoutStore(), variant.id, next);
    if (!result.ok) {
      setError(
        result.reason === 'duplicate-name'
          ? 'Another layout already uses that name.'
          : 'Enter a valid name.',
      );
      return;
    }
    setLayoutStore(result.state);
    setStatus(`Renamed to “${result.variant.name}”.`);
  }, []);

  const handleDuplicate = useCallback((variant: WorkspaceLayoutVariant) => {
    const result = duplicateLayoutVariant(getLayoutStore(), variant.id);
    if (!result.ok) {
      setError('That layout could not be duplicated.');
      return;
    }
    setLayoutStore(result.state);
    setStatus(`Created “${result.variant.name}”.`);
  }, []);

  const handleExport = useCallback(async (variant: WorkspaceLayoutVariant) => {
    const json = exportLayoutVariant(variant);
    try {
      await navigator.clipboard.writeText(json);
      setStatus(`Copied “${variant.name}” as portable JSON to the clipboard.`);
    } catch {
      setError('Clipboard access was denied; the layout could not be copied.');
    }
  }, []);

  const handleImportText = useCallback(() => {
    setError('');
    setStatus('');
    const result = importLayoutVariantFromJson(importText);
    if (!result.ok) {
      setError(
        result.reason === 'future-version'
          ? 'This layout was created by a newer version and cannot be read safely.'
          : result.reason === 'too-large'
            ? 'That layout payload is too large to import.'
            : 'That is not a valid Varve layout.',
      );
      return;
    }
    const collision = store.variants.some(
      (variant) => variant.name.toLocaleLowerCase() === result.variant.name.toLocaleLowerCase(),
    );
    if (collision) {
      setPendingImport(result.variant);
      return;
    }
    const added = addImportedLayoutVariant(getLayoutStore(), result.variant);
    if (!added.ok) {
      setError('The layout could not be imported.');
      return;
    }
    setLayoutStore(added.state);
    setImportText('');
    setImportOpen(false);
    setStatus(`Imported “${result.variant.name}”.`);
  }, [importText, store.variants]);

  const resolveImportCollision = useCallback(
    (strategy: 'replace' | 'duplicate') => {
      if (!pendingImport) return;
      const added = addImportedLayoutVariant(getLayoutStore(), pendingImport, strategy);
      if (!added.ok) {
        setError('The layout could not be imported.');
        return;
      }
      setLayoutStore(added.state);
      setStatus(
        strategy === 'replace'
          ? `Replaced the existing “${pendingImport.name}”.`
          : `Imported “${added.variant.name}”.`,
      );
      setPendingImport(null);
      setImportText('');
      setImportOpen(false);
    },
    [pendingImport],
  );

  const handleRestoreSnapshot = useCallback(() => {
    setError('');
    setStatus('');
    if (!editor.restoreLastResetLayout()) {
      setError('There is no pre-reset snapshot to restore.');
      return;
    }
    setStatus('Restored the arrangement from before the last reset.');
  }, [editor]);

  const handleConfirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    setLayoutStore(deleteLayoutVariant(getLayoutStore(), pendingDelete.id));
    setStatus(`Deleted “${pendingDelete.name}”.`);
    setPendingDelete(null);
  }, [pendingDelete]);

  return (
    <Dialog open={open} onClose={onClose} title="Manage Layouts">
      <div className="workspace-layouts">
        <p className="workspace-layouts__hint">
          Layouts save how the editor is arranged for the active workspace ({WORKSPACE_LABELS[mode]}
          ). Applying a layout never switches workspace and never changes the document.
        </p>

        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Filter layouts..."
          aria-label="Filter layouts"
        />

        {store.resetSnapshot && (
          <section className="workspace-layouts__section workspace-layouts__section--recovery">
            <h3>Recovery</h3>
            <div className="workspace-layouts__row">
              <span>Before last reset · {formatSavedAt(store.resetSnapshot.savedAt)}</span>
              <Button variant="secondary" onClick={handleRestoreSnapshot}>
                Restore
              </Button>
            </div>
          </section>
        )}

        <section className="workspace-layouts__section">
          <h3>Templates</h3>
          {builtIns.length === 0 && <p className="workspace-layouts__empty">No templates match.</p>}
          {builtIns.map((variant) => (
            <div key={variant.id} className="workspace-layouts__row">
              <span className="workspace-layouts__name">
                {variant.name}
                {isLayoutVariantApplied(variant, mode) && (
                  <span className="workspace-layouts__badge">Current</span>
                )}
              </span>
              <span className="workspace-layouts__actions">
                <Button variant="secondary" onClick={() => handleApply(variant)}>
                  Apply
                </Button>
                <Button variant="ghost" onClick={() => handleDuplicate(variant)}>
                  Duplicate
                </Button>
              </span>
            </div>
          ))}
        </section>

        <section className="workspace-layouts__section">
          <h3>Your layouts</h3>
          {userVariants.length === 0 && (
            <p className="workspace-layouts__empty">
              No saved layouts yet. Arrange the workspace, then save it below.
            </p>
          )}
          {userVariants.map((variant) => (
            <div key={variant.id} className="workspace-layouts__row">
              <span className="workspace-layouts__name">
                {variant.name}
                {variant.sourceMode && (
                  <span className="workspace-layouts__mode">
                    from {WORKSPACE_LABELS[variant.sourceMode]}
                  </span>
                )}
                {isLayoutVariantApplied(variant, mode) && (
                  <span className="workspace-layouts__badge">Current</span>
                )}
              </span>
              <span className="workspace-layouts__actions">
                <Button variant="secondary" onClick={() => handleApply(variant)}>
                  Apply
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => handleUpdate(variant)}
                  title="Replace this layout with the current arrangement"
                >
                  Update
                </Button>
                <Button variant="ghost" onClick={() => void handleRename(variant)}>
                  Rename
                </Button>
                <Button variant="ghost" onClick={() => handleDuplicate(variant)}>
                  Duplicate
                </Button>
                <Button variant="ghost" onClick={() => void handleExport(variant)}>
                  Copy JSON
                </Button>
                <Button variant="destructive" onClick={() => setPendingDelete(variant)}>
                  Delete
                </Button>
              </span>
            </div>
          ))}
        </section>

        <section className="workspace-layouts__section">
          <h3>Save current arrangement</h3>
          <div className="workspace-layouts__save">
            <input
              type="text"
              className="workspace-layouts__input"
              value={newName}
              maxLength={64}
              placeholder="Layout name"
              aria-label="New layout name"
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleSaveCurrent();
                }
              }}
            />
            <Button
              onClick={handleSaveCurrent}
              disabled={newName.trim().length === 0}
              disabledReason="Enter a layout name to save"
            >
              Save current
            </Button>
          </div>
          <div className="workspace-layouts__save">
            <Button
              variant="secondary"
              onClick={() => {
                setImportOpen((value) => !value);
                setError('');
              }}
            >
              Import from JSON...
            </Button>
          </div>
          {importOpen && (
            <div className="workspace-layouts__import">
              <label className="workspace-layouts__import-label" htmlFor="layout-import-text">
                Paste a layout JSON document
              </label>
              <textarea
                id="layout-import-text"
                className="workspace-layouts__textarea"
                value={importText}
                rows={5}
                onChange={(event) => setImportText(event.target.value)}
              />
              <Button
                onClick={handleImportText}
                disabled={importText.trim().length === 0}
                disabledReason="Paste a layout JSON object to import"
              >
                Import
              </Button>
            </div>
          )}
        </section>

        <div className="workspace-layouts__footer">
          <div role="status" aria-live="polite" className="workspace-layouts__status">
            {status}
          </div>
          {error && (
            <div role="alert" className="workspace-layouts__error">
              {error}
            </div>
          )}
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete layout?"
        dismissible={false}
      >
        <p>
          Delete “{pendingDelete?.name}”? This removes the saved arrangement. The current workspace
          arrangement is not changed.
        </p>
        <div className="workspace-layouts__footer">
          <Button variant="secondary" onClick={() => setPendingDelete(null)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirmDelete}>
            Delete layout
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={pendingImport !== null}
        onClose={() => setPendingImport(null)}
        title="Layout name already exists"
        dismissible={false}
      >
        <p>
          A layout named “{pendingImport?.variant.name}” already exists. Replace it with the
          imported layout, or import a duplicate alongside it?
        </p>
        <div className="workspace-layouts__footer">
          <Button variant="secondary" onClick={() => setPendingImport(null)}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={() => resolveImportCollision('duplicate')}>
            Import as duplicate
          </Button>
          <Button variant="destructive" onClick={() => resolveImportCollision('replace')}>
            Replace existing
          </Button>
        </div>
      </Dialog>
    </Dialog>
  );
}
