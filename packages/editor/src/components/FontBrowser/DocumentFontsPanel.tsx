import { getFontRegistry } from '@varve/engine';
import {
  createFontCatalogFromRegistry,
  type FontReference,
  type FontReplacement,
} from '@varve/engine/font';
import type { Document } from '@varve/scene';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../context';
import {
  applyFontReplacement,
  findRestorableFontReplacement,
  restoreFontReplacement,
} from './applyFontReplacement';
import { buildDocumentFontUsage, type DocumentFontUsage } from './documentFontUsage';
import { FontBrowser } from './FontBrowser';
import { FontBrowserDialog } from './FontBrowserDialog';
import './DocumentFontsPanel.css';

type Scope = 'page' | 'document';

type DocumentSurface = {
  id: string;
  rootId: string;
  name: string;
  kind: 'page' | 'canvas';
};

function childIds(node: unknown): string[] {
  const children = (node as { children?: unknown } | null)?.children;
  return Array.isArray(children)
    ? children.filter((child): child is string => typeof child === 'string')
    : [];
}

function containsNode(document: Document, rootId: string, targetId: string): boolean {
  const pending = [rootId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    if (current === targetId) return true;
    visited.add(current);
    const node = document.nodes[current];
    for (const child of childIds(node)) pending.push(child);
  }
  return false;
}

function surfaceForNode(document: Document, nodeId: string): DocumentSurface | undefined {
  for (const page of document.pages ?? []) {
    if (containsNode(document, page.contentRoot, nodeId)) {
      return { id: page.id, rootId: page.contentRoot, name: page.name, kind: 'page' };
    }
  }
  for (const canvas of document.designCanvases ?? []) {
    if (containsNode(document, canvas.contentRoot, nodeId)) {
      return { id: canvas.id, rootId: canvas.contentRoot, name: canvas.name, kind: 'canvas' };
    }
  }
  return undefined;
}

function faceName(usage: DocumentFontUsage): string {
  if (usage.faceLabel) return usage.faceLabel;
  if (usage.weight !== undefined || usage.style) {
    return `${usage.weight ?? 400} ${usage.style ?? 'normal'}`;
  }
  return 'Family-only request';
}

function referenceSummary(reference: FontReference | undefined): string {
  if (!reference) return 'Family only';
  const member =
    reference.collectionIndex === undefined
      ? 'single face'
      : `collection member ${reference.collectionIndex}`;
  return `Exact face · ${member}`;
}

function usageDescription(usage: DocumentFontUsage): string {
  const characters = `${usage.totalCharacters} ${usage.totalCharacters === 1 ? 'character' : 'characters'}`;
  const locations = usage.locations.join(', ');
  if (usage.unusedStyle) return `Unused style · ${locations}`;
  return `${characters} · ${locations}`;
}

function usageMatches(usage: DocumentFontUsage, query: string): boolean {
  if (!query) return true;
  const needle = query.toLocaleLowerCase();
  return [usage.family, usage.faceLabel, faceName(usage), ...usage.locations]
    .filter(Boolean)
    .some((value) => value!.toLocaleLowerCase().includes(needle));
}

export function DocumentFontsPanel() {
  const editor = useEditor();
  const { state, setSelectionRefs, announce } = editor;
  const [scope, setScope] = useState<Scope>('page');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'document' | 'browse'>('document');
  const [replacementTarget, setReplacementTarget] = useState<DocumentFontUsage | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<{
    entry: DocumentFontUsage;
    replacement: FontReplacement;
  } | null>(null);
  const restoreDialogRef = useRef<HTMLDivElement>(null);
  const page = state.document.pages?.find(
    (candidate) => candidate.id === state.document.activePageId,
  );
  const designCanvas = state.document.designCanvases?.find(
    (candidate) => candidate.id === state.document.activeDesignCanvasId,
  );
  const activeSurface = state.workspaceMode === 'print' ? page : (designCanvas ?? page);
  const activeSurfaceName = activeSurface?.name ?? 'current canvas';
  const usage = useMemo(
    () =>
      buildDocumentFontUsage(
        state.document,
        scope === 'page' ? { rootId: activeSurface?.contentRoot } : {},
      ),
    [activeSurface?.contentRoot, scope, state.document],
  );
  const filteredUsage = useMemo(
    () => usage.filter((entry) => usageMatches(entry, query.trim())),
    [query, usage],
  );
  const usedEntries = filteredUsage.filter(
    (entry) => !entry.unusedStyle && entry.nodeIds.length > 0,
  );
  const unusedStyles = filteredUsage.filter((entry) => entry.unusedStyle);

  useEffect(() => {
    if (!restoreTarget) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setRestoreTarget(null);
    };
    window.addEventListener('keydown', handleEscape, true);
    restoreDialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [restoreTarget]);

  if (view === 'browse') {
    return (
      <div className="document-fonts-panel document-fonts-panel--browser">
        <div className="document-fonts-panel__subnav">
          <button type="button" onClick={() => setView('document')}>
            Document fonts
          </button>
          <span aria-current="page">Browse all fonts</span>
        </div>
        <FontBrowser layout="panel" showDownloadable />
      </div>
    );
  }

  const selectUsage = (entry: DocumentFontUsage) => {
    if (entry.nodeIds.length === 0) return;
    const [primary] = entry.nodeIds;
    setSelectionRefs(entry.nodeIds, { primary, origin: 'api' });
    announce(
      `Selected ${entry.nodeIds.length} text layer${entry.nodeIds.length === 1 ? '' : 's'} using ${entry.family}`,
    );
  };

  const goToUsage = (entry: DocumentFontUsage) => {
    const [targetId] = entry.nodeIds;
    if (!targetId) return;
    const surface = surfaceForNode(state.document, targetId);
    if (surface?.kind === 'page' && surface.id !== state.document.activePageId) {
      editor.setActivePage(surface.id);
    }
    setSelectionRefs([targetId], { primary: targetId, origin: 'api' });
    editor.revealSelection({ nodeId: targetId, behavior: 'center' });
    announce(`Showing ${entry.family} on ${surface?.name ?? entry.locations[0] ?? 'the canvas'}`);
  };

  const applyReplacement = (entry: DocumentFontUsage, replacement: FontReplacement) => {
    const catalog = createFontCatalogFromRegistry(getFontRegistry());
    editor.beginTransaction();
    editor.updateDoc((doc) =>
      applyFontReplacement(doc, catalog, replacement, { nodeIds: entry.nodeIds }),
    );
    editor.commitTransaction();
    setReplacementTarget(null);
    announce(
      `Replaced ${entry.family} in ${entry.nodeIds.length} text layer${entry.nodeIds.length === 1 ? '' : 's'}. Layout may change.`,
    );
  };

  const confirmRestore = () => {
    if (!restoreTarget) return;
    const catalog = createFontCatalogFromRegistry(getFontRegistry());
    editor.beginTransaction();
    editor.updateDoc((doc) =>
      restoreFontReplacement(
        doc,
        catalog,
        restoreTarget.replacement,
        restoreTarget.entry.fontReference,
        { nodeIds: restoreTarget.entry.nodeIds },
      ),
    );
    editor.commitTransaction();
    announce(
      `Restored ${restoreTarget.replacement.original} in ${restoreTarget.entry.nodeIds.length} text layer${restoreTarget.entry.nodeIds.length === 1 ? '' : 's'}. Layout may change.`,
    );
    setRestoreTarget(null);
  };

  const openReplacement = (entry: DocumentFontUsage) => {
    setReplacementTarget(entry);
  };

  const replacementDescription = replacementTarget
    ? `${replacementTarget.family} · ${replacementTarget.totalCharacters} character${replacementTarget.totalCharacters === 1 ? '' : 's'} across ${replacementTarget.nodeIds.length} text layer${replacementTarget.nodeIds.length === 1 ? '' : 's'}. Review wrapping after replacement.`
    : undefined;

  return (
    <>
      {restoreTarget && (
        <div
          ref={restoreDialogRef}
          className="document-fonts-panel__restore-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="document-fonts-restore-title"
          aria-describedby="document-fonts-restore-description"
        >
          <div className="document-fonts-panel__restore-card">
            <h2 id="document-fonts-restore-title">Restore original font?</h2>
            <p id="document-fonts-restore-description">
              Replace <strong>{restoreTarget.entry.family}</strong> with the recorded original{' '}
              <strong>{restoreTarget.replacement.original}</strong> for this exact face.
            </p>
            <p className="document-fonts-panel__restore-impact">
              Preview: {restoreTarget.entry.family} to {restoreTarget.replacement.original} ·{' '}
              {restoreTarget.entry.totalCharacters}{' '}
              {restoreTarget.entry.totalCharacters === 1 ? 'character' : 'characters'} across{' '}
              {restoreTarget.entry.nodeIds.length}{' '}
              {restoreTarget.entry.nodeIds.length === 1 ? 'text layer' : 'text layers'}. Wrapping,
              metrics, and overflow may change.
            </p>
            <div className="document-fonts-panel__restore-actions">
              <button
                type="button"
                className="document-fonts-panel__restore-cancel"
                onClick={() => setRestoreTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="document-fonts-panel__restore-confirm"
                onClick={confirmRestore}
              >
                Restore original
              </button>
            </div>
          </div>
        </div>
      )}
      {replacementTarget && (
        <FontBrowserDialog
          open
          selectedFamily={replacementTarget.family}
          onClose={() => setReplacementTarget(null)}
          onSelect={(family) =>
            applyReplacement(replacementTarget, {
              original: replacementTarget.family,
              replacement: family,
              ...(replacementTarget.fontReference
                ? { originalReference: replacementTarget.fontReference }
                : {}),
              applyToAll: true,
              preserveOriginalReference: true,
            })
          }
          onSelectFace={(selection) =>
            applyReplacement(replacementTarget, {
              original: replacementTarget.family,
              replacement: selection.family,
              ...(replacementTarget.fontReference
                ? { originalReference: replacementTarget.fontReference }
                : {}),
              ...(selection.fontReference ? { replacementReference: selection.fontReference } : {}),
              applyToAll: true,
              preserveOriginalReference: true,
            })
          }
        />
      )}
      <div className="document-fonts-panel">
        <header className="document-fonts-panel__header">
          <div>
            <h2>Document fonts</h2>
            <p>Inspect exact faces and jump to every matching text layer.</p>
          </div>
          <button
            type="button"
            className="document-fonts-panel__browse"
            onClick={() => setView('browse')}
          >
            Browse all fonts
          </button>
        </header>

        <div className="document-fonts-panel__scope" role="tablist" aria-label="Font usage scope">
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'page'}
            className={scope === 'page' ? 'is-active' : undefined}
            onClick={() => setScope('page')}
          >
            {page?.name ?? 'Current page'}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'document'}
            className={scope === 'document' ? 'is-active' : undefined}
            onClick={() => setScope('document')}
          >
            Entire document
          </button>
        </div>

        <label className="document-fonts-panel__search">
          <span>Filter document fonts</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search family, face, or location"
          />
        </label>

        <div className="document-fonts-panel__summary" role="status" aria-live="polite">
          {usedEntries.length} {usedEntries.length === 1 ? 'face' : 'faces'} in{' '}
          {scope === 'page' ? activeSurfaceName : 'this document'}
        </div>

        <section className="document-fonts-panel__list" aria-label="Fonts used in the document">
          {usedEntries.length === 0 ? (
            <div className="document-fonts-panel__empty">
              <strong>
                {query ? 'No matching document fonts' : 'No visible text fonts on this scope'}
              </strong>
              <span>
                Hidden and locked content is excluded. Use the broader scope or browse for another
                face.
              </span>
            </div>
          ) : (
            usedEntries.map((entry) => {
              const restorable = findRestorableFontReplacement(
                state.document,
                entry.family,
                entry.fontReference,
              );
              return (
                <article key={entry.key} className="document-fonts-panel__row">
                  <div className="document-fonts-panel__row-copy">
                    <strong>{entry.family}</strong>
                    <span>{faceName(entry)}</span>
                    <small>{usageDescription(entry)}</small>
                    <small className={entry.fontReference ? 'is-exact' : 'is-family-only'}>
                      {referenceSummary(entry.fontReference)}
                    </small>
                  </div>
                  <div className="document-fonts-panel__row-actions">
                    <button
                      type="button"
                      className="document-fonts-panel__go-to"
                      onClick={() => goToUsage(entry)}
                      aria-label={`Go to ${entry.family} ${faceName(entry)}`}
                    >
                      Go to
                    </button>
                    <button
                      type="button"
                      className="document-fonts-panel__select"
                      onClick={() => selectUsage(entry)}
                      aria-label={`Select text using ${entry.family} ${faceName(entry)}`}
                    >
                      Select
                    </button>
                    <button
                      type="button"
                      className="document-fonts-panel__replace"
                      onClick={() => openReplacement(entry)}
                      aria-label={`Replace ${entry.family} ${faceName(entry)}`}
                    >
                      Replace
                    </button>
                    {restorable && (
                      <button
                        type="button"
                        className="document-fonts-panel__restore"
                        onClick={() => setRestoreTarget({ entry, replacement: restorable })}
                        aria-label={`Restore original ${entry.family} ${faceName(entry)}`}
                      >
                        Restore
                      </button>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </section>

        {unusedStyles.length > 0 && (
          <details className="document-fonts-panel__unused">
            <summary>Unused text styles ({unusedStyles.length})</summary>
            <ul>
              {unusedStyles.map((entry) => (
                <li key={entry.key}>
                  <span>{entry.family}</span>
                  <small>
                    {entry.styleIds.length} style{entry.styleIds.length === 1 ? '' : 's'}
                  </small>
                </li>
              ))}
            </ul>
          </details>
        )}
        {replacementDescription && (
          <p className="document-fonts-panel__replacement-note" role="status">
            {replacementDescription}
          </p>
        )}
      </div>
    </>
  );
}
