/**
 * Full semantic font browser.
 *
 * FontSemanticCatalog is the discovery source for this surface. FontRegistry
 * remains the runtime face loader, so a downloadable result is still only
 * preview-only for document use until the user explicitly installs it.
 */

import { getFontRegistry } from '@varve/engine';
import {
  type FontSearchResult,
  type FontSemanticRecord,
  findFontAlternatives,
  findFontPairings,
  findSimilarFonts,
  getFontSemanticCatalog,
  parseFontSemanticQuery,
  tagLabel,
} from '@varve/engine/font';
import { Icon, SearchField, Tooltip } from '@varve/ui';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { FontLicenseDetails } from './FontLicenseDetails';
import { type FontPreviewStatus, loadFontPreview, removeFontPreview } from './fontPreview';
import { downloadAndApplyOnlineFont } from './useOnlineFontSearch';
import './FontBrowser.css';

export interface FontBrowserProps {
  onSelect?: (family: string) => void;
  selectedFamily?: string;
  showDownloadable?: boolean;
  maxHeight?: number;
  layout?: 'panel' | 'modal';
}

type SourceFilter = 'all' | 'system' | 'bundled' | 'project' | 'recent' | 'favorites';
type SemanticFilter =
  | 'all'
  | 'sans'
  | 'serif'
  | 'humanist'
  | 'monospace'
  | 'variable'
  | 'cyrillic'
  | 'vietnamese';

interface FontFaceEntry {
  postScriptName: string;
  weight: number;
  style: string;
  source: string;
}

interface FontDisplayEntry {
  record: FontSemanticRecord;
  result: FontSearchResult;
  faces: FontFaceEntry[];
}

const SOURCE_FILTERS: readonly { key: SourceFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'system', label: 'System' },
  { key: 'bundled', label: 'Bundled' },
  { key: 'project', label: 'Project' },
  { key: 'recent', label: 'Recent' },
  { key: 'favorites', label: 'Favorites' },
] as const;

const SEMANTIC_FILTERS: readonly { key: SemanticFilter; label: string; query?: string }[] = [
  { key: 'all', label: 'Semantic filter' },
  { key: 'sans', label: 'Sans serif', query: 'sans' },
  { key: 'serif', label: 'Serif', query: 'serif' },
  { key: 'humanist', label: 'Humanist', query: 'humanist' },
  { key: 'monospace', label: 'Monospace', query: 'monospace' },
  { key: 'variable', label: 'Variable', query: 'variable' },
  { key: 'cyrillic', label: 'Cyrillic', query: 'Cyrillic' },
  { key: 'vietnamese', label: 'Vietnamese', query: 'Vietnamese' },
] as const;

function sourceMatches(record: FontSemanticRecord, filter: SourceFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'system':
      return record.sourceKinds.includes('system');
    case 'bundled':
      return record.sourceKinds.includes('bundled');
    case 'project':
      return record.sourceKinds.includes('project');
    case 'recent':
      return record.recentlyUsedAt !== undefined;
    case 'favorites':
      return record.isFavorite;
    default:
      return true;
  }
}

function sourceBadge(record: FontSemanticRecord): string {
  if (record.sourceKinds.includes('system')) return 'Sys';
  if (record.sourceKinds.includes('bundled')) return 'Bun';
  if (record.sourceKinds.includes('user')) return 'You';
  if (record.sourceKinds.includes('project')) return 'Pro';
  return 'Get';
}

function sourceLabel(record: FontSemanticRecord): string {
  if (record.sourceKinds.includes('system')) return 'System font';
  if (record.sourceKinds.includes('bundled')) return 'Bundled with Varve';
  if (record.sourceKinds.includes('user')) return 'Installed by you';
  if (record.sourceKinds.includes('project')) return 'In this project';
  return 'Fontsource catalog';
}

function fontStack(family: string): string {
  return `"${family.replaceAll('"', '')}", sans-serif`;
}

function descriptors(record: FontSemanticRecord): string[] {
  return [
    ...new Map(
      record.profile.assignments
        .filter(
          (assignment) =>
            !assignment.tagId.startsWith('source.') && !assignment.tagId.startsWith('coverage.'),
        )
        .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
        .map((assignment) => [tagLabel(assignment.tagId), assignment]),
    ).keys(),
  ].slice(0, 3);
}

function facesFor(
  record: FontSemanticRecord,
  registry: ReturnType<typeof getFontRegistry>,
): FontFaceEntry[] {
  const registered = registry.getEntries(record.familyName).map((entry) => ({
    postScriptName: `${record.familyName}-${entry.weight}-${entry.style}`,
    weight: entry.weight,
    style: entry.style,
    source: entry.source,
  }));
  if (registered.length > 0) return registered;
  return record.weights.slice(0, 12).flatMap((weight) =>
    record.styles.map((style) => ({
      postScriptName: `${record.familyName}-${weight}-${style}`,
      weight,
      style,
      source: record.source,
    })),
  );
}

export function FontBrowser({
  onSelect,
  selectedFamily: selectedFamilyProp,
  showDownloadable = false,
  maxHeight,
  layout = 'panel',
}: FontBrowserProps) {
  const semantic = useMemo(() => getFontSemanticCatalog(), []);
  const registry = useMemo(() => getFontRegistry(), []);
  const subscribe = useCallback((listener: () => void) => semantic.subscribe(listener), [semantic]);
  const getRevision = useCallback(() => semantic.revision, [semantic]);
  const semanticRevision = useSyncExternalStore(subscribe, getRevision, getRevision);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<SourceFilter>('all');
  const [semanticFilter, setSemanticFilter] = useState<SemanticFilter>('all');
  const [selectedFamily, setSelectedFamily] = useState<string | undefined>(selectedFamilyProp);
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(new Set());
  const [installingFamily, setInstallingFamily] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const [previewText, setPreviewText] = useState('The quick brown fox jumps over the lazy dog');
  const [previewStatus, setPreviewStatus] = useState<FontPreviewStatus>('unavailable');
  const [previewMessage, setPreviewMessage] = useState<string | undefined>();
  const previewFaceRef = useRef<FontFace | undefined>(undefined);
  const tagInputId = useId();

  useEffect(() => setSelectedFamily(selectedFamilyProp), [selectedFamilyProp]);

  const effectiveQuery = useMemo(() => {
    const filterQuery = SEMANTIC_FILTERS.find((filter) => filter.key === semanticFilter)?.query;
    return [searchQuery.trim(), filterQuery].filter(Boolean).join(' ');
  }, [searchQuery, semanticFilter]);

  const interpretation = useMemo(() => parseFontSemanticQuery(effectiveQuery), [effectiveQuery]);
  const searchResults = useMemo(
    () =>
      semantic.search(interpretation, {
        installedOnly: !showDownloadable,
        // Source tabs are applied after the semantic search because recent
        // and favorite are user-state filters. Search the full local index for
        // those tabs so a system font is never hidden by the first page of
        // alphabetically-ranked catalog records.
        limit: activeFilter === 'all' ? (effectiveQuery ? 240 : 200) : semantic.size,
        diversity: true,
      }),
    [activeFilter, effectiveQuery, interpretation, semantic, semanticRevision, showDownloadable],
  );
  const displayEntries = useMemo<FontDisplayEntry[]>(() => {
    const entries = searchResults
      .filter((result) => showDownloadable || result.record.installed)
      .filter((result) => sourceMatches(result.record, activeFilter))
      .map((result) => ({
        record: result.record,
        result,
        faces: facesFor(result.record, registry),
      }));
    if (effectiveQuery) return entries;
    return entries.sort((a, b) => a.record.familyName.localeCompare(b.record.familyName));
  }, [activeFilter, effectiveQuery, registry, searchResults, showDownloadable]);

  const selectedRecord = selectedFamily ? semantic.findByFamilyName(selectedFamily) : undefined;
  const selectedResult = selectedRecord
    ? (searchResults.find((result) => result.record.familyId === selectedRecord.familyId) ??
      semantic.search(selectedRecord.familyName, {
        installedOnly: false,
        limit: 1,
        diversity: false,
      })[0])
    : undefined;

  useEffect(() => {
    removeFontPreview(previewFaceRef.current);
    previewFaceRef.current = undefined;
    if (!selectedRecord) {
      setPreviewStatus('unavailable');
      setPreviewMessage(undefined);
      return;
    }

    let cancelled = false;
    setPreviewStatus('loading');
    setPreviewMessage(undefined);
    void loadFontPreview(selectedRecord).then((result) => {
      if (cancelled) {
        removeFontPreview(result.face);
        return;
      }
      previewFaceRef.current = result.face;
      setPreviewStatus(result.status);
      setPreviewMessage(result.message);
    });

    return () => {
      cancelled = true;
      removeFontPreview(previewFaceRef.current);
      previewFaceRef.current = undefined;
    };
  }, [selectedRecord?.familyId]);
  const recommendations = useMemo(() => {
    if (!selectedRecord) return undefined;
    const candidates = semantic.all();
    return {
      similar: findSimilarFonts(selectedRecord, candidates, { limit: 3 }),
      alternatives: findFontAlternatives(selectedRecord, candidates, {
        limit: 3,
        preserveScripts: true,
      }),
      pairings: findFontPairings(selectedRecord, candidates, { limit: 3 }),
    };
  }, [selectedRecord, semantic, semanticRevision]);

  const handleSelect = useCallback(
    (record: FontSemanticRecord) => {
      setSelectedFamily(record.familyName);
      semantic.markRecentlyUsed(record.familyId);
    },
    [semantic],
  );

  const applySelected = useCallback(() => {
    if (selectedRecord?.installed) onSelect?.(selectedRecord.familyName);
  }, [onSelect, selectedRecord]);

  const toggleExpand = useCallback((familyId: string) => {
    setExpandedFamilies((previous) => {
      const next = new Set(previous);
      if (next.has(familyId)) next.delete(familyId);
      else next.add(familyId);
      return next;
    });
  }, []);

  const installFamily = useCallback(
    async (record: FontSemanticRecord) => {
      if (record.providerId !== 'fontsource' || record.installed) return;
      setInstallingFamily(record.familyId);
      setInstallError(null);
      try {
        await downloadAndApplyOnlineFont(record.familyName, 'fontsource', record.familyId);
        semantic.notifyExternalChange();
      } catch (error) {
        setInstallError(error instanceof Error ? error.message : 'Font installation failed.');
      } finally {
        setInstallingFamily(null);
      }
    },
    [semantic],
  );

  const addTag = useCallback(() => {
    if (!selectedRecord || !tagDraft.trim()) return;
    semantic.addUserTag(selectedRecord.familyId, tagDraft.trim());
    setTagDraft('');
  }, [selectedRecord, semantic, tagDraft]);

  const visibleHeight = maxHeight ?? (layout === 'modal' ? 620 : 400);
  const resultCountLabel = effectiveQuery
    ? `${displayEntries.length} ${displayEntries.length === 1 ? 'match' : 'matches'}`
    : displayEntries.length < semantic.size && activeFilter === 'all'
      ? `Showing ${displayEntries.length} of ${semantic.size} families`
      : `${displayEntries.length} ${displayEntries.length === 1 ? 'family' : 'families'}`;

  return (
    <div
      className={`font-browser font-browser--${layout}`}
      style={{ '--font-browser-max-height': `${visibleHeight}px` } as React.CSSProperties}
    >
      <div className="font-browser__toolbar">
        <SearchField
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search family, foundry, or style…"
          aria-label="Search fonts by name or design language"
          data-autofocus
          resultCount={displayEntries.length}
        />

        {effectiveQuery && (
          <div
            className="font-browser__interpretation"
            role="status"
            aria-label="Search interpretation"
          >
            <span className="font-browser__interpretation-label">Interpreted as</span>
            {interpretation.chips.slice(0, 6).map((chip) => (
              <span
                key={`${chip.kind}-${chip.label}`}
                className={`font-browser__chip font-browser__chip--${chip.kind}`}
              >
                {chip.label}
              </span>
            ))}
            {interpretation.ambiguities.length > 0 && (
              <span className="font-browser__ambiguity">Some terms are ambiguous</span>
            )}
          </div>
        )}

        <div className="font-browser__controls">
          <div className="font-browser__filters" role="tablist" aria-label="Font source filter">
            {SOURCE_FILTERS.map((filter) => (
              <button
                key={filter.key}
                type="button"
                role="tab"
                aria-selected={activeFilter === filter.key}
                className={`font-browser__filter-btn${activeFilter === filter.key ? ' font-browser__filter-btn--active' : ''}`}
                onClick={() => setActiveFilter(filter.key)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <label className="font-browser__semantic-filter">
            <span>Refine</span>
            <select
              value={semanticFilter}
              onChange={(event) => setSemanticFilter(event.target.value as SemanticFilter)}
              aria-label="Semantic font filter"
            >
              {SEMANTIC_FILTERS.map((filter) => (
                <option key={filter.key} value={filter.key}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="font-browser__workspace">
        <section className="font-browser__results" aria-label="Font results">
          <div className="font-browser__list-heading">
            <div>
              <strong>{effectiveQuery ? 'Search results' : 'Font families'}</strong>
              <span>{resultCountLabel}</span>
            </div>
            <span className="font-browser__hint">Select a family to inspect</span>
          </div>
          <div className="font-browser__list">
            {displayEntries.length === 0 && (
              <div className="font-browser__empty">
                <strong>
                  {searchQuery ? `No fonts match “${searchQuery}”` : 'No fonts available'}
                </strong>
                <span>
                  {searchQuery
                    ? 'Try a different family name, style, or design term.'
                    : 'Change the source filter or install a local font.'}
                </span>
              </div>
            )}
            {displayEntries.map(({ record, result, faces }) => {
              const isSelected = selectedFamily === record.familyName;
              const isExpanded = expandedFamilies.has(record.familyId);
              const hasFaces = faces.length > 1;
              const labels = descriptors(record);
              return (
                <div
                  key={record.familyId}
                  className={`font-browser__entry${isSelected ? ' font-browser__entry--selected' : ''}`}
                >
                  <div className="font-browser__row">
                    {hasFaces ? (
                      <button
                        type="button"
                        className="font-browser__expand-btn"
                        onClick={() => toggleExpand(record.familyId)}
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${record.familyName} faces`}
                      >
                        <Icon name={isExpanded ? 'ChevronDown' : 'ChevronRight'} size={12} />
                      </button>
                    ) : (
                      <span className="font-browser__expand-placeholder" aria-hidden="true" />
                    )}
                    <button
                      type="button"
                      className="font-browser__select-btn"
                      onClick={() => handleSelect(record)}
                      aria-pressed={isSelected}
                    >
                      <span className="font-browser__row-copy">
                        <span
                          className="font-browser__preview"
                          style={{ fontFamily: fontStack(record.familyName) }}
                        >
                          {record.familyName}
                        </span>
                        {labels.length > 0 && (
                          <span className="font-browser__descriptors">{labels.join(' · ')}</span>
                        )}
                      </span>
                    </button>
                    <span className="font-browser__meta">
                      <Tooltip label={sourceLabel(record)}>
                        <span className="font-browser__badge">{sourceBadge(record)}</span>
                      </Tooltip>
                      {record.variable && (
                        <span className="font-browser__badge font-browser__badge--var">
                          Variable
                        </span>
                      )}
                      {record.scripts.length > 1 && (
                        <Tooltip
                          label={`${record.scripts.length} writing systems in catalog metadata`}
                        >
                          <span className="font-browser__badge">
                            {record.scripts.length} scripts
                          </span>
                        </Tooltip>
                      )}
                      {result.status === 'unknown' && (
                        <span className="font-browser__badge font-browser__badge--unknown">
                          Unverified
                        </span>
                      )}
                    </span>
                    {record.downloadable && !record.installed && (
                      <button
                        type="button"
                        className="font-browser__install-btn"
                        onClick={() => void installFamily(record)}
                        disabled={installingFamily === record.familyId}
                        aria-label={`Install ${record.familyName}`}
                      >
                        {installingFamily === record.familyId ? 'Installing…' : 'Install'}
                      </button>
                    )}
                  </div>
                  {isExpanded && hasFaces && (
                    <div className="font-browser__faces">
                      {faces.map((face) => (
                        <button
                          key={face.postScriptName}
                          type="button"
                          className="font-browser__face-row"
                          onClick={() => handleSelect(record)}
                        >
                          <span className="font-browser__face-name">{face.postScriptName}</span>
                          <span className="font-browser__face-meta">
                            {face.weight} {face.style}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="font-browser__count">
            {resultCountLabel}
            {showDownloadable ? ' · local catalog' : ' · installed'}
          </div>
        </section>

        <aside
          className="font-browser__details"
          aria-label={selectedRecord ? `${selectedRecord.familyName} details` : 'Font details'}
        >
          {selectedRecord ? (
            <>
              <div className="font-browser__details-header">
                <div>
                  <span className="font-browser__eyebrow">Selected family</span>
                  <h3>{selectedRecord.familyName}</h3>
                  <span>
                    {selectedRecord.installed
                      ? sourceLabel(selectedRecord)
                      : 'Available to install'}
                  </span>
                </div>
                <span
                  className={`font-browser__availability${selectedRecord.installed ? ' font-browser__availability--installed' : ''}`}
                >
                  {selectedRecord.installed ? 'Ready to use' : 'Preview only'}
                </span>
              </div>

              <label className="font-browser__specimen-label" htmlFor={`${tagInputId}-specimen`}>
                Preview text
                <input
                  id={`${tagInputId}-specimen`}
                  type="text"
                  value={previewText}
                  onChange={(event) => setPreviewText(event.target.value)}
                  placeholder="Type a custom specimen…"
                />
              </label>
              <div
                className={`font-browser__specimen${previewStatus === 'ready' ? '' : ' font-browser__specimen--fallback'}`}
                data-preview-status={previewStatus}
                style={{ fontFamily: fontStack(selectedRecord.familyName) }}
              >
                {previewText || 'Type a custom specimen…'}
              </div>
              {previewStatus === 'loading' && (
                <p className="font-browser__preview-note">Loading the exact font preview…</p>
              )}
              {previewStatus === 'ready' && !selectedRecord.installed && (
                <p className="font-browser__preview-note">
                  Temporary preview loaded. Install the family to keep it available in the document.
                </p>
              )}
              {(previewStatus === 'fallback' || previewStatus === 'unavailable') && (
                <p className="font-browser__preview-note">
                  {previewMessage ?? 'Install the family to load the actual font in the document.'}
                </p>
              )}

              <dl className="font-browser__detail-grid">
                <div>
                  <dt>Source</dt>
                  <dd>{sourceLabel(selectedRecord)}</dd>
                </div>
                <div>
                  <dt>License</dt>
                  <dd>
                    {selectedRecord.licenseUrl ? (
                      <a href={selectedRecord.licenseUrl} target="_blank" rel="noreferrer">
                        {selectedRecord.license ?? 'View license'}
                      </a>
                    ) : (
                      (selectedRecord.license ?? 'Not recorded')
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Styles</dt>
                  <dd>{selectedRecord.styles.join(', ') || 'Not recorded'}</dd>
                </div>
                <div>
                  <dt>Weights</dt>
                  <dd>
                    {selectedRecord.weights.length > 0
                      ? selectedRecord.weights.join(', ')
                      : 'Not recorded'}
                  </dd>
                </div>
                <div>
                  <dt>Coverage</dt>
                  <dd>
                    {selectedRecord.scripts.length > 0
                      ? selectedRecord.scripts.join(', ')
                      : 'Not recorded'}
                  </dd>
                </div>
                {(selectedRecord.designer || selectedRecord.foundry || selectedRecord.vendor) && (
                  <div>
                    <dt>Designer</dt>
                    <dd>
                      {selectedRecord.designer ?? selectedRecord.foundry ?? selectedRecord.vendor}
                    </dd>
                  </div>
                )}
              </dl>

              <div className="font-browser__detail-tags">
                {descriptors(selectedRecord).map((label) => (
                  <span key={label} className="font-browser__detail-tag">
                    {label}
                  </span>
                ))}
                {selectedRecord.userTags.map((tag) => (
                  <span
                    key={`user-${tag}`}
                    className="font-browser__detail-tag font-browser__detail-tag--user"
                  >
                    Your tag: {tag}
                  </span>
                ))}
              </div>

              <div className="font-browser__detail-actions">
                {selectedRecord.downloadable && !selectedRecord.installed && (
                  <button
                    type="button"
                    className="font-browser__install-btn font-browser__install-btn--primary"
                    onClick={() => void installFamily(selectedRecord)}
                    disabled={installingFamily === selectedRecord.familyId}
                  >
                    {installingFamily === selectedRecord.familyId ? 'Installing…' : 'Install font'}
                  </button>
                )}
                {onSelect && selectedRecord.installed && (
                  <button
                    type="button"
                    className="font-browser__use-btn"
                    onClick={applySelected}
                    aria-label={`Use ${selectedRecord.familyName}`}
                    disabled={selectedRecord.familyName === selectedFamilyProp}
                  >
                    {selectedRecord.familyName === selectedFamilyProp ? 'Current font' : 'Use font'}
                  </button>
                )}
              </div>

              {installError && (
                <div className="font-browser__error" role="alert">
                  {installError}
                </div>
              )}

              {selectedResult &&
                (selectedResult.reasons.length > 0 ||
                  selectedResult.unknownRequired.length > 0) && (
                  <details className="font-browser__why">
                    <summary>Why this result</summary>
                    <ul>
                      {selectedResult.reasons.slice(0, 5).map((reason) => (
                        <li key={`${reason.kind}-${reason.label}`}>
                          <span>{reason.label}</span>
                          <small>{reason.provenance}</small>
                        </li>
                      ))}
                      {selectedResult.unknownRequired.map((unknown) => (
                        <li key={unknown}>
                          <span>{unknown} not verified</span>
                          <small>Metadata unavailable</small>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

              {recommendations && (
                <section
                  className="font-browser__recommendations"
                  aria-label="Font recommendations"
                >
                  <h4>Explore related families</h4>
                  {(
                    [
                      ['Similar', recommendations.similar],
                      ['Alternatives', recommendations.alternatives],
                      ['Pairings', recommendations.pairings],
                    ] as const
                  ).map(
                    ([title, items]) =>
                      items.length > 0 && (
                        <div key={title} className="font-browser__recommendation-lane">
                          <strong>{title}</strong>
                          <div>
                            {items.map((item) => (
                              <button
                                key={item.record.familyId}
                                type="button"
                                onClick={() => handleSelect(item.record)}
                                title={item.reasons[0]?.label ?? title}
                              >
                                {item.record.familyName}
                              </button>
                            ))}
                          </div>
                        </div>
                      ),
                  )}
                </section>
              )}

              {selectedRecord.installed && (
                <details className="font-browser__file-details">
                  <summary>Installed file details</summary>
                  <FontLicenseDetails family={selectedRecord.familyName} />
                </details>
              )}

              <form
                className="font-browser__tag-editor"
                onSubmit={(event) => {
                  event.preventDefault();
                  addTag();
                }}
              >
                <label htmlFor={`${tagInputId}-tag`}>Personal tag</label>
                <div>
                  <input
                    id={`${tagInputId}-tag`}
                    value={tagDraft}
                    onChange={(event) => setTagDraft(event.target.value)}
                    maxLength={64}
                    placeholder="e.g. finance UI"
                  />
                  <button type="submit" disabled={!tagDraft.trim()}>
                    Add
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="font-browser__details-empty">
              <span className="font-browser__details-empty-mark" aria-hidden="true">
                Aa
              </span>
              <strong>Select a family to inspect it</strong>
              <span>
                Preview the specimen, review coverage and licensing, then choose whether to install
                or use it.
              </span>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
