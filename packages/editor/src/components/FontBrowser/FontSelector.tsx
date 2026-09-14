/**
 * FontSelector — compact, local-first combobox for selecting a font family.
 *
 * Discovery uses the same semantic catalog as FontBrowser. It intentionally
 * shows installed faces only; installation is an explicit action in the full
 * browser so changing a document never starts a network request implicitly.
 */

import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { getFontRegistry, getFontSemanticCatalog } from '@varve/engine';
import {
  type FontReference,
  type FontSemanticRecord,
  fontReferenceKey,
  parseFontSemanticQuery,
  tagLabel,
} from '@varve/engine/font';
import { FloatingPortal, Icon, Tooltip } from '@varve/ui';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { FontFaceSelection } from './fontFaceSelection';
import './FontSelector.css';

export type { FontFaceSelection } from './fontFaceSelection';

export interface FontSelectorProps {
  value: string;
  onChange: (family: string) => void;
  /** Apply an exact registered face or named variable instance. */
  onSelectFace?: (selection: FontFaceSelection) => void;
  /** Exact artifact/member requested by the current text target, if any. */
  fontReference?: FontReference;
  /** Authored variation coordinates used to distinguish named instances. */
  variableAxes?: Record<string, number>;
  label?: string;
  className?: string;
}

type FontRow =
  | { kind: 'section'; key: string; title: string }
  | {
      kind: 'font';
      key: string;
      family: string;
      index: number;
      record: FontSemanticRecord;
      faces: FontFaceSelection[];
    }
  | {
      kind: 'face';
      key: string;
      family: string;
      parentFamilyId: string;
      selection: FontFaceSelection;
    };

const MENU_FALLBACKS: Array<'top-start'> = ['top-start'];
const MENU_FALLBACK_ROW_LIMIT = 120;

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

function fontReferenceFromFaceKey(
  faceKey: string | undefined,
  postScriptName: string | undefined,
): FontReference | undefined {
  const match = /^sha256:([0-9a-f]{64}):(single|[0-9]+)$/i.exec(faceKey ?? '');
  if (!match) return undefined;
  return {
    artifactHash: match[1]!.toLowerCase(),
    ...(match[2] === 'single' ? {} : { collectionIndex: Number(match[2]) }),
    ...(postScriptName ? { postScriptName } : {}),
  };
}

function faceIdentity(selection: FontFaceSelection): string {
  return selection.fontReference
    ? fontReferenceKey(selection.fontReference)
    : `${selection.family}\u0000${selection.postScriptName ?? ''}\u0000${selection.weight}\u0000${selection.style}\u0000${JSON.stringify(selection.variableAxes ?? {})}`;
}

function facesFor(
  record: FontSemanticRecord,
  registry: ReturnType<typeof getFontRegistry>,
): FontFaceSelection[] {
  const seen = new Set<string>();
  const metadataInstances = registry.getMetadata(record.familyName)?.namedInstances ?? [];
  return registry.getEntries(record.familyName).flatMap((entry, entryIndex) => {
    const base: FontFaceSelection = {
      family: record.familyName,
      weight: entry.weight,
      style: entry.style,
      ...(entry.postScriptName ? { postScriptName: entry.postScriptName } : {}),
      ...(fontReferenceFromFaceKey(entry.faceKey, entry.postScriptName)
        ? { fontReference: fontReferenceFromFaceKey(entry.faceKey, entry.postScriptName) }
        : {}),
    };
    const baseKey =
      entry.faceKey ??
      `${record.familyName}\u0000${entry.postScriptName ?? ''}\u0000${entry.weight}\u0000${entry.style}\u0000${entry.source}\u0000${entryIndex}`;
    const output: FontFaceSelection[] = [];
    if (!seen.has(baseKey)) {
      seen.add(baseKey);
      output.push(base);
    }
    const instances = entry.namedInstances ?? metadataInstances;
    for (const instance of instances) {
      const selection: FontFaceSelection = {
        ...base,
        namedInstanceName: instance.name,
        variableAxes: { ...instance.coordinates },
        weight: Math.round(instance.coordinates.wght ?? entry.weight),
        style: instance.coordinates.ital === 1 ? 'italic' : entry.style,
      };
      const key = `${baseKey}\u0000instance:${instance.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(selection);
    }
    return output;
  });
}

function faceLabel(selection: FontFaceSelection): string {
  if (selection.namedInstanceName) return selection.namedInstanceName;
  const style = selection.style === 'italic' ? ' Italic' : '';
  return `${selection.weight}${style}`;
}

function sameAxes(
  first: Record<string, number> | undefined,
  second: Record<string, number> | undefined,
): boolean {
  const firstEntries = Object.entries(first ?? {}).filter(([, value]) => Number.isFinite(value));
  const secondEntries = Object.entries(second ?? {}).filter(([, value]) => Number.isFinite(value));
  if (firstEntries.length !== secondEntries.length) return false;
  return firstEntries.every(([tag, value]) => second?.[tag] !== undefined && second[tag] === value);
}

function findFamilyRow(
  rows: FontRow[],
  start: number,
  direction: 1 | -1,
): Extract<FontRow, { kind: 'font' }> | undefined {
  for (let index = start; index >= 0 && index < rows.length; index += direction) {
    const row = rows[index];
    if (row?.kind === 'font') return row;
  }
  return undefined;
}

export function FontSelector({
  value,
  onChange,
  onSelectFace,
  fontReference,
  variableAxes,
  label = 'Font family',
  className,
}: FontSelectorProps) {
  const registry = useMemo(() => getFontRegistry(), []);
  const semantic = useMemo(() => getFontSemanticCatalog(), []);
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef(false);
  const expandedTargetRef = useRef<string | null>(null);
  // A portal mounts after this component's effects. Store its scroll element
  // in state so the virtualizer observes the real viewport once attached.
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
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
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [highlightedFaceKey, setHighlightedFaceKey] = useState<string | null>(null);
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(new Set());

  const results = useMemo(
    () =>
      semantic.search(parseFontSemanticQuery(query), {
        installedOnly: true,
        limit: Number.MAX_SAFE_INTEGER,
        diversity: false,
      }),
    [query, semantic, semanticRevision],
  );
  const records = useMemo(() => {
    const byName = new Map<string, FontSemanticRecord>();
    for (const result of results) byName.set(normalize(result.record.familyName), result.record);
    return [...byName.values()];
  }, [results]);

  const allInstalled = useMemo(() => {
    const byName = new Map<string, FontSemanticRecord>();
    for (const record of semantic.all()) {
      if (record.installed) byName.set(normalize(record.familyName), record);
    }
    return [...byName.values()].sort((a, b) => a.familyName.localeCompare(b.familyName));
  }, [semantic, semanticRevision, registryRevision]);
  const hasFamilyMatch = allInstalled.some(
    (record) => normalize(record.familyName) === normalize(value),
  );
  const requestedFaceKey = fontReference ? fontReferenceKey(fontReference) : undefined;
  const hasExactFaceMatch =
    !requestedFaceKey ||
    registry.getEntries(value).some((entry) => entry.faceKey === requestedFaceKey);
  const warningLabel = !hasFamilyMatch
    ? 'Font is not installed'
    : 'Exact font face is not installed; fallback is in use';
  const showWarning = (!hasFamilyMatch || !hasExactFaceMatch) && !isOpen && value.trim();

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
        'Favorites',
        allInstalled
          .filter((record) => record.isFavorite)
          .sort((a, b) => a.familyName.localeCompare(b.familyName)),
      );
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
    return sections.flatMap((section) => {
      const sectionRows: FontRow[] = [
        { kind: 'section', key: `section-${section.title}`, title: section.title },
      ];
      for (const record of section.records) {
        fontIndex += 1;
        const familyRow: FontRow = {
          kind: 'font' as const,
          key: `${section.title}-${record.familyId}`,
          family: record.familyName,
          index: fontIndex,
          record,
          faces: facesFor(record, registry),
        };
        sectionRows.push(familyRow);
        if (expandedFamilies.has(record.familyId)) {
          sectionRows.push(
            ...familyRow.faces.map((selection, faceIndex) => ({
              kind: 'face' as const,
              key: `${familyRow.key}-face-${faceIdentity(selection)}-${faceIndex}`,
              family: record.familyName,
              parentFamilyId: record.familyId,
              selection,
            })),
          );
        }
      }
      return sectionRows;
    });
  }, [expandedFamilies, registry, registryRevision, sections]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listElement,
    estimateSize: (index) => (rows[index]?.kind === 'section' ? 24 : 32),
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: 8,
    // aria-activedescendant must continue to name a mounted option even
    // when the user scrolls away from the keyboard selection.
    rangeExtractor: (range) => {
      const visible = defaultRangeExtractor(range);
      const active = highlightedFaceKey
        ? rows.findIndex((row) => row.kind === 'face' && row.key === highlightedFaceKey)
        : rows.findIndex((row) => row.kind === 'font' && row.index === highlightedIndex);
      return active < 0 ? visible : [...new Set([...visible, active])].sort((a, b) => a - b);
    },
  });

  // Portaled listboxes can render once before their scroll viewport has a
  // measurable client height (jsdom and the first animation frame both do
  // this). Keep a bounded set of rows mounted so the menu never appears empty
  // and aria-activedescendant always points at a real option. Once the viewport
  // reports a range, the normal virtualizer owns the list again.
  const virtualItems = virtualizer.getVirtualItems();
  const fallbackLayout = useMemo(() => {
    const starts: number[] = [];
    let totalSize = 0;
    for (const row of rows) {
      starts.push(totalSize);
      totalSize += row.kind === 'section' ? 24 : 32;
    }

    const indexes = new Set<number>();
    for (let index = 0; index < Math.min(rows.length, MENU_FALLBACK_ROW_LIMIT); index += 1) {
      indexes.add(index);
    }
    const activeRow = highlightedFaceKey
      ? rows.findIndex((row) => row.kind === 'face' && row.key === highlightedFaceKey)
      : rows.findIndex((row) => row.kind === 'font' && row.index === highlightedIndex);
    const pinned = activeRow >= 0 ? new Set([activeRow]) : new Set<number>();
    if (activeRow >= 0) indexes.add(activeRow);
    while (indexes.size > MENU_FALLBACK_ROW_LIMIT) {
      const removable = [...indexes].reverse().find((index) => !pinned.has(index));
      if (removable === undefined) break;
      indexes.delete(removable);
    }
    const items = [...indexes]
      .sort((a, b) => a - b)
      .map((index) => {
        const size = rows[index]?.kind === 'section' ? 24 : 32;
        return {
          index,
          key: rows[index]?.key ?? index,
          start: starts[index] ?? 0,
          size,
          end: (starts[index] ?? 0) + size,
          lane: 0,
        };
      });
    return { items, totalSize };
  }, [highlightedFaceKey, highlightedIndex, rows]);
  const renderedVirtualItems = virtualItems.length > 0 ? virtualItems : fallbackLayout.items;
  const contentHeight =
    virtualItems.length > 0 ? virtualizer.getTotalSize() : fallbackLayout.totalSize;

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
      setHighlightedFaceKey(null);
      if (clamped >= 0 && isOpen) scrollToFontIndex(clamped);
    },
    [flatList.length, isOpen, scrollToFontIndex],
  );

  useEffect(() => {
    if (isOpen && highlightedIndex >= 0) scrollToFontIndex(highlightedIndex);
  }, [highlightedIndex, isOpen, scrollToFontIndex]);

  useEffect(() => {
    const familyId = expandedTargetRef.current;
    if (!isOpen || !familyId) return;
    const familyRowIndex = rows.findIndex(
      (row) => row.kind === 'font' && row.record.familyId === familyId,
    );
    if (familyRowIndex < 0) return;
    expandedTargetRef.current = null;
    // Wait for the expanded rows to be measured before moving the portaled
    // viewport. This keeps the newly revealed faces visible even when the
    // family was at the bottom edge of the compact menu.
    requestAnimationFrame(() => virtualizer.scrollToIndex(familyRowIndex + 1, { align: 'start' }));
  }, [isOpen, rows, virtualizer]);

  const select = useCallback(
    (family: string) => {
      const record = allInstalled.find(
        (candidate) => normalize(candidate.familyName) === normalize(family),
      );
      if (record) semantic.markRecentlyUsed(record.familyId);
      onChange(family);
      setIsOpen(false);
      setHighlightedIndex(-1);
      setHighlightedFaceKey(null);
      // A pointer selection normally keeps focus in the input because the
      // option consumes mousedown. Restore it for programmatic/assistive
      // activation too, while suppressing the focus handler's reopen path.
      if (document.activeElement !== inputRef.current) {
        restoreFocusRef.current = true;
        inputRef.current?.focus();
      }
    },
    [allInstalled, onChange, semantic],
  );

  const selectFace = useCallback(
    (selection: FontFaceSelection) => {
      const record = allInstalled.find(
        (candidate) => normalize(candidate.familyName) === normalize(selection.family),
      );
      if (record) semantic.markRecentlyUsed(record.familyId);
      if (onSelectFace) onSelectFace(selection);
      else onChange(selection.family);
      setIsOpen(false);
      setHighlightedIndex(-1);
      setHighlightedFaceKey(null);
      if (document.activeElement !== inputRef.current) {
        restoreFocusRef.current = true;
        inputRef.current?.focus();
      }
    },
    [allInstalled, onChange, onSelectFace, semantic],
  );

  const toggleExpanded = useCallback((familyId: string) => {
    setExpandedFamilies((previous) => {
      const next = new Set(previous);
      if (next.has(familyId)) {
        next.delete(familyId);
      } else {
        next.add(familyId);
        expandedTargetRef.current = familyId;
      }
      return next;
    });
  }, []);

  const handleInputFocus = useCallback(() => {
    if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      return;
    }
    setQuery('');
    setIsOpen(true);
    setHighlightedIndex(-1);
    setHighlightedFaceKey(null);
  }, []);

  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
    setIsOpen(true);
    setHighlightedIndex(0);
    setHighlightedFaceKey(null);
  }, []);

  const dismiss = useCallback(() => {
    setIsOpen(false);
    setHighlightedIndex(-1);
    setHighlightedFaceKey(null);
  }, []);

  const scrollToRow = useCallback(
    (rowKey: string) => {
      const rowIndex = rows.findIndex((row) => row.key === rowKey);
      if (rowIndex >= 0) virtualizer.scrollToIndex(rowIndex, { align: 'auto' });
    },
    [rows, virtualizer],
  );

  const highlightFace = useCallback(
    (rowKey: string) => {
      setHighlightedIndex(-1);
      setHighlightedFaceKey(rowKey);
      if (isOpen) scrollToRow(rowKey);
    },
    [isOpen, scrollToRow],
  );

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.nativeEvent.isComposing) return;
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          if (!isOpen) {
            setQuery('');
            setIsOpen(true);
            setHighlightedFaceKey(null);
            highlight(0);
          } else if (!event.altKey) {
            const activeFaceIndex = highlightedFaceKey
              ? rows.findIndex((row) => row.kind === 'face' && row.key === highlightedFaceKey)
              : -1;
            if (activeFaceIndex >= 0) {
              const nextFace = rows[activeFaceIndex + 1];
              if (nextFace?.kind === 'face') {
                highlightFace(nextFace.key);
              } else {
                highlight(findFamilyRow(rows, activeFaceIndex + 1, 1)?.index ?? 0);
              }
            } else {
              const activeFamilyIndex = rows.findIndex(
                (row) => row.kind === 'font' && row.index === highlightedIndex,
              );
              const activeFamily = activeFamilyIndex >= 0 ? rows[activeFamilyIndex] : undefined;
              const firstFace =
                activeFamily?.kind === 'font' && expandedFamilies.has(activeFamily.record.familyId)
                  ? rows.find(
                      (row) =>
                        row.kind === 'face' && row.parentFamilyId === activeFamily.record.familyId,
                    )
                  : undefined;
              if (firstFace) highlightFace(firstFace.key);
              else highlight(findFamilyRow(rows, activeFamilyIndex + 1, 1)?.index ?? 0);
            }
          }
          break;
        case 'ArrowUp':
          event.preventDefault();
          if (!isOpen) {
            setQuery('');
            setIsOpen(true);
            setHighlightedFaceKey(null);
          }
          {
            const activeFaceIndex = highlightedFaceKey
              ? rows.findIndex((row) => row.kind === 'face' && row.key === highlightedFaceKey)
              : -1;
            if (activeFaceIndex > 0) {
              const previousFace = rows[activeFaceIndex - 1];
              if (previousFace?.kind === 'face') {
                highlightFace(previousFace.key);
              } else {
                highlight(
                  findFamilyRow(rows, activeFaceIndex - 1, -1)?.index ?? flatList.length - 1,
                );
              }
            } else {
              const activeFamilyIndex = rows.findIndex(
                (row) => row.kind === 'font' && row.index === highlightedIndex,
              );
              highlight(
                findFamilyRow(rows, activeFamilyIndex - 1, -1)?.index ?? flatList.length - 1,
              );
            }
          }
          break;
        case 'ArrowRight': {
          if (!isOpen) break;
          const activeFamily = rows.find(
            (row) => row.kind === 'font' && row.index === highlightedIndex,
          );
          if (activeFamily?.kind !== 'font' || activeFamily.faces.length <= 1) break;
          event.preventDefault();
          if (!expandedFamilies.has(activeFamily.record.familyId)) {
            toggleExpanded(activeFamily.record.familyId);
          } else {
            const firstFace = rows.find(
              (row) => row.kind === 'face' && row.parentFamilyId === activeFamily.record.familyId,
            );
            if (firstFace) highlightFace(firstFace.key);
          }
          break;
        }
        case 'ArrowLeft': {
          if (!isOpen) break;
          const activeFace = highlightedFaceKey
            ? rows.find((row) => row.kind === 'face' && row.key === highlightedFaceKey)
            : undefined;
          const activeFamily = rows.find(
            (row) => row.kind === 'font' && row.index === highlightedIndex,
          );
          const parentFamilyId =
            activeFace?.kind === 'face'
              ? activeFace.parentFamilyId
              : activeFamily?.kind === 'font' && expandedFamilies.has(activeFamily.record.familyId)
                ? activeFamily.record.familyId
                : undefined;
          if (!parentFamilyId) break;
          event.preventDefault();
          const parentFamily = rows.find(
            (row) => row.kind === 'font' && row.record.familyId === parentFamilyId,
          );
          toggleExpanded(parentFamilyId);
          if (parentFamily?.kind === 'font') highlight(parentFamily.index);
          break;
        }
        case 'Enter':
          if (!isOpen) break;
          event.preventDefault();
          if (highlightedFaceKey) {
            const faceRow = rows.find(
              (row): row is Extract<FontRow, { kind: 'face' }> =>
                row.kind === 'face' && row.key === highlightedFaceKey,
            );
            if (faceRow) selectFace(faceRow.selection);
          } else if (highlightedIndex >= 0 && flatList[highlightedIndex]) {
            select(flatList[highlightedIndex]!.familyName);
          }
          break;
        case 'Escape':
          if (!isOpen) break;
          event.preventDefault();
          // The floating text toolbar also listens for Escape to finish text
          // editing. Dismiss this nested combobox first and keep the event
          // inside the picker; a second Escape can then close the toolbar.
          event.stopPropagation();
          dismiss();
          break;
      }
    },
    [
      dismiss,
      expandedFamilies,
      flatList,
      highlight,
      highlightFace,
      highlightedFaceKey,
      highlightedIndex,
      isOpen,
      rows,
      select,
      selectFace,
      toggleExpanded,
    ],
  );

  return (
    <div className={className ? `font-selector ${className}` : 'font-selector'}>
      <label className="font-selector__label" htmlFor={inputId}>
        {label}
      </label>
      <div
        className={`font-selector__input-wrapper${showWarning ? ' font-selector__input-wrapper--warning' : ''}`}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          className="font-selector__input"
          value={isOpen ? query : value}
          placeholder={value || 'Search installed fonts'}
          aria-label={label}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onClick={() => {
            if (!isOpen) handleInputFocus();
          }}
          onBlur={dismiss}
          onKeyDown={handleInputKeyDown}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={
            isOpen && highlightedFaceKey
              ? (() => {
                  const activeRow = rows.findIndex(
                    (row) => row.kind === 'face' && row.key === highlightedFaceKey,
                  );
                  return activeRow >= 0 ? `${listboxId}-face-${activeRow}` : undefined;
                })()
              : isOpen && flatList[highlightedIndex]
                ? `${listboxId}-option-${highlightedIndex}`
                : undefined
          }
          autoComplete="off"
        />
        {showWarning && (
          <Tooltip label={warningLabel}>
            <span className="font-selector__warning" role="img" aria-label={warningLabel}>
              !
            </span>
          </Tooltip>
        )}
      </div>
      {isOpen && (
        <FloatingPortal
          anchorRef={inputRef}
          open
          placement="bottom-start"
          fallbackPlacements={MENU_FALLBACKS}
          offsetDistance={4}
          maxHeight={280}
          matchAnchorWidth
          kind="listbox"
          className="font-selector__menu-layer"
          onClose={dismiss}
          dismissOnPointerDown
        >
          <div
            ref={setListElement}
            id={listboxId}
            className="font-selector__dropdown"
            role="listbox"
            aria-label="Font families"
          >
            {flatList.length > 0 && (
              <div className="font-selector__virtual-content" style={{ height: contentHeight }}>
                {renderedVirtualItems.map((virtualRow) => {
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
                  if (row.kind === 'face') {
                    const selected =
                      row.selection.fontReference !== undefined &&
                      fontReference !== undefined &&
                      fontReferenceKey(row.selection.fontReference) ===
                        fontReferenceKey(fontReference) &&
                      sameAxes(row.selection.variableAxes, variableAxes);
                    return (
                      <div
                        key={virtualRow.key}
                        ref={virtualizer.measureElement}
                        data-index={virtualRow.index}
                        className="font-selector__virtual-row"
                        style={rowStyle}
                      >
                        <div
                          id={`${listboxId}-face-${virtualRow.index}`}
                          className={`font-selector__option font-selector__face-option${selected ? ' font-selector__option--selected' : ''}`}
                          role="option"
                          tabIndex={-1}
                          aria-selected={selected}
                          onMouseEnter={() => highlightFace(row.key)}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            selectFace(row.selection);
                          }}
                        >
                          <span
                            className="font-selector__option-name"
                            style={{
                              fontFamily: `"${row.family.replaceAll('"', '')}", sans-serif`,
                            }}
                          >
                            {faceLabel(row.selection)}
                          </span>
                          {row.selection.postScriptName && (
                            <span className="font-selector__face-meta">
                              {row.selection.postScriptName}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  }
                  const { family, index: idx, record, faces } = row;
                  const isHighlighted = idx === highlightedIndex;
                  const isSelected = normalize(family) === normalize(value);
                  const labels = recordLabels(record);
                  const isExpanded = expandedFamilies.has(record.familyId);
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
                      {faces.length > 1 && (
                        <button
                          type="button"
                          className="font-selector__expand-btn"
                          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${family} faces`}
                          aria-expanded={isExpanded}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleExpanded(record.familyId);
                          }}
                        >
                          <Icon name={isExpanded ? 'ChevronDown' : 'ChevronRight'} size={12} />
                        </button>
                      )}
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
                        {record.isFavorite && (
                          <span
                            className="font-selector__badge font-selector__badge--favorite"
                            title="Favorite"
                          >
                            <Icon name="Star" size={10} />
                          </span>
                        )}
                        <span
                          className="font-selector__badge"
                          title={record.sourceKinds.join(', ')}
                        >
                          {sourceBadge(record)}
                        </span>
                        {record.variable && (
                          <span
                            className="font-selector__badge font-selector__badge--var"
                            role="img"
                            aria-label="Variable font"
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
        </FloatingPortal>
      )}
    </div>
  );
}
