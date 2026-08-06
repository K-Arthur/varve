/**
 * TokenSyncPanel — compact Sync Center slice inside the layers panel
 * (ADR-0107/0108).
 *
 * Shows per-source status and a change summary derived from the persisted
 * sync state, and provides the guided "Import DTCG file" workflow:
 * pick a file → parse+validate → semantic preview → apply as one undoable
 * document transaction. Nothing applies automatically; external files are
 * never written by this panel.
 */

import { applyImportToSync, previewImport } from '@varve/scene/tokens';
import { parseFormatDocument } from '@varve/tokens';
import { useRef, useState } from 'react';
import { useEditor } from '../../context';
import { docVariableStore } from '../../docVariableStore';
import {
  type ChangeSummary,
  changeSummary,
  sourceStatusRows,
  syncStatusLabel,
} from '../../tokenSync/tokenSyncSelectors';
import './TokenSyncPanel.css';

interface ImportPreviewState {
  added: number;
  collisions: string[];
  diagnostics: string[];
  fileId: string;
}

export function TokenSyncPanel() {
  const { state, updateDoc, announce } = useEditor();
  const variableStore = docVariableStore(state.document);
  const sync = variableStore.tokenSync;
  const rows = sourceStatusRows(sync);
  const summary: ChangeSummary = changeSummary(sync);
  const [collapsed, setCollapsed] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewState | null>(null);
  const [applying, setApplying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    void readFileAsText(file).then((text) => {
      cachePreviewFile(file.name, text);
      setPreview(buildImportPreview(text, file.name, sync));
    });
  };

  const applyPreview = () => {
    if (!preview || !sync) return;
    const sourceId = Object.keys(sync.store.sources)[0] as `src_${string}` | undefined;
    if (!sourceId) {
      setPreview({
        ...preview,
        diagnostics: [...preview.diagnostics, 'No token source connected'],
      });
      return;
    }
    const cached = previewFileCache.get(preview.fileId);
    if (cached === undefined) return;
    setApplying(true);
    try {
      updateDoc((doc) => {
        const store = docVariableStore(doc);
        if (!store.tokenSync) return doc;
        const document = parseFormatDocument(cached, { sourceFileId: preview.fileId });
        const result = applyImportToSync(
          store.tokenSync,
          store,
          previewImport(store.tokenSync.store, document),
          sourceId,
          '2025.10',
          'dtcg-2025.10',
        );
        return {
          ...doc,
          variableStore: {
            ...store,
            tokenSync: result.sync,
            variables: result.variables?.variables ?? store.variables,
            collections: result.variables?.collections ?? store.collections,
          },
        };
      });
      announce(`Imported design tokens from ${preview.fileId}`);
      resetPreview();
    } finally {
      setApplying(false);
    }
  };

  const resetPreview = () => {
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <section className="token-sync-panel" aria-label="Token Sync Center">
      <div className="token-sync-panel__header">
        <h2 className="token-sync-panel__title">Token Sync</h2>
        <button
          type="button"
          className="token-sync-panel__collapse"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand Token Sync panel' : 'Collapse Token Sync panel'}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>

      {!collapsed && (
        <div className="token-sync-panel__body">
          {rows.length === 0 ? (
            <p className="token-sync-panel__empty">
              No token sources connected. Import a DTCG token file to begin.
            </p>
          ) : (
            <ul className="token-sync-panel__sources" aria-label="Connected token sources">
              {rows.map((row) => (
                <li key={row.sourceId} className="token-sync-panel__source">
                  <div className="token-sync-panel__source-name">{row.name}</div>
                  <div className="token-sync-panel__source-meta">
                    <span className={`token-sync-status token-sync-status--${row.status}`}>
                      {syncStatusLabel(row.status)}
                    </span>
                    <span>
                      {row.tokenCount} tokens, {row.locallyModifiedCount} modified
                    </span>
                    {row.conflictCount > 0 && (
                      <span className="token-sync-panel__conflict-count">
                        {row.conflictCount} conflicts
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="token-sync-panel__summary" aria-live="polite">
            <span>{summary.total} tokens</span>
            <span>{summary.locallyModified} local changes</span>
            {summary.conflicted > 0 && <span>{summary.conflicted} conflicted</span>}
          </div>

          <div className="token-sync-panel__actions">
            <input
              ref={fileInputRef}
              type="file"
              accept=".tokens,.tokens.json,.resolver.json,.json"
              className="token-sync-panel__file-input"
              aria-label="Import DTCG token file"
              onChange={(event) => handleFile(event.target.files?.[0])}
            />
            <button
              type="button"
              className="token-sync-panel__import"
              onClick={() => fileInputRef.current?.click()}
            >
              Import DTCG file
            </button>
          </div>

          {preview && (
            <fieldset className="token-sync-panel__preview">
              <legend className="varve-visually-hidden">Import preview</legend>
              {preview.diagnostics.length > 0 && (
                <ul className="token-sync-panel__diagnostics">
                  {preview.diagnostics.slice(0, 5).map((message, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: diagnostics are stateless strings; duplicate messages would collide as content keys
                    <li key={`${index}-${message}`}>{message}</li>
                  ))}
                </ul>
              )}
              <p>
                {preview.added > 0
                  ? `${preview.added} tokens ready to import from ${preview.fileId}.`
                  : `No new tokens to import from ${preview.fileId}.`}
              </p>
              {preview.collisions.length > 0 && (
                <p>
                  {preview.collisions.length} existing token path(s) would be skipped:
                  {preview.collisions.slice(0, 3).join(', ')}
                  {preview.collisions.length > 3 ? '…' : ''}
                </p>
              )}
              <div className="token-sync-panel__preview-actions">
                <button
                  type="button"
                  className="token-sync-panel__apply"
                  disabled={applying || preview.added === 0}
                  onClick={applyPreview}
                >
                  {applying ? 'Applying…' : 'Apply import'}
                </button>
                <button type="button" className="token-sync-panel__cancel" onClick={resetPreview}>
                  Cancel
                </button>
              </div>
            </fieldset>
          )}
        </div>
      )}
    </section>
  );
}

/** Retains the last parsed file text for the apply step (per session). */
const previewFileCache = new Map<string, string>();
export function cachePreviewFile(fileId: string, text: string): void {
  previewFileCache.set(fileId, text);
}

/**
 * Pure import-preview builder: parse → validate → compare against the
 * store. Deterministic; never applies anything.
 */
export function buildImportPreview(
  text: string,
  fileId: string,
  sync: ReturnType<typeof docVariableStore>['tokenSync'] | undefined,
): ImportPreviewState {
  const document = parseFormatDocument(text, { sourceFileId: fileId });
  const errors = document.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) {
    return {
      added: 0,
      collisions: [],
      diagnostics: errors.map((e) => `${e.code}: ${e.message}`),
      fileId,
    };
  }
  if (!sync) {
    return { added: 0, collisions: [], diagnostics: ['No token source connected yet'], fileId };
  }
  const p = previewImport(sync.store, document);
  return {
    added: p.added,
    collisions: p.collisions,
    diagnostics: document.diagnostics
      .filter((d) => d.severity === 'warning')
      .map((d) => `${d.code}: ${d.message}`),
    fileId,
  };
}

/** File.text() with a FileReader fallback (jsdom lacks .text()). */
export function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsText(file);
  });
}
