/**
 * FontBrowser — dedicated font browser panel for the inspector sidebar.
 *
 * Lists all registered font families with live preview, source filtering,
 * and search. Works directly with FontRegistry from @strata/engine for
 * font enumeration, load state, and variable-font detection.
 *
 * Research basis: Figma font menu, FontBase/FontBook catalog UX patterns.
 */
import { getFontRegistry } from '@strata/engine';
import { useCallback, useMemo, useRef, useState } from 'react';
import './FontBrowser.css';

export interface FontBrowserProps {
  onSelect?: (family: string) => void;
  selectedFamily?: string;
  showDownloadable?: boolean;
  maxHeight?: number;
}

type SourceFilter = 'all' | 'system' | 'bundled' | 'project' | 'recent' | 'favorites';

interface FontDisplayEntry {
  family: string;
  source: 'system' | 'bundled' | 'google';
  isVariable: boolean;
  isFavorite: boolean;
  recentlyUsedAt?: number;
}

const SOURCE_FILTERS: readonly { key: SourceFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'system', label: 'System' },
  { key: 'bundled', label: 'Bundled' },
  { key: 'project', label: 'Project' },
  { key: 'recent', label: 'Recent' },
  { key: 'favorites', label: 'Favorites' },
] as const;

const SOURCE_BADGES: Record<string, string> = {
  system: 'Sys',
  bundled: 'Bun',
  google: 'Web',
};

function familyMatchesFilter(entry: FontDisplayEntry, filter: SourceFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'system':
      return entry.source === 'system';
    case 'bundled':
      return entry.source === 'bundled';
    case 'project':
      return false;
    case 'recent':
      return !!entry.recentlyUsedAt;
    case 'favorites':
      return entry.isFavorite;
    default:
      return true;
  }
}

export function FontBrowser({
  onSelect,
  selectedFamily,
  showDownloadable = false,
  maxHeight = 400,
}: FontBrowserProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<SourceFilter>('all');
  const listRef = useRef<HTMLDivElement>(null);

  const registry = useMemo(() => getFontRegistry(), []);

  const displayEntries = useMemo<FontDisplayEntry[]>(() => {
    const families = registry.families();
    const results: FontDisplayEntry[] = [];
    const seen = new Set<string>();
    for (const family of families) {
      if (seen.has(family)) continue;
      seen.add(family);
      const entries = registry.getEntries(family);
      if (entries.length === 0) continue;
      const firstEntry = entries[0];
      if (!firstEntry) continue;
      if (!showDownloadable && firstEntry.source === 'google') continue;
      results.push({
        family,
        source: firstEntry.source,
        isVariable: registry.isVariable(family),
        isFavorite: false,
      });
    }
    return results;
  }, [registry, showDownloadable]);

  const filteredEntries = useMemo(() => {
    let results = displayEntries;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      results = results.filter((e) => e.family.toLowerCase().includes(q));
    }

    if (activeFilter !== 'all') {
      results = results.filter((e) => familyMatchesFilter(e, activeFilter));
    }

    results.sort((a, b) => a.family.localeCompare(b.family));

    return results;
  }, [displayEntries, searchQuery, activeFilter]);

  const handleSelect = useCallback(
    (family: string) => {
      onSelect?.(family);
    },
    [onSelect],
  );

  return (
    <div className="font-browser" style={{ maxHeight }}>
      <div className="font-browser__search">
        <input
          type="text"
          className="font-browser__search-input"
          placeholder="Search fonts..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search fonts"
        />
      </div>

      <div className="font-browser__filters" role="tablist" aria-label="Font source filter">
        {SOURCE_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={activeFilter === f.key}
            className={`font-browser__filter-btn${activeFilter === f.key ? ' font-browser__filter-btn--active' : ''}`}
            onClick={() => setActiveFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="font-browser__list" ref={listRef}>
        {filteredEntries.length === 0 && (
          <div className="font-browser__empty">No fonts match your search</div>
        )}
        {filteredEntries.map((entry) => {
          const isSelected = selectedFamily === entry.family;
          const sourceBadge = SOURCE_BADGES[entry.source] ?? '';

          return (
            <button
              key={entry.family}
              type="button"
              className={`font-browser__row${isSelected ? ' font-browser__row--selected' : ''}`}
              onClick={() => handleSelect(entry.family)}
              aria-pressed={isSelected}
            >
              <span
                className="font-browser__preview"
                style={{ fontFamily: `"${entry.family}", sans-serif` }}
              >
                {entry.family}
              </span>
              <span className="font-browser__meta">
                {sourceBadge && <span className="font-browser__badge">{sourceBadge}</span>}
                {entry.isVariable && (
                  <span className="font-browser__badge font-browser__badge--var">w</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="font-browser__count">{filteredEntries.length} fonts</div>
    </div>
  );
}
