/**
 * FontSelector — compact, local-first combobox for selecting a font family.
 *
 * Discovery uses the same semantic catalog as FontBrowser. It intentionally
 * shows installed faces only; installation is an explicit action in the full
 * browser so changing a document never starts a network request implicitly.
 */

import { useVirtualizer } from '@tanstack/react-virtual';
import { getFontRegistry, getFontSemanticCatalog } from '@varve/engine';
import { type FontSemanticRecord, parseFontSemanticQuery, tagLabel } from '@varve/engine/font';
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
import './FontSelector.css';

export interface FontSelectorProps {
  value: string;
  onChange: (family: string) => void;
  label?: string;
  className?: string;
}

type FontRow =
  | { kind: 'section'; key: string; title: string }
  | { kind: 'font'; key: string; family: string; index: number; record: FontSemanticRecord };

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function sourceBadge(record: FontSemanticRecord): string {
  if (record.sourceKinds.includes('system')) return 'S';
  if (record.sourceKinds.includes('bundled')) return 'B';
  if (record.sourceKinds.includes('project')) return 'P';
  return 'U';
}

function recordLabels(record: FontSemanticRecord): string[] {
  return [
    ...new Map(
      record.profile.assignments
        .filter((assignment) => assignment.tagId.startsWith('classification.'))
        .map((assignment) => [tagLabel(assignment.tagId), assignment]),
    ).keys(),
  ].slice(0, 2);
}

export function FontSelector({
  value,
  onChange,
  label = 'Font family',
  className,
}: FontSelectorProps) {
  const registry = useMemo(() => getFontRegistry(), []);
  const semantic = useMemo(() => getFontSemanticCatalog(), []);
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const registrySubscribe = useCallback(
    (listener: () => void) => registry.subscribe(listener),
    [registry],
  );
  const registryRevision = useSyncExternalStore(
    registrySubscribe,
    () => registry.revision,
    () => registry.revision,
  );
  const semanticSubscribe = useCallback(
    (listener: () => void) => semantic.subscribe(listener),
    [semantic],
  );
  const semanticRevision = useSyncExternalStore(
    semanticSubscribe,
    () => semantic.revision,
    () => semantic.revision,
  );

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const results = useMemo(
    () =>
      semantic.search(parseFontSemanticQuery(query), {
        installedOnly: true,
        limit: 120,
        diversity: false,
      }),
    [query, semantic, semanticRevision],
  );
  const records = useMemo(() => {
    const byName = new Map<string, FontSemanticRecord>();
    for (const result of results) byName.set(normalize(result.record.familyName), result.record);
    return [...byName.values()];
  }, [results]);

  const hasMatch = records.some((record) => normalize(record.familyName) === normalize(query));
  const allInstalled = useMemo(() => {
    const byName = new Map<string, FontSemanticRecord>();
    for (const record of semantic.all()) {
      if (record.installed) byName.set(normalize(record.familyName), record);
    }
    return [...byName.values()].sort((a, b) => a.familyName.localeCompare(b.familyName));
  }, [semantic, semanticRevision, registryRevision]);

  const sections = useMemo(() => {
    const sections: Array<{ title: string; records: FontSemanticRecord[] }> = [];
    const used = new Set<string>();
    const add = (title: string, values: FontSemanticRecord[]) => {
      const unique = values.filter((record) => !used.has(record.familyId));
      if (unique.length === 0) return;
      for (const record of unique) used.add(record.familyId);
      sections.push({ title, records: unique });
    };

    if (!query.trim()) {
      add(
        'Recent',
        allInstalled
          .filter((record) => record.recentlyUsedAt !== undefined)
          .sort((a, b) => (b.recentlyUsedAt ?? 0) - (a.recentlyUsedAt ?? 0))
          .slice(0, 5),
      );
    }
    const sourceRecords = (source: 'system' | 'bundled') =>
      records.filter((record) => record.sourceKinds.includes(source));
    add('System', sourceRecords('system'));
    add('Bundled', sourceRecords('bundled'));
    add(query.trim() ? 'Matches' : 'Installed', records);
    return sections;
  }, [allInstalled, query, records]);

  const flatList = useMemo(() => sections.flatMap((section) => section.records), [sections]);
  const rows = useMemo<FontRow[]>(() => {
    let fontIndex = -1;
    return sections.flatMap((section) => [
      { kind: 'section' as const, key: `section-${section.title}`, title: section.title },
      ...section.records.map((record) => {
        fontIndex += 1;
        return {
          kind: 'font' as const,
          key: `${section.title}-${record.familyId}`,
          family: record.familyName,
          index: fontIndex,
          record,
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

  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
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
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          if (!isOpen) {
            setIsOpen(true);
            highlight(0);
          } else highlight(highlightedIndex + 1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          highlight(highlightedIndex - 1);
          break;
        case 'Enter':
          event.preventDefault();
          if (highlightedIndex >= 0 && flatList[highlightedIndex])
            select(flatList[highlightedIndex]!.familyName);
          break;
        case 'Escape':
          event.preventDefault();
          setIsOpen(false);
          setQuery(value);
          setHighlightedIndex(-1);
          break;
        case 'Home':
          event.preventDefault();
          highlight(0);
          break;
        case 'End':
          event.preventDefault();
          highlight(flatList.length - 1);
          break;
      }
    },
    [flatList, highlight, highlightedIndex, isOpen, select, value],
  );

  useEffect(() => setQuery(value), [value]);

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
          <Tooltip label="Font is not installed">
            <span className="font-selector__warning" role="img" aria-label="Font is not installed">
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
                      </div>
                    </div>
                  );
                }
                const { family, index: idx, record } = row;
                const isHighlighted = idx === highlightedIndex;
                const isSelected = normalize(family) === normalize(value);
                const labels = recordLabels(record);
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
                    onMouseDown={(event) => {
                      event.preventDefault();
                      select(family);
                    }}
                    onMouseEnter={() => highlight(idx)}
                  >
                    <span
                      className="font-selector__option-name"
                      style={{ fontFamily: `"${family.replaceAll('"', '')}", sans-serif` }}
                    >
                      {family}
                    </span>
                    <span className="font-selector__option-meta">
                      {labels.map((label) => (
                        <span
                          key={label}
                          className="font-selector__badge font-selector__badge--label"
                          title={label}
                        >
                          {label.slice(0, 1)}
                        </span>
                      ))}
                      <span className="font-selector__badge" title={record.sourceKinds.join(', ')}>
                        {sourceBadge(record)}
                      </span>
                      {record.variable && (
                        <span
                          className="font-selector__badge font-selector__badge--var"
                          title="Variable font"
                        >
                          w
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {flatList.length === 0 && (
            <div className="font-selector__option font-selector__option--empty">
              No installed fonts match
            </div>
          )}
        </div>
      )}
    </div>
  );
}
