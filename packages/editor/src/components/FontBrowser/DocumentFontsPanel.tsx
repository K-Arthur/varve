import type { FontReference } from '@varve/engine';
import { useMemo, useState } from 'react';
import { useEditor } from '../../context';
import { buildDocumentFontUsage, type DocumentFontUsage } from './documentFontUsage';
import { FontBrowser } from './FontBrowser';
import './DocumentFontsPanel.css';

type Scope = 'page' | 'document';

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
  const { state, setSelectionRefs, announce } = useEditor();
  const [scope, setScope] = useState<Scope>('page');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'document' | 'browse'>('document');
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

  return (
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
          usedEntries.map((entry) => (
            <article key={entry.key} className="document-fonts-panel__row">
              <div className="document-fonts-panel__row-copy">
                <strong>{entry.family}</strong>
                <span>{faceName(entry)}</span>
                <small>{usageDescription(entry)}</small>
                <small className={entry.fontReference ? 'is-exact' : 'is-family-only'}>
                  {referenceSummary(entry.fontReference)}
                </small>
              </div>
              <button
                type="button"
                className="document-fonts-panel__select"
                onClick={() => selectUsage(entry)}
                aria-label={`Select text using ${entry.family} ${faceName(entry)}`}
              >
                Select
              </button>
            </article>
          ))
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
    </div>
  );
}
