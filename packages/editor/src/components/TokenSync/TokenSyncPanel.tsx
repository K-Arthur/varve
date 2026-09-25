/**
 * TokenSyncPanel — compact Sync Center slice inside the layers panel
 * (ADR-0107/0108).
 *
 * Shows per-source status and a change summary derived from the persisted
 * sync state, and provides the guided import workflow: pick a file → parse
 * + validate → semantic preview → pick the destination source → apply as one
 * undoable document transaction.
 *
 * The reviewed preview holds the exact parsed document that Apply commits,
 * so bytes, revision, and document can never drift apart between preview and
 * apply, and cancelling releases everything at once. External files are
 * never written by this panel.
 */
import { Button, FilePickerButton, Select } from '@varve/ui';
import { useState } from 'react';
import { useEditor } from '../../context';
import { docVariableStore } from '../../docVariableStore';
import { exportTokensToDtcg } from '../../tokenSync/exportWorkflow';
import {
  buildImportPreview,
  defaultSourceChoice,
  detectDocumentKind,
  type ImportPreviewState,
  NEW_SOURCE_OPTION,
  type PreviewDiagnostic,
  planDocumentImport,
  resolveResolverPreview,
  sourceOptions,
} from '../../tokenSync/importWorkflow';
import {
  type ChangeSummary,
  changeSummary,
  sourceStatusRows,
  syncStatusLabel,
} from '../../tokenSync/tokenSyncSelectors';
import { SectionCollapseToggle } from '../SectionCollapseToggle';
import { usePersistedDisclosure } from '../usePersistedDisclosure';
import './TokenSyncPanel.css';

const MAX_VISIBLE_DIAGNOSTICS = 6;

interface PickedFile {
  name: string;
  size: number;
  lastModified: number;
  text: string;
}

export function TokenSyncPanel() {
  const { state, updateDoc, announce, beginTransaction, commitTransaction } = useEditor();
  const variableStore = docVariableStore(state.document);
  const sync = variableStore.tokenSync;
  const rows = sourceStatusRows(sync);
  const summary: ChangeSummary = changeSummary(sync);
  const [collapsed, setCollapsed] = usePersistedDisclosure('token-sync');
  const [preview, setPreview] = useState<ImportPreviewState | null>(null);
  const [siblings, setSiblings] = useState<ReadonlyMap<string, string>>(new Map());
  const [sourceChoice, setSourceChoice] = useState(NEW_SOURCE_OPTION);

  const handleFiles = (files: File[]) => {
    if (files.length === 0) return;
    void readPickedFiles(files)
      .then((picked) => {
        const primary = pickPrimaryFile(picked);
        const siblingTexts = new Map(
          picked.filter((f) => f !== primary).map((f) => [f.name, f.text]),
        );
        setSiblings(siblingTexts);
        const next = buildImportPreview(
          primary.text,
          { name: primary.name, size: primary.size, lastModified: primary.lastModified },
          sync,
          siblingTexts,
        );
        setPreview(next);
        setSourceChoice(defaultSourceChoice(sync, next.fileName));
      })
      .catch((error: unknown) => {
        setPreview({
          kind: 'invalid',
          fileName: files[0]?.name ?? 'token file',
          fileSize: 0,
          fileLastModified: 0,
          textHash: '',
          siblingCount: 0,
          parseDiagnostics: [],
          diagnostics: [
            {
              severity: 'error',
              code: 'file.unreadable',
              message: error instanceof Error ? error.message : 'The token file could not be read.',
            },
          ],
          added: 0,
          collisions: [],
        });
      });
  };

  const handleContextChange = (modifier: string, value: string) => {
    if (!preview?.resolver) return;
    setPreview(
      resolveResolverPreview(
        preview,
        { ...preview.resolverInput, [modifier]: value },
        sync,
        siblings,
      ),
    );
  };

  const resetPreview = () => {
    setPreview(null);
    setSiblings(new Map());
    setSourceChoice(NEW_SOURCE_OPTION);
  };

  const handleExport = () => {
    const result = exportTokensToDtcg(sync);
    if (result.tokenCount === 0) {
      announce(result.diagnostics[0]?.message ?? 'This document has no design tokens to export.');
      return;
    }
    const fileName = exportFileName(state.document.name);
    downloadTextFile(result.text, fileName);
    const blocking = result.diagnostics.filter((d) => d.severity !== 'info');
    const note = blocking.length > 0 ? `; ${blocking[0]?.message}` : '';
    announce(
      `Exported ${result.tokenCount} token(s) from ${result.groupCount} group(s) to ${fileName}${note}`,
    );
  };

  const applyPreview = () => {
    if (!preview?.document) return;
    const plan = planDocumentImport(state.document, preview, sourceChoice);
    if (!plan) {
      announce('Import failed: the reviewed file produced no importable tokens.');
      return;
    }
    if (plan.imported === 0) {
      const reason = `nothing to import — ${plan.skipped} matching token path(s) already exist in this document`;
      announce(`Import from ${preview.fileName}: ${reason}.`);
      setPreview({
        ...preview,
        diagnostics: [
          ...preview.diagnostics,
          { severity: 'info', code: 'import.noop', message: reason },
        ],
      });
      return;
    }
    // updateDoc's updater receives the same document object this handler
    // closed over (React flushes discrete events before the next one), so
    // the plan computed above is exactly what is committed. If that identity
    // ever fails, the updater refuses to clobber the newer document.
    beginTransaction();
    try {
      updateDoc((doc) =>
        doc === state.document ? { ...doc, variableStore: plan.variableStore } : doc,
      );
    } finally {
      commitTransaction();
    }
    const skipped = plan.skipped > 0 ? `, skipped ${plan.skipped} existing` : '';
    const target = plan.createdSource ? ' into a new source' : '';
    announce(`Imported ${plan.imported} tokens from ${preview.fileName}${target}${skipped}.`);
    resetPreview();
  };

  const errors = preview?.diagnostics.filter((d) => d.severity === 'error') ?? [];
  const warnings = preview?.diagnostics.filter((d) => d.severity === 'warning') ?? [];
  const visibleDiagnostics = keyDiagnostics(preview?.diagnostics ?? []);
  const canApply = Boolean(preview?.document && preview.added > 0);
  const destinationOptions = preview ? sourceOptions(sync, preview.fileName) : [];

  return (
    <section className="token-sync-panel" aria-label="Token Sync Center">
      <div className="token-sync-panel__header">
        <SectionCollapseToggle
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          label="Token Sync panel"
        />
        <h3 className="token-sync-panel__title">Token Sync</h3>
      </div>

      {!collapsed && (
        <div className="token-sync-panel__body">
          {rows.length === 0 ? (
            <p className="token-sync-panel__empty">
              No token sources yet. Import a DTCG token file below — a source is created for you.
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
            <FilePickerButton
              className="token-sync-panel__import"
              variant="secondary"
              accept=".tokens,.tokens.json,.resolver.json,.json"
              multiple
              actionLabel="Import DTCG file"
              inputLabel="Import DTCG token file"
              onFiles={handleFiles}
              onReject={(rejections) => announce(rejections[0]?.reason ?? 'Token file rejected.')}
            />
            <Button
              variant="secondary"
              size="sm"
              className="token-sync-panel__export"
              disabled={summary.total === 0}
              disabledReason="This document has no design tokens to export."
              onClick={handleExport}
            >
              Export DTCG file
            </Button>
          </div>

          {preview && (
            <fieldset className="token-sync-panel__preview">
              <legend className="varve-visually-hidden">Import preview</legend>
              <p className="token-sync-panel__preview-identity">
                <span className="token-sync-panel__preview-kind">
                  {preview.kind === 'resolver' ? 'Resolver document' : 'DTCG document'}
                </span>
                <span>
                  {preview.fileName} · revision {preview.textHash || 'unreadable'}
                </span>
              </p>

              {preview.diagnostics.length > 0 && (
                <ul className="token-sync-panel__diagnostics" aria-label="Import diagnostics">
                  {visibleDiagnostics.map((d) => (
                    <li
                      key={d.key}
                      className={`token-sync-diagnostic token-sync-diagnostic--${d.severity}`}
                    >
                      {d.code}: {d.message}
                    </li>
                  ))}
                  {preview.diagnostics.length > MAX_VISIBLE_DIAGNOSTICS && (
                    <li className="token-sync-diagnostic token-sync-diagnostic--info">
                      {preview.diagnostics.length - MAX_VISIBLE_DIAGNOSTICS} more diagnostic(s)
                    </li>
                  )}
                </ul>
              )}

              <p>
                {preview.added > 0
                  ? `${preview.added} tokens ready to import from ${preview.fileName}.`
                  : preview.document
                    ? `No new tokens to import from ${preview.fileName}.`
                    : `Resolve the ${errors.length} error(s) above to continue.`}
              </p>
              {preview.collisions.length > 0 && (
                <p>
                  {preview.collisions.length} existing token path(s) would be skipped:
                  {preview.collisions.slice(0, 3).join(', ')}
                  {preview.collisions.length > 3 ? '…' : ''}
                </p>
              )}

              {preview.kind === 'resolver' && preview.resolver && (
                <div className="token-sync-panel__contexts">
                  {Object.values(preview.resolver.modifiers).map((modifier) => {
                    const contexts = Object.keys(modifier.contexts);
                    if (contexts.length === 0) return null;
                    return (
                      <Select
                        key={modifier.name}
                        label={`Context: ${modifier.name}`}
                        value={preview.resolverInput?.[modifier.name] ?? ''}
                        options={contexts.map((c) => ({ value: c, label: c }))}
                        onValueChange={(value) => handleContextChange(modifier.name, value)}
                      />
                    );
                  })}
                  <p className="token-sync-panel__context-note">
                    Resolving one context at a time; permutations are never expanded eagerly.
                  </p>
                </div>
              )}

              {destinationOptions.length > 1 && (
                <Select
                  label="Destination source"
                  value={sourceChoice}
                  options={destinationOptions}
                  onValueChange={setSourceChoice}
                />
              )}

              <div className="token-sync-panel__preview-actions">
                <Button
                  variant="default"
                  size="sm"
                  className="token-sync-panel__apply"
                  disabled={!canApply}
                  disabledReason={
                    preview.added === 0
                      ? 'The preview has no new tokens to import.'
                      : errors.length > 0
                        ? 'The reviewed file has validation errors.'
                        : undefined
                  }
                  onClick={applyPreview}
                >
                  Apply import
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="token-sync-panel__cancel"
                  onClick={resetPreview}
                >
                  Cancel
                </Button>
              </div>
              {warnings.length > 0 && errors.length === 0 && (
                <p className="token-sync-panel__warning-count">
                  {warnings.length} warning(s) — the file still imports.
                </p>
              )}
            </fieldset>
          )}
        </div>
      )}
    </section>
  );
}

/** Canonical DTCG file name for the current document. */
function exportFileName(documentName: string): string {
  const safe = documentName.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${safe || 'tokens'}.tokens.json`;
}

/** Local-only download: no network, revoked immediately after the click. */
function downloadTextFile(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/design-tokens+json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/** Stable, index-free keys for the visible diagnostic rows. */
function keyDiagnostics(diagnostics: PreviewDiagnostic[]) {
  const counts = new Map<string, number>();
  return diagnostics.slice(0, MAX_VISIBLE_DIAGNOSTICS).map((d) => {
    const occurrence = (counts.get(d.code) ?? 0) + 1;
    counts.set(d.code, occurrence);
    return { ...d, key: `${d.code}#${occurrence}` };
  });
}

/** Prefer the resolver document when several files are picked together. */
export function pickPrimaryFile<T extends { name: string; text: string }>(files: T[]): T {
  const resolver = files.find((f) => detectDocumentKind(f.text, f.name) === 'resolver');
  return resolver ?? (files[0] as T);
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

async function readPickedFiles(files: File[]): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  for (const file of files) {
    out.push({
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      text: await readFileAsText(file),
    });
  }
  return out;
}
