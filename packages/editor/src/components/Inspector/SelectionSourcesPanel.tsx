import { combineAreaSelections } from '@varve/engine';
import { isImageShape } from '@varve/scene';
import { Icon } from '@varve/ui';
import { useState } from 'react';
import { getActionRegistry } from '../../actions/ActionRegistry';
import { getToolManager } from '../../canvas/toolDispatcher';
import { useEditor } from '../../context';
import type { SelectionPaintTool } from '../../tools/SelectionPaintTool';
import { deserializeAreaSelection, serializeAreaSelection } from '../../tools/savedAreaSelections';
import { DisclosureSection } from './controls/DisclosureSection';

import './selectionSources.css';

function runAction(id: string): void {
  getActionRegistry().get(id)?.handler(undefined);
}

export function SelectionSourcesPanel() {
  const { state, setAreaSelection, setTool, updateDoc, announce } = useEditor();
  const saved = state.document.savedAreaSelections ?? [];
  const hasAreaSelection = Boolean(state.areaSelection);
  const [nextName, setNextName] = useState(`Selection ${saved.length + 1}`);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const selectedNode =
    state.selection.length === 1 ? state.document.nodes[state.selection[0]!] : undefined;
  const hasClosedPath =
    selectedNode?.kind === 'path'
      ? selectedNode.closed
      : selectedNode?.kind === 'shape' && selectedNode.shape.kind === 'path'
        ? selectedNode.shape.closed
        : false;
  const hasImage = selectedNode?.kind === 'shape' && isImageShape(selectedNode);
  const paintingSelection = state.tool === 'selectionPaint';

  const cancelPaint = () => {
    const tool = getToolManager().getTool<SelectionPaintTool>('selectionPaint');
    setAreaSelection?.(tool?.getOriginalSelection() ?? null);
    setTool('select');
    announce('Selection paint cancelled');
  };

  const remove = (id: string) => {
    updateDoc((doc) => ({
      ...doc,
      savedAreaSelections: (doc.savedAreaSelections ?? []).filter((item) => item.id !== id),
    }));
    announce('Saved area selection deleted');
  };

  const createId = (prefix: string): string =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${prefix}-${Date.now()}-${saved.length}`;

  const saveCurrent = () => {
    const selection = state.areaSelection;
    const name = nextName.trim().slice(0, 256);
    if (!selection || !name) {
      announce('Enter a name and make a pixel selection before saving it');
      return;
    }
    updateDoc((doc) => ({
      ...doc,
      savedAreaSelections: [
        ...(doc.savedAreaSelections ?? []),
        {
          id: createId('saved-area'),
          name,
          pageId: doc.activePageId,
          selection: serializeAreaSelection(selection),
          createdAt: Date.now(),
        },
      ],
    }));
    setNextName(`Selection ${saved.length + 2}`);
    announce(`Saved area selection as ${name}`);
  };

  const applySaved = (
    item: (typeof saved)[number],
    operation: 'replace' | 'add' | 'subtract' | 'intersect',
  ) => {
    const selection = deserializeAreaSelection(item);
    if (!selection || !setAreaSelection) {
      announce('The saved area selection is invalid');
      return;
    }
    const next =
      operation === 'replace'
        ? selection
        : combineAreaSelections(
            state.areaSelection ?? null,
            selection,
            operation,
            Math.max(state.areaSelection?.generation ?? 0, selection.generation) + 1,
          );
    if (!next) {
      announce(`Could not ${operation} ${item.name}`);
      return;
    }
    setAreaSelection({
      ...next,
      generation: Math.max(next.generation, state.areaSelection?.generation ?? 0) + 1,
    });
    const verb =
      operation === 'replace'
        ? 'Loaded'
        : operation === 'add'
          ? 'Added'
          : operation === 'subtract'
            ? 'Subtracted'
            : 'Intersected';
    announce(operation === 'replace' ? `Loaded ${item.name}` : `${verb} ${item.name}`);
  };

  const beginRename = (item: (typeof saved)[number]) => {
    setRenamingId(item.id);
    setRenameValue(item.name);
  };

  const commitRename = (id: string) => {
    const name = renameValue.trim().slice(0, 256);
    if (!name) {
      announce('Saved selection names cannot be empty');
      return;
    }
    updateDoc((doc) => ({
      ...doc,
      savedAreaSelections: (doc.savedAreaSelections ?? []).map((item) =>
        item.id === id ? { ...item, name } : item,
      ),
    }));
    setRenamingId(null);
    announce(`Renamed saved selection to ${name}`);
  };

  const duplicate = (item: (typeof saved)[number]) => {
    const copyName = `${item.name} copy`;
    updateDoc((doc) => ({
      ...doc,
      savedAreaSelections: [
        ...(doc.savedAreaSelections ?? []),
        { ...item, id: createId('saved-area-copy'), name: copyName, createdAt: Date.now() },
      ],
    }));
    announce(`Duplicated ${item.name}`);
  };

  return (
    <DisclosureSection title="Selection Sources" id="selection-sources" defaultExpanded>
      <div className="insp-selection-sources" data-testid="selection-sources-panel">
        <p className="insp-selection-sources__description">
          Build, refine, reuse, and convert document-space coverage without changing layer
          selection.
        </p>
        <div className="insp-selection-sources__actions">
          <button
            type="button"
            className="insp-selection-sources__button insp-selection-sources__button--primary"
            disabled={!hasAreaSelection}
            onClick={() => setTool('selectionPaint')}
          >
            Paint selection
          </button>
          <button
            type="button"
            className="insp-selection-sources__button"
            disabled={!hasClosedPath}
            title="Select one closed path to use this command"
            onClick={() => runAction('pathToSelection')}
          >
            Path to selection
          </button>
          <button
            type="button"
            className="insp-selection-sources__button"
            disabled={!hasAreaSelection}
            onClick={() => runAction('selectionToPath')}
          >
            Selection to path
          </button>
          <button
            type="button"
            className="insp-selection-sources__button"
            disabled={!hasImage}
            title="Select one image to use this command"
            onClick={() => runAction('selectFromImageAlpha')}
          >
            Image alpha
          </button>
          <button
            type="button"
            className="insp-selection-sources__button"
            disabled={!hasImage}
            title="Select one image to use this command"
            onClick={() => runAction('selectFromImageColorRange')}
          >
            Magic wand
          </button>
          <button
            type="button"
            className="insp-selection-sources__button"
            disabled={!hasImage}
            title="Select one image to use this command"
            onClick={() => runAction('selectFromImageLuminance')}
          >
            Luminance
          </button>
          <label className="insp-selection-sources__name-field">
            <span>Name</span>
            <input
              value={nextName}
              maxLength={256}
              onChange={(event) => setNextName(event.target.value)}
              aria-label="Saved selection name"
            />
          </label>
          <button
            type="button"
            className="insp-selection-sources__button insp-selection-sources__button--primary"
            disabled={!hasAreaSelection || nextName.trim().length === 0}
            onClick={saveCurrent}
          >
            Save selection
          </button>
        </div>
        {paintingSelection && (
          <section
            className="insp-selection-sources__session"
            aria-label="Selection paint controls"
          >
            <span className="insp-selection-sources__session-label">Quick-mask editing</span>
            <div className="insp-selection-sources__session-actions">
              <button
                type="button"
                className="insp-selection-sources__button insp-selection-sources__button--primary"
                onClick={() => {
                  setTool('select');
                  announce('Selection paint applied');
                }}
              >
                Apply
              </button>
              <button
                type="button"
                className="insp-selection-sources__button"
                onClick={cancelPaint}
              >
                Cancel
              </button>
            </div>
          </section>
        )}
        {saved.length > 0 ? (
          <section className="insp-selection-sources__saved" aria-label="Saved area selections">
            <p className="insp-selection-sources__saved-title">Saved selections</p>
            {saved.map((item) => (
              <div className="insp-selection-sources__saved-row" key={item.id}>
                {renamingId === item.id ? (
                  <input
                    className="insp-selection-sources__rename-input"
                    value={renameValue}
                    maxLength={256}
                    aria-label={`Rename ${item.name}`}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitRename(item.id);
                      if (event.key === 'Escape') setRenamingId(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="insp-selection-sources__saved-name"
                    onClick={() => applySaved(item, 'replace')}
                    title="Load this saved selection"
                  >
                    {item.name}
                  </button>
                )}
                <div className="insp-selection-sources__saved-actions">
                  {renamingId === item.id ? (
                    <button
                      type="button"
                      className="insp-selection-sources__saved-action"
                      aria-label={`Save name for ${item.name}`}
                      onClick={() => commitRename(item.id)}
                    >
                      <Icon name="Check" size={13} />
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="insp-selection-sources__saved-action"
                        aria-label={`Add ${item.name}`}
                        title="Add to current selection"
                        onClick={() => applySaved(item, 'add')}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        className="insp-selection-sources__saved-action"
                        aria-label={`Subtract ${item.name}`}
                        title="Subtract from current selection"
                        onClick={() => applySaved(item, 'subtract')}
                      >
                        −
                      </button>
                      <button
                        type="button"
                        className="insp-selection-sources__saved-action"
                        aria-label={`Intersect ${item.name}`}
                        title="Intersect with current selection"
                        onClick={() => applySaved(item, 'intersect')}
                      >
                        ∩
                      </button>
                      <button
                        type="button"
                        className="insp-selection-sources__saved-action"
                        aria-label={`Rename ${item.name}`}
                        title="Rename saved selection"
                        onClick={() => beginRename(item)}
                      >
                        <Icon name="Pencil" size={13} />
                      </button>
                      <button
                        type="button"
                        className="insp-selection-sources__saved-action"
                        aria-label={`Duplicate ${item.name}`}
                        title="Duplicate saved selection"
                        onClick={() => duplicate(item)}
                      >
                        <Icon name="Copy" size={13} />
                      </button>
                      <button
                        type="button"
                        className="insp-selection-sources__saved-action"
                        aria-label={`Delete ${item.name}`}
                        title="Delete saved selection"
                        onClick={() => remove(item.id)}
                      >
                        <Icon name="Trash2" size={13} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </section>
        ) : (
          <p className="insp-selection-sources__empty">No saved selections yet.</p>
        )}
      </div>
    </DisclosureSection>
  );
}
