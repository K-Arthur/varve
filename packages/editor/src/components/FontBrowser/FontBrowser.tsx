/**
 * Full semantic font browser.
 *
 * FontSemanticCatalog is the discovery source for this surface. FontRegistry
 * remains the runtime face loader, so a downloadable result is still only a
 * preview until the user explicitly installs it.
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
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { downloadAndApplyOnlineFont } from './useOnlineFontSearch';
import './FontBrowser.css';

export interface FontBrowserProps {
  onSelect?: (family: string) => void;
  selectedFamily?: string;
  showDownloadable?: boolean;
  maxHeight?: number;
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
  result?: FontSearchResult;
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
  maxHeight = 400,
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
        limit: 80,
        diversity: true,
      }),
    [interpretation, semantic, semanticRevision, showDownloadable],
  );
  const displayEntries = useMemo<FontDisplayEntry[]>(() => {
    return searchResults
      .filter((result) => showDownloadable || result.record.installed)
      .filter((result) => sourceMatches(result.record, activeFilter))
      .map((result) => ({
        record: result.record,
        result,
        faces: facesFor(result.record, registry),
      }))
      .sort((a, b) => a.record.familyName.localeCompare(b.record.familyName));
  }, [activeFilter, registry, searchResults, showDownloadable]);

  const selectedRecord = selectedFamily ? semantic.findByFamilyName(selectedFamily) : undefined;
  const selectedResult = selectedRecord
    ? searchResults.find((result) => result.record.familyId === selectedRecord.familyId)
    : undefined;
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
      if (record.installed) onSelect?.(record.familyName);
    },
    [onSelect, semantic],
  );

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

  return (
    <div className="font-browser" style={{ maxHeight }}>
      <SearchField
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Try “friendly rounded sans for UI”…"
        aria-label="Search fonts by name or design language"
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

      <div className="font-browser__list">
        {displayEntries.length === 0 && (
          <div className="font-browser__empty">
            <strong>No fonts match</strong>
            <span>Try removing a hard requirement or search the installed catalog.</span>
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
                  <span
                    className="font-browser__preview"
                    style={{ fontFamily: `"${record.familyName.replaceAll('"', '')}", sans-serif` }}
                  >
                    {record.familyName}
                  </span>
                  {labels.length > 0 && (
                    <span className="font-browser__descriptors">{labels.join(' · ')}</span>
                  )}
                </button>
                <span className="font-browser__meta">
                  <span className="font-browser__badge">{sourceBadge(record)}</span>
                  {record.variable && (
                    <span className="font-browser__badge font-browser__badge--var">Variable</span>
                  )}
                  {record.scripts.length > 1 && (
                    <Tooltip label={`${record.scripts.length} writing systems in catalog metadata`}>
                      <span className="font-browser__badge">{record.scripts.length} scripts</span>
                    </Tooltip>
                  )}
                  {result?.status === 'unknown' && (
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
        {displayEntries.length} {displayEntries.length === 1 ? 'family' : 'families'}
        {showDownloadable ? ' · local catalog' : ' · installed'}
      </div>
      {installError && (
        <div className="font-browser__error" role="alert">
          {installError}
        </div>
      )}

      {selectedRecord && (
        <aside
          className="font-browser__details"
          aria-label={`${selectedRecord.familyName} details`}
        >
          <div className="font-browser__details-header">
            <div>
              <strong>{selectedRecord.familyName}</strong>
              <span>{selectedRecord.installed ? 'Installed locally' : 'Available to install'}</span>
            </div>
            {selectedRecord.downloadable && !selectedRecord.installed && (
              <button
                type="button"
                className="font-browser__install-btn"
                onClick={() => void installFamily(selectedRecord)}
                disabled={installingFamily === selectedRecord.familyId}
              >
                {installingFamily === selectedRecord.familyId ? 'Installing…' : 'Install'}
              </button>
            )}
          </div>
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
          {selectedResult && (
            <details open className="font-browser__why">
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
            <section className="font-browser__recommendations" aria-label="Font recommendations">
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
          <div className="font-browser__detail-meta">
            <span>
              {selectedRecord.weights.length} weights · {selectedRecord.styles.join(', ')}
            </span>
            {selectedRecord.scripts.length > 0 && (
              <span>Coverage: {selectedRecord.scripts.join(', ')}</span>
            )}
            {selectedRecord.license && <span>{selectedRecord.license}</span>}
          </div>
          <div className="font-browser__tag-editor">
            <label htmlFor="font-browser-user-tag">Personal tag</label>
            <div>
              <input
                id="font-browser-user-tag"
                value={tagDraft}
                onChange={(event) => setTagDraft(event.target.value)}
                maxLength={64}
                placeholder="e.g. finance UI"
              />
              <button type="button" onClick={addTag} disabled={!tagDraft.trim()}>
                Add
              </button>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
