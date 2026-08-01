/**
 * FontBrowser — dedicated font browser panel for the inspector sidebar.
 *
 * Lists all registered font families with live preview, source filtering,
 * and search. Works directly with FontRegistry from @strata/engine for
 * font enumeration, load state, and variable-font detection.
 *
 * Research basis: Figma font menu, FontBase/FontBook catalog UX patterns.
 */

import { type FontMetadata, getFontRegistry } from '@strata/engine';
import { Icon, Tooltip } from '@strata/ui';
import { useCallback, useMemo, useRef, useState } from 'react';
import { FontLicenseDetails } from './FontLicenseDetails';
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
  hasColorGlyphs: boolean;
  colorFormats: string[];
  paletteCount?: number;
  embeddingRights?: FontMetadata['embeddingRights'];
  license?: string;
  faces?: FontFaceEntry[];
}

interface FontFaceEntry {
  postScriptName: string;
  weight: number;
  style: string;
  source: 'system' | 'bundled' | 'google';
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
  selectedFamily: selectedFamilyProp,
  showDownloadable = false,
  maxHeight = 400,
}: FontBrowserProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<SourceFilter>('all');
  const [selectedFamily, setSelectedFamily] = useState<string | undefined>(selectedFamilyProp);
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(new Set());
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
      const meta = registry.getMetadata(family);

      // Build face entries for TTC/OTC collections
      const faces: FontFaceEntry[] = entries.map((entry) => ({
        postScriptName: `${family}-${entry.weight}-${entry.style}`,
        weight: entry.weight,
        style: entry.style,
        source: entry.source,
      }));

      results.push({
        family,
        source: firstEntry.source,
        isVariable: registry.isVariable(family),
        isFavorite: false,
        hasColorGlyphs: meta?.hasColorGlyphs ?? false,
        colorFormats: meta?.colorFormats ?? [],
        paletteCount: meta?.paletteCount,
        embeddingRights: meta?.embeddingRights,
        license: meta?.license,
        faces: faces.length > 1 ? faces : undefined, // Only show faces if multiple
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
      setSelectedFamily(family);
      onSelect?.(family);
    },
    [onSelect],
  );

  const toggleExpand = useCallback((family: string) => {
    setExpandedFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(family)) {
        next.delete(family);
      } else {
        next.add(family);
      }
      return next;
    });
  }, []);

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
          const isExpanded = expandedFamilies.has(entry.family);
          const hasFaces = entry.faces && entry.faces.length > 1;
          const sourceBadge = SOURCE_BADGES[entry.source] ?? '';

          const colorTitle = entry.paletteCount
            ? `${entry.colorFormats.join(', ')} · ${entry.paletteCount} palettes`
            : entry.colorFormats.join(', ');
          const licenseTitle = entry.license
            ? entry.license
            : `Embedding: ${entry.embeddingRights ?? 'unknown'}`;

          return (
            <div key={entry.family} className="font-browser__entry">
              <button
                type="button"
                className={`font-browser__row${isSelected ? ' font-browser__row--selected' : ''}`}
                onClick={() => handleSelect(entry.family)}
                aria-pressed={isSelected}
              >
                {hasFaces && (
                  <button
                    type="button"
                    className="font-browser__expand-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpand(entry.family);
                    }}
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${entry.family} faces`}
                  >
                    {isExpanded ? (
                      <Icon name="ChevronDown" size={12} />
                    ) : (
                      <Icon name="ChevronRight" size={12} />
                    )}
                  </button>
                )}
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
                  {entry.hasColorGlyphs && (
                    <Tooltip label={colorTitle}>
                      <span className="font-browser__badge font-browser__badge--color">C</span>
                    </Tooltip>
                  )}
                  {entry.embeddingRights === 'restricted' && (
                    <Tooltip label={licenseTitle}>
                      <span className="font-browser__badge font-browser__badge--license">L</span>
                    </Tooltip>
                  )}
                  {hasFaces && (
                    <span className="font-browser__badge font-browser__badge--faces">
                      {entry.faces!.length}
                    </span>
                  )}
                </span>
              </button>
              {isExpanded && hasFaces && (
                <div className="font-browser__faces">
                  {entry.faces!.map((face) => (
                    <Tooltip label={`${face.postScriptName} — ${face.weight} ${face.style}`}>
                      <button
                        key={face.postScriptName}
                        type="button"
                        className="font-browser__face-row"
                        onClick={() => handleSelect(entry.family)}
                      >
                        <span className="font-browser__face-name">{face.postScriptName}</span>
                        <span className="font-browser__face-meta">
                          {face.weight} {face.style}
                        </span>
                      </button>
                    </Tooltip>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="font-browser__count">{filteredEntries.length} fonts</div>

      {selectedFamily && (
        <div className="font-browser__details">
          <FontLicenseDetails family={selectedFamily} />
        </div>
      )}
    </div>
  );
}
