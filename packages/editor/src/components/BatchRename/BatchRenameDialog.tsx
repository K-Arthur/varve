import type { NodeId } from '@strata/scene';
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

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [open, onClose]);

  const canRename = changedCount > 0 && (!useRegex || !regexError);

  const handleRename = useCallback(() => {
    if (!canRename) return;

    const nodeIds = changedPreviews.map((p) => p.nodeId);
    updateDoc((doc) => applyBatchRename(doc, nodeIds, options));
    setAnnounceMsg(`Renamed ${changedCount} layer${changedCount !== 1 ? 's' : ''}`);
    onClose();
  }, [canRename, changedPreviews, options, updateDoc, changedCount, onClose]);

  if (!open) return null;

  return (
    <div
      className="batch-rename-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Batch Rename"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="batch-rename-dialog">
        <div className="batch-rename-dialog__header">
          <h2 className="batch-rename-dialog__title">Batch Rename</h2>
          <button
            type="button"
            className="batch-rename-dialog__close"
            aria-label="Close"
            onClick={onClose}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="batch-rename-dialog__body">
          <div className="batch-rename-dialog__section">
            <label className="batch-rename-dialog__label" htmlFor="batch-rename-find">
              Find
            </label>
            <input
              id="batch-rename-find"
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
            <label className="batch-rename-dialog__checkbox">
              <input
                type="checkbox"
                checked={useRegex}
                onChange={(e) => setUseRegex(e.target.checked)}
              />
              <span>Regex</span>
            </label>
            <label className="batch-rename-dialog__checkbox">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
              />
              <span>Case sensitive</span>
            </label>
            <label className="batch-rename-dialog__checkbox">
              <input
                type="checkbox"
                checked={wholeWord}
                onChange={(e) => setWholeWord(e.target.checked)}
              />
              <span>Whole word</span>
            </label>
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
                  <span className="batch-rename-dialog__preview-old" title={p.originalName}>
                    {p.originalName}
                  </span>
                  {p.changed && (
                    <>
                      <span className="batch-rename-dialog__preview-arrow" aria-hidden="true">
                        {'\u2192'}
                      </span>
                      <span className="batch-rename-dialog__preview-new" title={p.newName}>
                        {p.newName}
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="batch-rename-dialog__footer">
          <button
            type="button"
            className="batch-rename-dialog__btn batch-rename-dialog__btn--secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="batch-rename-dialog__btn batch-rename-dialog__btn--primary"
            disabled={!canRename}
            onClick={handleRename}
          >
            Rename{changedCount > 0 ? ` All (${changedCount})` : ''}
          </button>
        </div>

        <div role="status" aria-live="polite" className="strata-visually-hidden">
          {announceMsg}
        </div>
      </div>
    </div>
  );
}
