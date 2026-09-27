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

import type { Document } from '@varve/scene';
import { JSON_MAX_BYTES } from '@varve/tokens';
import { Button, FilePickerButton, Select, ToggleButton } from '@varve/ui';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { docVariableStore } from '../../docVariableStore';
import { exportTokensToDtcg } from '../../tokenSync/exportWorkflow';
import {
  applyDocumentSync,
  buildImportPreview,
  type DocumentSyncPreview,
  defaultSourceChoice,
  detectDocumentKind,
  type ImportPreviewState,
  NEW_SOURCE_OPTION,
  type PreviewDiagnostic,
  previewDocumentSync,
  resolveResolverPreview,
  sourceOptions,
} from '../../tokenSync/importWorkflow';
import { LocalTokenForm, localTokenRuntimeNotice } from '../../tokenSync/LocalTokenForm';
import { createLocalToken } from '../../tokenSync/localCreation';
import {
  formatTokenValue,
  sourceContent,
  sourceTokenRows,
  validateSourceDraft,
} from '../../tokenSync/sourceWorkflow';
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

interface DocumentOwner {
  documentId: string;
  generation: number;
}

interface SourceDraftOwner extends DocumentOwner {
  sourceId: string;
}

interface PendingApplyConfirmation {
  reviewedDocument: Document;
  variableStore: ReturnType<typeof docVariableStore>;
  successMessage: string;
}

export function TokenSyncPanel() {
  const { state, updateDoc, announce, beginTransaction, commitTransaction } = useEditor();
  const variableStore = docVariableStore(state.document);
  const sync = variableStore.tokenSync;
  const rows = sourceStatusRows(sync);
  const summary: ChangeSummary = changeSummary(sync);
  const [collapsed, setCollapsed] = usePersistedDisclosure('token-sync');
  const [preview, setPreview] = useState<ImportPreviewState | null>(null);
  const [previewOwner, setPreviewOwner] = useState<DocumentOwner | null>(null);
  const [pendingApply, setPendingApply] = useState<PendingApplyConfirmation | null>(null);
  const [applyRejected, setApplyRejected] = useState(false);
  const [siblings, setSiblings] = useState<ReadonlyMap<string, string>>(new Map());
  const [readingFiles, setReadingFiles] = useState(false);
  const [sourceChoice, setSourceChoice] = useState(NEW_SOURCE_OPTION);
  const [resolutions, setResolutions] = useState<Record<string, 'local' | 'remote'>>({});
  const [activeSourceId, setActiveSourceId] = useState('');
  const [editingSource, setEditingSource] = useState(false);
  const [sourceDraftOwner, setSourceDraftOwner] = useState<SourceDraftOwner | null>(null);
  const [draft, setDraft] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  // A monotonically increasing document generation prevents a preview from
  // becoming current again if the user switches away and back to the same
  // document while a read is still pending.
  const documentIdRef = useRef(state.document.id);
  const documentGenerationRef = useRef(0);
  const readGenerationRef = useRef(0);
  const syncRef = useRef(sync);
  const currentOwner: DocumentOwner = {
    documentId: state.document.id,
    generation: documentGenerationRef.current,
  };
  const ownsCurrentDocument = (owner: DocumentOwner | null): boolean =>
    owner?.documentId === currentOwner.documentId && owner.generation === currentOwner.generation;
  const visiblePreview = ownsCurrentDocument(previewOwner) ? preview : null;

  const draftSource =
    sourceDraftOwner && ownsCurrentDocument(sourceDraftOwner)
      ? rows.find((row) => row.sourceId === sourceDraftOwner.sourceId)
      : undefined;
  const showSourceEditor = editingSource && Boolean(draftSource);

  useLayoutEffect(() => {
    syncRef.current = sync;
    if (documentIdRef.current === state.document.id) return;
    documentIdRef.current = state.document.id;
    documentGenerationRef.current += 1;
    readGenerationRef.current += 1;
    setPreview(null);
    setPreviewOwner(null);
    setApplyRejected(false);
    setSiblings(new Map());
    setReadingFiles(false);
    setSourceChoice(NEW_SOURCE_OPTION);
    setResolutions({});
    setActiveSourceId('');
    setEditingSource(false);
    setSourceDraftOwner(null);
    setDraft('');
    setEditError(null);
  }, [state.document.id, sync]);

  useLayoutEffect(
    () => () => {
      readGenerationRef.current += 1;
    },
    [],
  );

  // Falls back to the first source when the selection disappears (last source
  // removed, document swapped), so the detail view always resolves to a real
  // source instead of rendering a stale id.
  const activeSource = rows.find((row) => row.sourceId === activeSourceId) ?? rows[0];
  const sourceSelectOptions = rows.map((row) => ({ value: row.sourceId, label: row.name }));
  const activeTokens = activeSource ? sourceTokenRows(sync, activeSource.sourceId) : [];

  const syncPreview = useMemo(
    () =>
      visiblePreview
        ? previewDocumentSync(state.document, visiblePreview, sourceChoice, resolutions)
        : null,
    [visiblePreview, sourceChoice, resolutions, state.document],
  );

  const chooseSource = (value: string) => {
    setSourceChoice(value);
    setResolutions({});
  };

  const startEditSource = () => {
    if (!activeSource) return;
    readGenerationRef.current += 1;
    setReadingFiles(false);
    setPreview(null);
    setPreviewOwner(null);
    setSiblings(new Map());
    setResolutions({});
    setDraft(sourceContent(sync, activeSource.sourceId));
    setSourceDraftOwner({ ...currentOwner, sourceId: activeSource.sourceId });
    setEditError(null);
    setEditingSource(true);
  };

  const cancelEditSource = () => {
    readGenerationRef.current += 1;
    setReadingFiles(false);
    setEditingSource(false);
    setSourceDraftOwner(null);
    setEditError(null);
    setDraft('');
  };

  /** Validate edited content first; only a clean document becomes a preview. */
  const applySourceDraft = () => {
    if (!draftSource || !ownsCurrentDocument(sourceDraftOwner)) return;
    const targetSource = Object.values(sync?.store.sources ?? {}).find(
      (source) => source.id === draftSource.sourceId,
    );
    if (!targetSource) return;
    const result = validateSourceDraft(draft, targetSource.name, sync);
    if (!result.ok || !result.preview) {
      setEditError(result.message ?? `${targetSource.name} could not be read as tokens.`);
      return;
    }
    readGenerationRef.current += 1;
    setReadingFiles(false);
    setEditError(null);
    setEditingSource(false);
    setSourceDraftOwner(null);
    setDraft('');
    setPendingApply(null);
    setApplyRejected(false);
    setResolutions({});
    setSiblings(new Map());
    setSourceChoice(draftSource.sourceId);
    setPreview(result.preview);
    setPreviewOwner(currentOwner);
  };

  const handleFiles = (files: File[]) => {
    if (files.length === 0) return;
    readGenerationRef.current += 1;
    const requestGeneration = readGenerationRef.current;
    const requestOwner = currentOwner;
    setPreview(null);
    setPreviewOwner(null);
    setPendingApply(null);
    setApplyRejected(false);
    setSiblings(new Map());
    setSourceChoice(NEW_SOURCE_OPTION);
    setResolutions({});
    setEditingSource(false);
    setSourceDraftOwner(null);
    setDraft('');
    setEditError(null);
    setReadingFiles(true);

    const requestIsCurrent = () =>
      requestGeneration === readGenerationRef.current &&
      requestOwner.documentId === documentIdRef.current &&
      requestOwner.generation === documentGenerationRef.current;

    const duplicateName = duplicatePickedFileName(files);
    if (duplicateName) {
      setReadingFiles(false);
      setPreview({
        kind: 'invalid',
        fileName: duplicateName,
        fileSize: 0,
        fileLastModified: 0,
        textHash: '',
        siblingCount: 0,
        parseDiagnostics: [],
        diagnostics: [
          {
            severity: 'error',
            code: 'file.duplicate-name',
            message: `More than one selected file is named “${duplicateName}”. Choose files with unique names because resolver references cannot distinguish same-name files.`,
          },
        ],
        added: 0,
        collisions: [],
      });
      setPreviewOwner(requestOwner);
      return;
    }

    void readPickedFiles(files)
      .then((picked) => {
        if (!requestIsCurrent()) return;
        const primary = pickPrimaryFile(picked);
        const siblingTexts = new Map(
          picked.filter((f) => f !== primary).map((f) => [f.name, f.text]),
        );
        setSiblings(siblingTexts);
        const next = buildImportPreview(
          primary.text,
          { name: primary.name, size: primary.size, lastModified: primary.lastModified },
          syncRef.current,
          siblingTexts,
        );
        setPreview(next);
        setPreviewOwner(requestOwner);
        setReadingFiles(false);
        setSourceChoice(defaultSourceChoice(syncRef.current, next.fileName));
        setResolutions({});
      })
      .catch((error: unknown) => {
        if (!requestIsCurrent()) return;
        setResolutions({});
        setReadingFiles(false);
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
        setPreviewOwner(requestOwner);
      });
  };

  const handleContextChange = (modifier: string, value: string) => {
    if (!visiblePreview?.resolver) return;
    setResolutions({});
    setPreview(
      resolveResolverPreview(
        visiblePreview,
        { ...visiblePreview.resolverInput, [modifier]: value },
        sync,
        siblings,
      ),
    );
  };

  const resetPreview = () => {
    readGenerationRef.current += 1;
    setReadingFiles(false);
    setPreview(null);
    setPreviewOwner(null);
    setPendingApply(null);
    setApplyRejected(false);
    setSiblings(new Map());
    setSourceChoice(NEW_SOURCE_OPTION);
    setResolutions({});
  };

  useLayoutEffect(() => {
    if (!pendingApply || state.document === pendingApply.reviewedDocument) return;
    setPendingApply(null);
    if (docVariableStore(state.document) === pendingApply.variableStore) {
      announce(pendingApply.successMessage);
      resetPreview();
      return;
    }
    setApplyRejected(true);
    setPreview((current) =>
      current
        ? {
            ...current,
            diagnostics: [
              ...current.diagnostics,
              {
                severity: 'error',
                code: 'import.stale-document',
                message:
                  'The document changed while this update was being applied. Review the preview again before retrying.',
              },
            ],
          }
        : current,
    );
    announce(
      'Token sync was not applied because the document changed during the update. Review the preview again before retrying.',
    );
  }, [pendingApply, state.document, announce]);

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
    if (!visiblePreview?.document || !syncPreview) return;
    if (!syncPreview.valid) {
      announce('Resolve the remaining token conflicts before applying.');
      return;
    }
    const changeCount = syncPreview.added + syncPreview.updated + syncPreview.deleted;
    if (changeCount === 0) {
      const reason = syncPreview.update
        ? 'the source and this document match'
        : `nothing to import — ${syncPreview.skipped} matching token path(s) already exist in this document`;
      announce(`Sync from ${visiblePreview.fileName}: ${reason}.`);
      setPreview({
        ...visiblePreview,
        diagnostics: [
          ...visiblePreview.diagnostics,
          { severity: 'info', code: 'import.noop', message: reason },
        ],
      });
      return;
    }

    const reviewedDocument = state.document;
    const applied = applyDocumentSync(reviewedDocument, visiblePreview, sourceChoice, resolutions);
    if (!applied) {
      announce('Sync failed: the reviewed file could not be applied.');
      return;
    }
    const parts = applied.update
      ? [
          syncPreview.added > 0 ? `${syncPreview.added} added` : '',
          syncPreview.updated > 0 ? `${syncPreview.updated} updated` : '',
          syncPreview.deleted > 0 ? `${syncPreview.deleted} deleted` : '',
        ].filter(Boolean)
      : [];
    const skipped = applied.skipped > 0 ? `, skipped ${applied.skipped} existing` : '';
    const target = applied.createdSource ? ' into a new source' : '';
    const successMessage = applied.update
      ? `Updated ${visiblePreview.fileName}: ${parts.join(', ')}.`
      : `Imported ${applied.applied} tokens from ${visiblePreview.fileName}${target}${skipped}.`;
    beginTransaction();
    try {
      updateDoc((doc) =>
        doc === reviewedDocument ? { ...doc, variableStore: applied.variableStore } : doc,
      );
    } finally {
      commitTransaction();
    }
    setPendingApply({
      reviewedDocument,
      variableStore: applied.variableStore,
      successMessage,
    });
  };

  const errors = visiblePreview?.diagnostics.filter((d) => d.severity === 'error') ?? [];
  const warnings = visiblePreview?.diagnostics.filter((d) => d.severity === 'warning') ?? [];
  const combinedDiagnostics = [
    ...(visiblePreview?.diagnostics ?? []),
    ...(syncPreview?.diagnostics ?? []),
  ];
  const visibleDiagnostics = keyDiagnostics(combinedDiagnostics);
  const changeCount = syncPreview
    ? syncPreview.added + syncPreview.updated + syncPreview.deleted
    : 0;
  const canApply = Boolean(
    !pendingApply &&
      !applyRejected &&
      visiblePreview?.document &&
      syncPreview?.valid &&
      changeCount > 0,
  );
  const destinationOptions = visiblePreview ? sourceOptions(sync, visiblePreview.fileName) : [];

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

          {rows.length > 0 && activeSource && (
            <>
              <div className="token-sync-panel__source-picker">
                <Select
                  label="Source"
                  value={activeSource.sourceId}
                  options={sourceSelectOptions}
                  onValueChange={setActiveSourceId}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  className="token-sync-panel__edit-source"
                  onClick={startEditSource}
                >
                  Edit source content
                </Button>
              </div>

              <div className="token-sync-panel__detail">
                <div className="token-sync-panel__detail-head">
                  <span className="token-sync-panel__detail-name">{activeSource.name}</span>
                  <span className={`token-sync-status token-sync-status--${activeSource.status}`}>
                    {syncStatusLabel(activeSource.status)}
                  </span>
                  <span>{activeSource.tokenCount} tokens</span>
                </div>
                <ul
                  className="token-sync-panel__tokens"
                  aria-label={`Tokens in ${activeSource.name}`}
                >
                  {activeTokens.length === 0 ? (
                    <li className="token-sync-panel__tokens-empty">
                      This source owns no tokens yet.
                    </li>
                  ) : (
                    activeTokens.map((token) => (
                      <li key={token.path} className="token-sync-panel__token">
                        <code className="token-sync-panel__token-path">{token.path}</code>
                        <span className="token-sync-panel__token-type">{token.type}</span>
                        <span className="token-sync-panel__token-value">{token.value}</span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </>
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

          <LocalTokenForm
            tokens={Object.values(sync?.store.tokens ?? {}).map((token) => ({
              path: token.path.join('.'),
              type: token.type,
              value: token.value,
            }))}
            onCreate={(draft) => {
              // Compute first: a validation error never opens a transaction.
              const next = createLocalToken(docVariableStore(state.document), draft);
              resetPreview();
              beginTransaction();
              updateDoc((document) => ({ ...document, variableStore: next }));
              commitTransaction();
              const referenceToken = draft.reference
                ? Object.values(sync?.store.tokens ?? {}).find(
                    (token) => token.path.join('.') === draft.reference,
                  )
                : undefined;
              const notice = localTokenRuntimeNotice(draft, referenceToken?.value);
              announce(
                notice
                  ? `Created local token ${draft.path}. ${notice}`
                  : `Created local token ${draft.path}.`,
              );
            }}
          />

          {readingFiles && (
            <div className="token-sync-panel__preview-actions" role="status">
              <span>Reading selected token files…</span>
              <Button
                variant="ghost"
                size="sm"
                className="token-sync-panel__cancel"
                onClick={resetPreview}
              >
                Cancel read
              </Button>
            </div>
          )}

          {showSourceEditor && draftSource && (
            <div className="token-sync-panel__editor">
              <label className="token-sync-panel__editor-label" htmlFor="token-source-content">
                {`Source content: ${draftSource.name}`}
              </label>
              <textarea
                id="token-source-content"
                className="token-sync-panel__editor-textarea"
                value={draft}
                rows={8}
                spellCheck={false}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setEditError(null);
                }}
              />
              {editError && (
                <p className="token-sync-panel__edit-error" role="alert">
                  {editError} — nothing was changed.
                </p>
              )}
              <div className="token-sync-panel__preview-actions">
                <Button
                  variant="default"
                  size="sm"
                  className="token-sync-panel__validate"
                  onClick={applySourceDraft}
                >
                  Validate and preview
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="token-sync-panel__cancel"
                  onClick={cancelEditSource}
                >
                  Cancel edit
                </Button>
              </div>
              <p className="token-sync-panel__context-note">
                Editing validates the whole document before anything is applied — content that is
                not valid DTCG is rejected with a notice, and your tokens stay as they are.
              </p>
            </div>
          )}

          {visiblePreview && (
            <fieldset className="token-sync-panel__preview">
              <legend className="varve-visually-hidden">Import preview</legend>
              <p className="token-sync-panel__preview-identity">
                <span className="token-sync-panel__preview-kind">
                  {visiblePreview.kind === 'resolver' ? 'Resolver document' : 'DTCG document'}
                </span>
                <span>
                  {visiblePreview.fileName} · revision {visiblePreview.textHash || 'unreadable'}
                </span>
              </p>

              {combinedDiagnostics.length > 0 && (
                <ul className="token-sync-panel__diagnostics" aria-label="Import diagnostics">
                  {visibleDiagnostics.map((d) => (
                    <li
                      key={d.key}
                      className={`token-sync-diagnostic token-sync-diagnostic--${d.severity}`}
                    >
                      {d.code}: {d.message}
                      {d.line !== undefined && ` (line ${d.line}, column ${d.column ?? 1})`}
                    </li>
                  ))}
                  {combinedDiagnostics.length > MAX_VISIBLE_DIAGNOSTICS && (
                    <li className="token-sync-diagnostic token-sync-diagnostic--info">
                      {combinedDiagnostics.length - MAX_VISIBLE_DIAGNOSTICS} more diagnostic(s)
                    </li>
                  )}
                </ul>
              )}

              <p>
                {!visiblePreview.document
                  ? `Resolve the ${errors.length} error(s) above to continue.`
                  : syncPreview?.update
                    ? describeUpdate(syncPreview, visiblePreview.fileName)
                    : visiblePreview.added > 0
                      ? `${visiblePreview.added} tokens ready to import from ${visiblePreview.fileName}.`
                      : `No new tokens to import from ${visiblePreview.fileName}.`}
              </p>
              {!syncPreview?.update && visiblePreview.collisions.length > 0 && (
                <p>
                  {visiblePreview.collisions.length} existing token path(s) would be skipped:
                  {visiblePreview.collisions.slice(0, 3).join(', ')}
                  {visiblePreview.collisions.length > 3 ? '…' : ''}
                </p>
              )}

              {syncPreview?.update && syncPreview.conflicts.length > 0 && (
                <fieldset className="token-sync-panel__conflicts">
                  <legend className="varve-visually-hidden">Unresolved token conflicts</legend>
                  <p>
                    {syncPreview.conflicts.length} token(s) changed on both sides — choose a value
                    for each:
                  </p>
                  <ul className="token-sync-panel__conflict-list">
                    {syncPreview.conflicts.map((conflict) => {
                      const label = conflict.path.join('.');
                      return (
                        <li key={conflict.key} className="token-sync-panel__conflict">
                          <code className="token-sync-panel__conflict-path">{label}</code>
                          {conflict.localDeleted || conflict.remoteDeleted ? (
                            <p className="token-sync-panel__conflict-note">
                              {conflict.localDeleted
                                ? 'Deleted in Varve, edited in the source.'
                                : 'Edited in Varve, deleted in the source.'}
                            </p>
                          ) : (
                            <dl className="token-sync-panel__conflict-values">
                              <div>
                                <dt>Varve</dt>
                                <dd>{formatTokenValue(conflict.local.value)}</dd>
                              </div>
                              <div>
                                <dt>Source</dt>
                                <dd>{formatTokenValue(conflict.remote.value)}</dd>
                              </div>
                            </dl>
                          )}
                          <fieldset className="token-sync-panel__conflict-choice">
                            <legend className="varve-visually-hidden">
                              {`Resolution for ${label}`}
                            </legend>
                            <ToggleButton
                              size="sm"
                              label={`Keep Varve value for ${label}`}
                              pressed={resolutions[conflict.key] === 'local'}
                              onPressedChange={() =>
                                setResolutions((current) => ({
                                  ...current,
                                  [conflict.key]: 'local',
                                }))
                              }
                            >
                              Keep Varve
                            </ToggleButton>
                            <ToggleButton
                              size="sm"
                              label={`Use source value for ${label}`}
                              pressed={resolutions[conflict.key] === 'remote'}
                              onPressedChange={() =>
                                setResolutions((current) => ({
                                  ...current,
                                  [conflict.key]: 'remote',
                                }))
                              }
                            >
                              Use source
                            </ToggleButton>
                          </fieldset>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              )}

              {visiblePreview.kind === 'resolver' && visiblePreview.resolver && (
                <div className="token-sync-panel__contexts">
                  {Object.values(visiblePreview.resolver.modifiers).map((modifier) => {
                    const contexts = Object.keys(modifier.contexts);
                    if (contexts.length === 0) return null;
                    return (
                      <Select
                        key={modifier.name}
                        label={`Context: ${modifier.name}`}
                        value={visiblePreview.resolverInput?.[modifier.name] ?? ''}
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
                  onValueChange={chooseSource}
                />
              )}

              <div className="token-sync-panel__preview-actions">
                <Button
                  variant="default"
                  size="sm"
                  className="token-sync-panel__apply"
                  disabled={!canApply}
                  disabledReason={
                    syncPreview?.update && syncPreview.conflicts.length > 0
                      ? 'Resolve the conflicting tokens before applying.'
                      : errors.length > 0
                        ? 'The reviewed file has validation errors.'
                        : changeCount === 0
                          ? syncPreview?.update
                            ? 'The source already matches this document.'
                            : 'The preview has no new tokens to import.'
                          : undefined
                  }
                  onClick={applyPreview}
                >
                  {syncPreview?.update ? 'Apply update' : 'Apply import'}
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

/** One-line description of a three-way update preview. */
function describeUpdate(summary: DocumentSyncPreview, fileName: string): string {
  if (!summary.valid) {
    return `${summary.conflicts.length} conflict(s) from ${fileName} need a decision.`;
  }
  const parts = [
    summary.added > 0 ? `${summary.added} new` : '',
    summary.updated > 0 ? `${summary.updated} updated` : '',
    summary.deleted > 0 ? `${summary.deleted} deleted` : '',
  ].filter(Boolean);
  if (parts.length === 0)
    return `${fileName} matches this document (${summary.unchanged} unchanged).`;
  return `${parts.join(', ')} from ${fileName}.`;
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

function duplicatePickedFileName(files: Array<{ name: string }>): string | null {
  const names = new Set<string>();
  for (const file of files) {
    if (names.has(file.name)) return file.name;
    names.add(file.name);
  }
  return null;
}

async function readPickedFiles(files: File[]): Promise<PickedFile[]> {
  if (files.length > 256) throw new Error('Select at most 256 token source files at once.');
  if (files.reduce((bytes, file) => bytes + file.size, 0) > 64 * 1024 * 1024) {
    throw new Error('The selected token source files exceed the 64 MB total limit.');
  }
  if (files.some((file) => file.size > JSON_MAX_BYTES)) {
    throw new Error('Each token source file must be at most 16 MB.');
  }
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
