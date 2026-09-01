/**
 * FontSelector — APG-compliant combobox for selecting a font family.
 *
 * Replaces raw <select> dropdowns in TypographySection and FloatingTextBar.
 * Features type-ahead search, live font preview per option, recently-used
 * section, and source badges.
 *
 * Research basis: WAI-ARIA APG "Listbox Combobox" pattern with
 * inline autocomplete. Arrow keys navigate, Enter selects, Escape closes.
 */

import { useVirtualizer } from '@tanstack/react-virtual';
import type { FontMetadata } from '@varve/engine';
import { getFontRegistry } from '@varve/engine';
import { Tooltip } from '@varve/ui';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { downloadAndApplyOnlineFont, useOnlineFontSearch } from './useOnlineFontSearch';
import './FontSelector.css';

export interface FontSelectorProps {
  value: string;
  onChange: (family: string) => void;
  label?: string;
  className?: string;
}

const SOURCE_BADGES: Record<string, string> = {
  system: 'S',
  bundled: 'B',
  google: 'W',
};

type FontRow =
  | { kind: 'section'; key: string; title: string; isOnline?: boolean }
  | { kind: 'font'; key: string; family: string; index: number; isOnline?: boolean };

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

export function FontSelector({
  value,
  onChange,
  label = 'Font family',
  className,
}: FontSelectorProps) {
  const registry = useMemo(() => getFontRegistry(), []);
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Font loading and system-font enumeration mutate the registry without
  // changing the selected document. Subscribe to its revision so every
  // mounted selector reflects newly-ready faces without a remount or an
  // unrelated editor interaction.
  const subscribe = useCallback((listener: () => void) => registry.subscribe(listener), [registry]);
  const getRevision = useCallback(() => registry.revision, [registry]);
  const registryRevision = useSyncExternalStore(subscribe, getRevision, getRevision);

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [installingFamily, setInstallingFamily] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const allFamilies = useMemo(() => registry.families(), [registry, registryRevision]);

  const { googleFonts, fontsource } = useOnlineFontSearch(query);

  const onlineProviders = useMemo(() => {
    const providers = new Map<string, string>();
    for (const result of googleFonts.results) providers.set(result.familyName, 'google-fonts');
    for (const result of fontsource.results) {
      if (!providers.has(result.familyName)) providers.set(result.familyName, 'fontsource');
    }
    return providers;
  }, [googleFonts.results, fontsource.results]);

  const recentFamilies = useMemo(() => {
    return allFamilies.filter((f) => registry.state(f) === 'loaded').slice(0, 5);
  }, [allFamilies, registry]);

  const filteredFamilies = useMemo(() => {
    const q = normalize(query);
    if (!q) return allFamilies;
    return allFamilies.filter((f) => normalize(f).includes(q));
  }, [allFamilies, query]);

  const hasMatch = useMemo(
    () => allFamilies.some((f) => normalize(f) === normalize(query)),
    [allFamilies, query],
  );

  const sections = useMemo(() => {
    const result: Array<{ title: string; families: string[]; isOnline?: boolean }> = [];

    if (query.trim().length >= 2) {
      const online: string[] = [];
      for (const r of googleFonts.results) {
        if (!registry.isRegistered(r.familyName)) online.push(r.familyName);
      }
      for (const r of fontsource.results) {
        if (!registry.isRegistered(r.familyName) && !online.includes(r.familyName)) {
          online.push(r.familyName);
        }
      }
      if (online.length > 0) {
        result.push({ title: 'Online', families: online.sort(), isOnline: true });
      }
    }

    if (recentFamilies.length > 0) {
      result.push({ title: 'Recent', families: recentFamilies });
    }
    const systemFamilies = filteredFamilies.filter((f) =>
      registry.getEntries(f).some((e) => e.source === 'system'),
    );
    if (systemFamilies.length > 0) {
      result.push({ title: 'System', families: systemFamilies });
    }
    const bundledFamilies = filteredFamilies.filter((f) =>
      registry.getEntries(f).some((e) => e.source === 'bundled'),
    );
    if (bundledFamilies.length > 0) {
      result.push({ title: 'Bundled', families: bundledFamilies });
    }
    const otherFamilies = filteredFamilies.filter((f) => {
      const entries = registry.getEntries(f);
      return !entries.some((e) => e.source === 'system' || e.source === 'bundled');
    });
    if (otherFamilies.length > 0) {
      result.push({ title: 'All', families: otherFamilies });
    }
    return result;
  }, [filteredFamilies, recentFamilies, registry, query, googleFonts.results, fontsource.results]);

  const flatList = useMemo(() => sections.flatMap((s) => s.families), [sections]);
  const rows = useMemo<FontRow[]>(() => {
    let fontIndex = -1;
    return sections.flatMap((section) => [
      {
        kind: 'section' as const,
        key: `section-${section.title}`,
        title: section.title,
        isOnline: section.isOnline,
      },
      ...section.families.map((family) => {
        fontIndex += 1;
        return {
          kind: 'font' as const,
          key: `${section.title}-${family}`,
          family,
          index: fontIndex,
          isOnline: section.isOnline,
        };
      }),
    ]);
  }, [sections]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: (index) => (rows[index]?.kind === 'section' ? 24 : 28),
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: 8,
  });

  const scrollToFontIndex = useCallback(
    (index: number) => {
      const rowIndex = rows.findIndex((row) => row.kind === 'font' && row.index === index);
      if (rowIndex >= 0) virtualizer.scrollToIndex(rowIndex, { align: 'auto' });
    },
    [rows, virtualizer],
  );

  const highlight = useCallback(
    (index: number) => {
      const clamped = Math.max(-1, Math.min(index, flatList.length - 1));
      setHighlightedIndex(clamped);
      if (clamped >= 0 && isOpen) scrollToFontIndex(clamped);
    },
    [flatList.length, isOpen, scrollToFontIndex],
  );

  useEffect(() => {
    if (isOpen && highlightedIndex >= 0) scrollToFontIndex(highlightedIndex);
  }, [highlightedIndex, isOpen, scrollToFontIndex]);

  const select = useCallback(
    (family: string) => {
      const providerId = onlineProviders.get(family);
      if (!providerId) {
        onChange(family);
        setQuery(family);
        setIsOpen(false);
        inputRef.current?.blur();
        return;
      }

      // Online results are not document fonts yet. Install and wait for the
      // exact binary to parse/register before mutating the node, so a failed
      // request leaves the previous face and editing session intact.
      setInstallError(null);
      setInstallingFamily(family);
      void downloadAndApplyOnlineFont(family, providerId)
        .then(() => {
          onChange(family);
          setQuery(family);
          setIsOpen(false);
          inputRef.current?.blur();
        })
        .catch((error: unknown) => {
          setInstallError(
            error instanceof Error ? error.message : 'This font could not be installed.',
          );
        })
        .finally(() => setInstallingFamily(null));
    },
    [onChange, onlineProviders],
  );

  const handleInputFocus = useCallback(() => {
    setIsOpen(true);
    setHighlightedIndex(-1);
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    setIsOpen(true);
    setHighlightedIndex(0);
  }, []);

  const handleInputBlur = useCallback(() => {
    setTimeout(() => {
      setIsOpen(false);
      setQuery(value);
      setHighlightedIndex(-1);
    }, 150);
  }, [value]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (!isOpen) {
            setIsOpen(true);
            highlight(0);
          } else {
            highlight(highlightedIndex + 1);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          highlight(highlightedIndex - 1);
          break;
        case 'Enter':
          e.preventDefault();
          if (highlightedIndex >= 0 && flatList[highlightedIndex] !== undefined) {
            select(flatList[highlightedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          setQuery(value);
          setHighlightedIndex(-1);
          break;
        case 'Home':
          e.preventDefault();
          highlight(0);
          break;
        case 'End':
          e.preventDefault();
          highlight(flatList.length - 1);
          break;
      }
    },
    [isOpen, highlightedIndex, flatList, select, highlight, value],
  );

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const getMeta = (family: string): FontMetadata | undefined => registry.getMetadata(family);

  const getSourceBadge = (family: string): string => {
    const entries = registry.getEntries(family);
    const first = entries[0];
    if (!first) return '';
    return SOURCE_BADGES[first.source] ?? '';
  };

  return (
    <div className={className ? `font-selector ${className}` : 'font-selector'}>
      <label className="font-selector__label" htmlFor={inputId}>
        {label}
      </label>
      <div className="font-selector__input-wrapper">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          className="font-selector__input"
          value={query}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          onKeyDown={handleInputKeyDown}
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={
            highlightedIndex >= 0 ? `${listboxId}-option-${highlightedIndex}` : undefined
          }
          autoComplete="off"
        />
        {!hasMatch && query.trim() && (
          <Tooltip label="Font not in catalog">
            <span className="font-selector__warning" role="img" aria-label="Font not in catalog">
              !
            </span>
          </Tooltip>
        )}
      </div>
      {isOpen && (
        <div
          ref={listRef}
          id={listboxId}
          className="font-selector__dropdown"
          role="listbox"
          aria-label="Font families"
        >
          {flatList.length > 0 && (
            <div
              className="font-selector__virtual-content"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index];
                if (!row) return null;
                const rowStyle = {
                  position: 'absolute' as const,
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                };
                if (row.kind === 'section') {
                  return (
                    <div
                      key={virtualRow.key}
                      ref={virtualizer.measureElement}
                      data-index={virtualRow.index}
                      className="font-selector__virtual-row"
                      style={rowStyle}
                    >
                      <div className="font-selector__section-header" role="presentation">
                        {row.title}
                        {row.isOnline && (
                          <span className="font-selector__section-note">Click to download</span>
                        )}
                      </div>
                    </div>
                  );
                }

                const { family, index: idx } = row;
                const isHighlighted = idx === highlightedIndex;
                const isSelected = normalize(family) === normalize(value);
                const badge = row.isOnline ? '' : getSourceBadge(family);
                const isVar = !row.isOnline && registry.isVariable(family);
                const meta = row.isOnline ? undefined : getMeta(family);
                const colorTitle = meta?.paletteCount
                  ? `${(meta.colorFormats ?? []).join(', ')} · ${meta.paletteCount} palettes`
                  : (meta?.colorFormats ?? []).join(', ');

                return (
                  <div
                    key={virtualRow.key}
                    ref={virtualizer.measureElement}
                    data-index={virtualRow.index}
                    id={`${listboxId}-option-${idx}`}
                    className={`font-selector__virtual-row font-selector__option${isSelected ? ' font-selector__option--selected' : ''}${isHighlighted ? ' font-selector__option--highlighted' : ''}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={isSelected}
                    style={rowStyle}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      select(family);
                    }}
                    onMouseEnter={() => highlight(idx)}
                  >
                    <span
                      className="font-selector__option-name"
                      style={row.isOnline ? undefined : { fontFamily: `"${family}", sans-serif` }}
                    >
                      {family}
                    </span>
                    <span className="font-selector__option-meta">
                      {row.isOnline ? (
                        <span className="font-selector__badge font-selector__badge--online">W</span>
                      ) : (
                        <>
                          {badge && <span className="font-selector__badge">{badge}</span>}
                          {isVar && (
                            <span className="font-selector__badge font-selector__badge--var">
                              w
                            </span>
                          )}
                          {meta?.hasColorGlyphs && (
                            <Tooltip label={colorTitle}>
                              <span className="font-selector__badge font-selector__badge--color">
                                C
                              </span>
                            </Tooltip>
                          )}
                          {meta?.embeddingRights === 'restricted' && (
                            <Tooltip label={meta.license || 'Embedding restricted'}>
                              <span className="font-selector__badge font-selector__badge--license">
                                L
                              </span>
                            </Tooltip>
                          )}
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {googleFonts.loading && (
            <div className="font-selector__option font-selector__option--loading">
              Searching Google Fonts…
            </div>
          )}
          {googleFonts.error && (
            <div className="font-selector__option font-selector__option--error">
              {googleFonts.error}
            </div>
          )}
          {fontsource.loading && (
            <div className="font-selector__option font-selector__option--loading">
              Searching Fontsource…
            </div>
          )}
          {fontsource.error && (
            <div className="font-selector__option font-selector__option--error">
              {fontsource.error}
            </div>
          )}
          {installingFamily && (
            <div className="font-selector__option font-selector__option--loading" role="status">
              Installing {installingFamily}…
            </div>
          )}
          {installError && (
            <div className="font-selector__option font-selector__option--error" role="alert">
              {installError}
            </div>
          )}
          {flatList.length === 0 && !googleFonts.loading && !fontsource.loading && (
            <div className="font-selector__option font-selector__option--empty">No fonts match</div>
          )}
        </div>
      )}
    </div>
  );
}
