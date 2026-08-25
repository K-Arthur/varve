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

import type { FontMetadata } from '@varve/engine';
import { getFontRegistry } from '@varve/engine';
import { Tooltip } from '@varve/ui';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useOnlineFontSearch } from './useOnlineFontSearch';
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
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const allFamilies = useMemo(() => registry.families(), [registry]);

  const { googleFonts, fontsource } = useOnlineFontSearch(query);

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

  const highlight = useCallback(
    (index: number) => {
      const clamped = Math.max(-1, Math.min(index, flatList.length - 1));
      setHighlightedIndex(clamped);
      if (clamped >= 0) {
        const el = optionRefs.current.get(clamped);
        el?.scrollIntoView({ block: 'nearest' });
      }
    },
    [flatList.length],
  );

  const select = useCallback(
    (family: string) => {
      onChange(family);
      setQuery(family);
      setIsOpen(false);
      inputRef.current?.blur();
    },
    [onChange],
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

  let flatIndex = -1;

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
          aria-controls="font-selector-listbox"
          aria-activedescendant={
            highlightedIndex >= 0 ? `font-selector-option-${highlightedIndex}` : undefined
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
          id="font-selector-listbox"
          className="font-selector__dropdown"
          role="listbox"
          aria-label="Font families"
        >
          {sections.map((section) => (
            <div key={section.title}>
              <div className="font-selector__section-header" role="presentation">
                {section.title}
                {section.isOnline && (
                  <span className="font-selector__section-note">Click to download</span>
                )}
              </div>
              {section.families.map((family) => {
                flatIndex++;
                const idx = flatIndex;
                const isHighlighted = idx === highlightedIndex;
                const isSelected = normalize(family) === normalize(value);

                if (section.isOnline) {
                  return (
                    <div
                      key={`online-${family}`}
                      ref={(el) => {
                        if (el) optionRefs.current.set(idx, el);
                      }}
                      id={`font-selector-option-${idx}`}
                      className={`font-selector__option${isSelected ? ' font-selector__option--selected' : ''}${isHighlighted ? ' font-selector__option--highlighted' : ''}`}
                      role="option"
                      tabIndex={-1}
                      aria-selected={isSelected}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        select(family);
                      }}
                      onMouseEnter={() => highlight(idx)}
                    >
                      <span className="font-selector__option-name">{family}</span>
                      <span className="font-selector__option-meta">
                        <span className="font-selector__badge font-selector__badge--online">W</span>
                      </span>
                    </div>
                  );
                }

                const badge = getSourceBadge(family);
                const isVar = registry.isVariable(family);
                const meta = getMeta(family);
                const colorTitle = meta?.paletteCount
                  ? `${(meta.colorFormats ?? []).join(', ')} · ${meta.paletteCount} palettes`
                  : (meta?.colorFormats ?? []).join(', ');

                return (
                  <div
                    key={`${section.title}-${family}`}
                    ref={(el) => {
                      if (el) optionRefs.current.set(idx, el);
                    }}
                    id={`font-selector-option-${idx}`}
                    className={`font-selector__option${isSelected ? ' font-selector__option--selected' : ''}${isHighlighted ? ' font-selector__option--highlighted' : ''}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={isSelected}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      select(family);
                    }}
                    onMouseEnter={() => highlight(idx)}
                  >
                    <span
                      className="font-selector__option-name"
                      style={{ fontFamily: `"${family}", sans-serif` }}
                    >
                      {family}
                    </span>
                    <span className="font-selector__option-meta">
                      {badge && <span className="font-selector__badge">{badge}</span>}
                      {isVar && (
                        <span className="font-selector__badge font-selector__badge--var">w</span>
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
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          {googleFonts.loading && (
            <div className="font-selector__option font-selector__option--loading">
              Searching Google Fonts…
            </div>
          )}
          {googleFonts.error && (
            <div className="font-selector__option font-selector__option--error">
              Google Fonts: {googleFonts.error}
            </div>
          )}
          {fontsource.loading && (
            <div className="font-selector__option font-selector__option--loading">
              Searching Fontsource…
            </div>
          )}
          {fontsource.error && (
            <div className="font-selector__option font-selector__option--error">
              Fontsource: {fontsource.error}
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
