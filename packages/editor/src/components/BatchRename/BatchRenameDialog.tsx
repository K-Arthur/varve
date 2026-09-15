import type { NodeId } from '@varve/scene';
import { Button, Dialog, Switch, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEditor } from '../../context';
import {
  applyBatchRename,
  type BatchRenameOptions,
  type BatchRenamePreview,
  computeBatchRenamePreview,
  validateRegex,
} from './batchRename';
import './BatchRename.css';

export interface BatchRenameDialogProps {
  open: boolean;
  onClose: () => void;
  scopeNodeIds?: NodeId[];
  allNodeNames: Array<{ nodeId: string; name: string }>;
  defaultAll?: boolean;
}

export function BatchRenameDialog({
  open,
  onClose,
  scopeNodeIds,
  allNodeNames,
  defaultAll,
}: BatchRenameDialogProps) {
  const { updateDoc } = useEditor();
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [scopeAll, setScopeAll] = useState(defaultAll ?? false);
  const [regexError, setRegexError] = useState<string | null>(null);
  const [announceMsg, setAnnounceMsg] = useState('');

  const effectiveNodeNames = useMemo(() => {
    if (scopeAll) return allNodeNames;
    if (!scopeNodeIds || scopeNodeIds.length === 0) return allNodeNames;
    const scopeSet = new Set(scopeNodeIds);
    return allNodeNames.filter((n) => scopeSet.has(n.nodeId));
  }, [scopeAll, scopeNodeIds, allNodeNames]);

  const options: BatchRenameOptions = useMemo(
    () => ({ find, replace, useRegex, caseSensitive, wholeWord }),
    [find, replace, useRegex, caseSensitive, wholeWord],
  );

  const previews: BatchRenamePreview[] = useMemo(
    () => computeBatchRenamePreview(effectiveNodeNames, options),
    [effectiveNodeNames, options],
  );

  const changedPreviews = useMemo(() => previews.filter((p) => p.changed), [previews]);
  const changedCount = changedPreviews.length;

  const handleFindChange = useCallback(
    (value: string) => {
      setFind(value);
      if (useRegex && value) {
        setRegexError(validateRegex(value));
      } else {
        setRegexError(null);
      }
    },
    [useRegex],
  );

  useEffect(() => {
    if (useRegex && find) {
      setRegexError(validateRegex(find));
    } else {
      setRegexError(null);
    }
  }, [useRegex, find]);

  useEffect(() => {
    if (!open) return;
    setFind('');
    setReplace('');
    setUseRegex(false);
    setCaseSensitive(false);
    setWholeWord(false);
    setScopeAll(defaultAll ?? false);
    setRegexError(null);
    setAnnounceMsg('');
  }, [open, defaultAll]);

  const canRename = changedCount > 0 && (!useRegex || !regexError);

  const handleRename = useCallback(() => {
    if (!canRename) return;

    const nodeIds = changedPreviews.map((p) => p.nodeId);
    updateDoc((doc) => applyBatchRename(doc, nodeIds, options));
    setAnnounceMsg(`Renamed ${changedCount} layer${changedCount !== 1 ? 's' : ''}`);
    onClose();
  }, [canRename, changedPreviews, options, updateDoc, changedCount, onClose]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Batch Rename"
      // The rename pattern is the reason the dialog was opened; land focus
      // there instead of on the header Close button.
      focusFirstControl
      footer={
        <div className="batch-rename-dialog__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" onClick={handleRename} disabled={!canRename}>
            Rename{changedCount > 0 ? ` All (${changedCount})` : ''}
          </Button>
        </div>
      }
    >
      <div className="batch-rename-dialog__body">
        <div className="batch-rename-dialog__section">
          <label className="batch-rename-dialog__label" htmlFor="batch-rename-find">
            Find
          </label>
          <input
            id="batch-rename-find"
            data-autofocus
            className={`batch-rename-dialog__input${regexError ? ' batch-rename-dialog__input--error' : ''}`}
            type="text"
            value={find}
            onChange={(e) => handleFindChange(e.target.value)}
            placeholder="Text to find\u2026"
          />
          {regexError && (
            <div className="batch-rename-dialog__error" role="alert">
              {regexError}
            </div>
          )}
        </div>

        <div className="batch-rename-dialog__section">
          <label className="batch-rename-dialog__label" htmlFor="batch-rename-replace">
            Replace
          </label>
          <input
            id="batch-rename-replace"
            className="batch-rename-dialog__input"
            type="text"
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
            placeholder="Replacement text\u2026"
          />
        </div>

        <div className="batch-rename-dialog__toggles">
          <Switch
            className="batch-rename-dialog__checkbox"
            label="Regex"
            checked={useRegex}
            onChange={(e) => setUseRegex(e.target.checked)}
          />
          <Switch
            className="batch-rename-dialog__checkbox"
            label="Case sensitive"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
          />
          <Switch
            className="batch-rename-dialog__checkbox"
            label="Whole word"
            checked={wholeWord}
            onChange={(e) => setWholeWord(e.target.checked)}
          />
        </div>

        {scopeNodeIds && scopeNodeIds.length > 0 && (
          <div className="batch-rename-dialog__section">
            <span className="batch-rename-dialog__label">Scope</span>
            <div className="batch-rename-dialog__scope">
              <label>
                <input
                  type="radio"
                  name="batch-rename-scope"
                  checked={!scopeAll}
                  onChange={() => setScopeAll(false)}
                />
                <span>Selection ({scopeNodeIds.length})</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="batch-rename-scope"
                  checked={scopeAll}
                  onChange={() => setScopeAll(true)}
                />
                <span>All layers ({allNodeNames.length})</span>
              </label>
            </div>
          </div>
        )}

        <div className="batch-rename-dialog__match-count">
          <strong className={changedCount > 0 ? 'changed' : ''}>{changedCount}</strong> match
          {changedCount !== 1 ? 'es' : ''} in <strong>{effectiveNodeNames.length}</strong> layer
          {effectiveNodeNames.length !== 1 ? 's' : ''}
        </div>

        {previews.length > 0 && (
          <ul className="batch-rename-dialog__preview" aria-label="Rename preview">
            {previews.map((p) => (
              <li
                key={p.nodeId}
                className={`batch-rename-dialog__preview-item${!p.changed ? ' batch-rename-dialog__preview-item--unchanged' : ''}`}
              >
                {p.changed && (
                  <span className="batch-rename-dialog__preview-icon" aria-hidden="true">
                    {'\u279C'}
                  </span>
                )}
                <Tooltip label={p.originalName} truncationOnly>
                  <span className="batch-rename-dialog__preview-old">{p.originalName}</span>
                </Tooltip>
                {p.changed && (
                  <>
                    <span className="batch-rename-dialog__preview-arrow" aria-hidden="true">
                      {'\u2192'}
                    </span>
                    <Tooltip label={p.newName} truncationOnly>
                      <span className="batch-rename-dialog__preview-new">{p.newName}</span>
                    </Tooltip>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div role="status" aria-live="polite" className="varve-visually-hidden">
        {announceMsg}
      </div>
    </Dialog>
  );
}
