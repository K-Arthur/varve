/**
 * Full semantic font browser.
 *
 * FontSemanticCatalog is the discovery source for this surface. FontRegistry
 * remains the runtime face loader, so a downloadable result is still only
 * preview-only for document use until the user explicitly installs it.
 */

import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { getFontRegistry } from '@varve/engine';
import type { FontReference } from '@varve/engine/font';
import {
  enumerateSystemFonts,
  type FontSearchResult,
  type FontSemanticRecord,
  findFontAlternatives,
  findFontPairings,
  findSimilarFonts,
  getFontSemanticCatalog,
  getSystemFontDiscoveryStatus,
  hasQueryLocalFonts,
  parseFontSemanticQuery,
  resetSystemFontCache,
  tagLabel,
} from '@varve/engine/font';
import { Icon, IconButton, SearchField, Tooltip } from '@varve/ui';
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
  /** Apply the exact registered face selected in the expanded face list. */
  onSelectFace?: (selection: FontFaceSelection) => void;
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
  key: string;
  faceKey?: string;
  postScriptName?: string;
  namedInstanceName?: string;
  variableAxes?: Record<string, number>;
  weight: number;
  style: string;
  source: string;
  fontReference?: FontReference;
}

export interface FontFaceSelection {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  postScriptName?: string;
  fontReference?: FontReference;
  variableAxes?: Record<string, number>;
  namedInstanceName?: string;
}

interface FontDisplayEntry {
  record: FontSemanticRecord;
  result: FontSearchResult;
  faces: FontFaceEntry[];
}

interface VariableAxesPanelProps {
  record: FontSemanticRecord;
  values: Record<string, number>;
  onChange: (tag: string, value: number) => void;
  onReset: () => void;
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

function axisSettings(values: Record<string, number>): string | undefined {
  const settings = Object.entries(values)
    .filter(([tag, value]) => /^[A-Za-z]{4}$/.test(tag) && Number.isFinite(value))
    .map(([tag, value]) => `"${tag}" ${value}`)
    .join(', ');
  return settings || undefined;
}

function axisStep(min: number, max: number): number {
  const span = max - min;
  return span >= 100 ? 1 : span / 100;
}

function VariableAxesPanel({ record, values, onChange, onReset }: VariableAxesPanelProps) {
  if (!record.axes.length) return null;
  const hasCustomValues = record.axes.some(
    (axis) => (values[axis.tag] ?? axis.default) !== axis.default,
  );
  return (
    <section className="font-browser__axes" aria-label="Variable font axes">
      <div className="font-browser__axes-header">
        <div>
          <strong>Variable axes</strong>
          <span>Adjust the selected face before applying it.</span>
        </div>
        <button type="button" onClick={onReset} disabled={!hasCustomValues}>
          Reset
        </button>
      </div>
      {record.axes.map((axis) => {
        const value = values[axis.tag] ?? axis.default;
        const label = `${axis.name || axis.tag} (${axis.tag})`;
        return (
          <div className="font-browser__axis" key={axis.tag}>
            <div className="font-browser__axis-label">
              <label htmlFor={`font-axis-${record.familyId}-${axis.tag}`}>{label}</label>
              <output htmlFor={`font-axis-${record.familyId}-${axis.tag}`}>{value}</output>
            </div>
            <input
              id={`font-axis-${record.familyId}-${axis.tag}`}
              type="range"
              min={axis.min}
              max={axis.max}
              step={axisStep(axis.min, axis.max)}
              value={value}
              aria-label={label}
              onChange={(event) => onChange(axis.tag, Number(event.target.value))}
            />
            <div className="font-browser__axis-range" aria-hidden="true">
              <span>{axis.min}</span>
              <span>{axis.default} default</span>
              <span>{axis.max}</span>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function facesFor(
  record: FontSemanticRecord,
  registry: ReturnType<typeof getFontRegistry>,
): FontFaceEntry[] {
  // Expand only faces the runtime has actually registered. Catalog weights
  // and styles describe a family, but inventing PostScript names for every
  // Cartesian combination makes an unavailable face look selectable.
  const seen = new Set<string>();
  return registry.getEntries(record.familyName).flatMap((entry, index) => {
    const key =
      entry.faceKey ??
      `${record.familyName}\u0000${entry.postScriptName ?? ''}\u0000${entry.weight}\u0000${entry.style}\u0000${entry.source}\u0000${index}`;
    const baseFace: FontFaceEntry = {
      key,
      ...(entry.faceKey ? { faceKey: entry.faceKey } : {}),
      ...(entry.postScriptName ? { postScriptName: entry.postScriptName } : {}),
      weight: entry.weight,
      style: entry.style,
      source: entry.source,
      ...(fontReferenceFromFaceKey(entry.faceKey, entry.postScriptName)
        ? { fontReference: fontReferenceFromFaceKey(entry.faceKey, entry.postScriptName) }
        : {}),
    };
    if (seen.has(key)) return [];
    seen.add(key);
    const instances =
      entry.namedInstances ?? registry.getMetadata(record.familyName)?.namedInstances ?? [];
    const instanceFaces = instances.flatMap((instance) => {
      const instanceKey = `${key}\u0000instance:${instance.name}`;
      if (seen.has(instanceKey)) return [];
      seen.add(instanceKey);
      const weight = instance.coordinates.wght ?? entry.weight;
      const style = instance.coordinates.ital === 1 ? 'italic' : entry.style;
      return [
        {
          ...baseFace,
          key: instanceKey,
          namedInstanceName: instance.name,
          variableAxes: { ...instance.coordinates },
          weight,
          style,
        },
      ];
    });
    return [
      {
        ...baseFace,
      },
      ...instanceFaces,
    ];
  });
}

export function FontBrowser({
  onSelect,
  onSelectFace,
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
  const [selectedFace, setSelectedFace] = useState<FontFaceSelection | undefined>();
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(new Set());
  const [activeFamilyIndex, setActiveFamilyIndex] = useState(-1);
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const [installingFamily, setInstallingFamily] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const [axisDraft, setAxisDraft] = useState<Record<string, number>>({});
  const [previewText, setPreviewText] = useState('The quick brown fox jumps over the lazy dog');
  const [previewStatus, setPreviewStatus] = useState<FontPreviewStatus>('unavailable');
  const [previewMessage, setPreviewMessage] = useState<string | undefined>();
  const [localFontStatus, setLocalFontStatus] = useState<
    'idle' | 'loading' | 'ready' | 'permission-denied' | 'fallback' | 'unsupported' | 'error'
  >('idle');
  const [localFontCount, setLocalFontCount] = useState(0);
  const previewFaceRef = useRef<FontFace | undefined>(undefined);
  const familyButtonRefs = useRef(new Map<number, HTMLButtonElement>());
  const tagInputId = useId();
  const localFontApiAvailable = useMemo(() => hasQueryLocalFonts(), []);

  useEffect(() => {
    setSelectedFamily(selectedFamilyProp);
    setSelectedFace(undefined);
    setAxisDraft({});
  }, [selectedFamilyProp]);

  const effectiveQuery = useMemo(() => {
    const filterQuery = SEMANTIC_FILTERS.find((filter) => filter.key === semanticFilter)?.query;
    return [searchQuery.trim(), filterQuery].filter(Boolean).join(' ');
  }, [searchQuery, semanticFilter]);

  const hasActiveFilters =
    searchQuery.trim().length > 0 || activeFilter !== 'all' || semanticFilter !== 'all';
  const resetFilters = useCallback(() => {
    setSearchQuery('');
    setActiveFilter('all');
    setSemanticFilter('all');
  }, []);

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
    // A record can be returned by both the literal-family fast path and the
    // semantic ranker during a catalog revision. Keep one row per portable
    // family identity so virtualization keys remain unique and the manager
    // never shows duplicate families while a search is settling.
    const seen = new Set<string>();
    const entries = searchResults.flatMap((result) => {
      if (!showDownloadable && !result.record.installed) return [];
      if (!sourceMatches(result.record, activeFilter)) return [];
      if (seen.has(result.record.familyId)) return [];
      seen.add(result.record.familyId);
      return [
        {
          record: result.record,
          result,
          faces: facesFor(result.record, registry),
        },
      ];
    });
    if (effectiveQuery) return entries;
    return entries.sort((a, b) => a.record.familyName.localeCompare(b.record.familyName));
  }, [activeFilter, effectiveQuery, registry, searchResults, showDownloadable]);

  const virtualizer = useVirtualizer({
    count: displayEntries.length,
    getScrollElement: () => listElement,
    estimateSize: () => 58,
    getItemKey: (index) => displayEntries[index]?.record.familyId ?? index,
    overscan: 8,
    rangeExtractor: (range) => {
      const visible = defaultRangeExtractor(range);
      if (activeFamilyIndex < 0) return visible;
      return [...new Set([...visible, activeFamilyIndex])].sort((a, b) => a - b);
    },
  });
  const virtualItems = virtualizer.getVirtualItems();
  // A zero-sized jsdom viewport (and the first render before a portal/list
  // element is attached) has no measurable range. Keep the content usable in
  // that state; a real viewport switches to the measured range immediately.
  const rowsToRender =
    virtualItems.length > 0
      ? virtualItems
      : displayEntries.map((entry, index) => ({
          index,
          key: entry.record.familyId,
          start: 0,
          end: 0,
          size: 0,
          lane: 0,
        }));

  const firstVirtualIndex = virtualItems[0]?.index ?? -1;
  const lastVirtualIndex = virtualItems[virtualItems.length - 1]?.index ?? -1;

  useEffect(() => {
    setActiveFamilyIndex((current) => (current >= displayEntries.length ? -1 : current));
  }, [displayEntries.length]);

  useEffect(() => {
    if (activeFamilyIndex < 0) return;
    const focusActiveFamily = () => {
      familyButtonRefs.current.get(activeFamilyIndex)?.focus();
    };
    if (familyButtonRefs.current.has(activeFamilyIndex)) {
      focusActiveFamily();
      return;
    }
    const frame = window.requestAnimationFrame(focusActiveFamily);
    return () => window.cancelAnimationFrame(frame);
  }, [activeFamilyIndex, firstVirtualIndex, lastVirtualIndex]);

  const moveFamilyFocus = useCallback(
    (index: number) => {
      if (index < 0 || index >= displayEntries.length) return;
      setActiveFamilyIndex(index);
      if (listElement) virtualizer.scrollToIndex(index, { align: 'auto' });
      familyButtonRefs.current.get(index)?.focus();
    },
    [displayEntries.length, listElement, virtualizer],
  );

  const selectedRecord = selectedFamily ? semantic.findByFamilyName(selectedFamily) : undefined;
  const selectedFaces = useMemo(
    () => (selectedRecord ? facesFor(selectedRecord, registry) : []),
    [registry, selectedRecord],
  );
  const selectedResult = selectedRecord
    ? (searchResults.find((result) => result.record.familyId === selectedRecord.familyId) ??
      semantic.search(selectedRecord.familyName, {
        installedOnly: false,
        limit: 1,
        diversity: false,
      })[0])
    : undefined;

  useEffect(() => {
    if (!selectedRecord || selectedRecord.axes.length === 0) {
      setAxisDraft({});
      return;
    }
    const baseFace = selectedFaces[0];
    setAxisDraft(
      Object.fromEntries(
        selectedRecord.axes.map((axis) => [
          axis.tag,
          baseFace?.variableAxes?.[axis.tag] ?? axis.default,
        ]),
      ),
    );
  }, [selectedRecord?.familyId, selectedFaces]);

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
      setSelectedFace(undefined);
      semantic.markRecentlyUsed(record.familyId);
    },
    [semantic],
  );

  const handleSelectFace = useCallback(
    (record: FontSemanticRecord, face: FontFaceEntry) => {
      const selection: FontFaceSelection = {
        family: record.familyName,
        weight: face.weight,
        style: face.style === 'italic' ? 'italic' : 'normal',
        ...(face.postScriptName ? { postScriptName: face.postScriptName } : {}),
        ...(face.fontReference ? { fontReference: face.fontReference } : {}),
        ...(face.variableAxes ? { variableAxes: face.variableAxes } : {}),
        ...(face.namedInstanceName ? { namedInstanceName: face.namedInstanceName } : {}),
      };
      setSelectedFamily(record.familyName);
      setSelectedFace(selection);
      setAxisDraft(
        Object.fromEntries(
          record.axes.map((axis) => [axis.tag, face.variableAxes?.[axis.tag] ?? axis.default]),
        ),
      );
      semantic.markRecentlyUsed(record.familyId);
    },
    [semantic],
  );

  const toggleFavorite = useCallback(
    (record: FontSemanticRecord) => {
      semantic.setFavorite(record.familyId, !record.isFavorite);
    },
    [semantic],
  );

  const handleAxisChange = useCallback(
    (tag: string, value: number) => {
      if (!selectedRecord || !Number.isFinite(value)) return;
      const axis = selectedRecord.axes.find((candidate) => candidate.tag === tag);
      if (!axis) return;
      const nextValue = Math.min(axis.max, Math.max(axis.min, value));
      const nextAxes = { ...axisDraft, [tag]: nextValue };
      const baseFace = selectedFace ?? selectedFaces[0];
      setAxisDraft(nextAxes);
      if (baseFace) {
        setSelectedFace({
          family: selectedRecord.familyName,
          weight: Math.round(nextAxes.wght ?? baseFace.weight),
          style: baseFace.style === 'italic' ? 'italic' : 'normal',
          ...(baseFace.postScriptName ? { postScriptName: baseFace.postScriptName } : {}),
          ...(baseFace.fontReference ? { fontReference: baseFace.fontReference } : {}),
          variableAxes: nextAxes,
        });
      } else {
        setSelectedFace({
          family: selectedRecord.familyName,
          weight: Math.round(nextAxes.wght ?? 400),
          style: 'normal',
          variableAxes: nextAxes,
        });
      }
    },
    [axisDraft, selectedFace, selectedFaces, selectedRecord],
  );

  const resetAxes = useCallback(() => {
    if (!selectedRecord) return;
    const defaults = Object.fromEntries(
      selectedRecord.axes.map((axis) => [axis.tag, axis.default]),
    );
    setAxisDraft(defaults);
    const baseFace = selectedFace ?? selectedFaces[0];
    if (baseFace) {
      setSelectedFace({
        family: selectedRecord.familyName,
        weight: Math.round(defaults.wght ?? baseFace.weight),
        style: baseFace.style === 'italic' ? 'italic' : 'normal',
        ...(baseFace.postScriptName ? { postScriptName: baseFace.postScriptName } : {}),
        ...(baseFace.fontReference ? { fontReference: baseFace.fontReference } : {}),
        variableAxes: defaults,
      });
    }
  }, [selectedFace, selectedFaces, selectedRecord]);

  const applySelected = useCallback(() => {
    if (!selectedRecord?.installed) return;
    if (selectedFace && onSelectFace) {
      onSelectFace(selectedFace);
      return;
    }
    onSelect?.(selectedRecord.familyName);
  }, [onSelect, onSelectFace, selectedFace, selectedRecord]);

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

  const refreshLocalFonts = useCallback(async () => {
    setLocalFontStatus('loading');
    try {
      // Enumeration is deliberately user initiated. Search, hover, and
      // opening the picker never invoke either the native scanner or the
      // browser Local Font Access permission prompt.
      resetSystemFontCache();
      const families = await enumerateSystemFonts();
      semantic.syncRegistry(registry);
      semantic.notifyExternalChange();
      setLocalFontCount(families.length);
      const status = getSystemFontDiscoveryStatus();
      setLocalFontStatus(
        status === 'permission-denied'
          ? 'permission-denied'
          : status === 'fallback' || status === 'unsupported'
            ? status
            : 'ready',
      );
    } catch {
      setLocalFontStatus('error');
    }
  }, [registry, semantic]);

  const localFontStatusLabel =
    localFontStatus === 'loading'
      ? 'Checking local fonts…'
      : localFontStatus === 'ready'
        ? `${localFontCount} local ${localFontCount === 1 ? 'family' : 'families'} ready`
        : localFontStatus === 'permission-denied'
          ? 'Local font permission was denied'
          : localFontStatus === 'fallback'
            ? 'Using the compatibility font list'
            : localFontStatus === 'unsupported'
              ? 'Local font access is unavailable; using the compatibility list'
              : localFontStatus === 'error'
                ? 'Local font discovery failed'
                : undefined;

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
            {SOURCE_FILTERS.map((filter, filterIndex) => (
              <button
                key={filter.key}
                type="button"
                role="tab"
                aria-selected={activeFilter === filter.key}
                tabIndex={activeFilter === filter.key ? 0 : -1}
                className={`font-browser__filter-btn${activeFilter === filter.key ? ' font-browser__filter-btn--active' : ''}`}
                onClick={() => setActiveFilter(filter.key)}
                onKeyDown={(event) => {
                  const isPrevious = event.key === 'ArrowLeft';
                  const isNext = event.key === 'ArrowRight';
                  const isFirst = event.key === 'Home';
                  const isLast = event.key === 'End';
                  if (!isPrevious && !isNext && !isFirst && !isLast) return;
                  event.preventDefault();
                  const nextIndex = isFirst
                    ? 0
                    : isLast
                      ? SOURCE_FILTERS.length - 1
                      : (filterIndex + (isPrevious ? -1 : 1) + SOURCE_FILTERS.length) %
                        SOURCE_FILTERS.length;
                  const nextFilter = SOURCE_FILTERS[nextIndex];
                  if (!nextFilter) return;
                  setActiveFilter(nextFilter.key);
                  const tabs =
                    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                      '[role="tab"]',
                    );
                  tabs?.[nextIndex]?.focus();
                }}
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
          <div className="font-browser__local-fonts">
            <button
              type="button"
              className="font-browser__local-fonts-button"
              onClick={() => void refreshLocalFonts()}
              disabled={localFontStatus === 'loading'}
            >
              {localFontApiAvailable ? 'Allow local fonts' : 'Refresh local fonts'}
            </button>
            {localFontStatusLabel && (
              <span className="font-browser__local-fonts-status" role="status" aria-live="polite">
                {localFontStatusLabel}
              </span>
            )}
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              className="font-browser__reset-button"
              onClick={resetFilters}
              aria-label="Reset font browser filters"
            >
              Reset filters
            </button>
          )}
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
          <div ref={setListElement} className="font-browser__list">
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
            {displayEntries.length > 0 && (
              <div
                className="font-browser__virtual-content"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {rowsToRender.map((virtualRow) => {
                  const entry = displayEntries[virtualRow.index];
                  if (!entry) return null;
                  const { record, result, faces } = entry;
                  const isSelected = selectedFamily === record.familyName;
                  const isExpanded = expandedFamilies.has(record.familyId);
                  const hasFaces = faces.length > 1;
                  const labels = descriptors(record);
                  return (
                    <div
                      key={virtualRow.key}
                      ref={virtualizer.measureElement}
                      data-index={virtualRow.index}
                      className={`font-browser__virtual-row font-browser__entry${isSelected ? ' font-browser__entry--selected' : ''}`}
                      style={
                        virtualItems.length > 0
                          ? {
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              transform: `translateY(${virtualRow.start}px)`,
                            }
                          : undefined
                      }
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
                          id={`font-browser-family-${virtualRow.index}`}
                          ref={(element) => {
                            if (element) familyButtonRefs.current.set(virtualRow.index, element);
                            else familyButtonRefs.current.delete(virtualRow.index);
                          }}
                          tabIndex={
                            activeFamilyIndex < 0
                              ? virtualRow.index === 0
                                ? 0
                                : -1
                              : activeFamilyIndex === virtualRow.index
                                ? 0
                                : -1
                          }
                          onClick={() => handleSelect(record)}
                          onFocus={() => setActiveFamilyIndex(virtualRow.index)}
                          onKeyDown={(event) => {
                            const isPrevious = event.key === 'ArrowUp';
                            const isNext = event.key === 'ArrowDown';
                            const isFirst = event.key === 'Home';
                            const isLast = event.key === 'End';
                            if (!isPrevious && !isNext && !isFirst && !isLast) return;
                            event.preventDefault();
                            const nextIndex = isFirst
                              ? 0
                              : isLast
                                ? displayEntries.length - 1
                                : Math.max(
                                    0,
                                    Math.min(
                                      displayEntries.length - 1,
                                      virtualRow.index + (isPrevious ? -1 : 1),
                                    ),
                                  );
                            moveFamilyFocus(nextIndex);
                          }}
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
                              <span className="font-browser__descriptors">
                                {labels.join(' · ')}
                              </span>
                            )}
                          </span>
                        </button>
                        <span className="font-browser__meta">
                          <IconButton
                            icon="Star"
                            label={
                              record.isFavorite
                                ? `Remove ${record.familyName} from favorites`
                                : `Add ${record.familyName} to favorites`
                            }
                            solid={record.isFavorite}
                            pressed={record.isFavorite}
                            size="sm"
                            variant="ghost"
                            className="font-browser__favorite"
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleFavorite(record);
                            }}
                          />
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
                              key={face.key}
                              type="button"
                              className="font-browser__face-row"
                              onClick={() => handleSelectFace(record, face)}
                              aria-pressed={
                                selectedFace?.family === record.familyName &&
                                (selectedFace.namedInstanceName ??
                                  selectedFace.postScriptName ??
                                  `${selectedFace.weight}-${selectedFace.style}`) ===
                                  (face.namedInstanceName ??
                                    face.postScriptName ??
                                    `${face.weight}-${face.style}`)
                              }
                            >
                              <span className="font-browser__face-name">
                                {face.namedInstanceName ??
                                  face.postScriptName ??
                                  `${face.weight} ${face.style}`}
                              </span>
                              <span className="font-browser__face-meta">
                                {face.namedInstanceName
                                  ? `${face.weight} ${face.style} · variable instance`
                                  : `${face.weight} ${face.style}`}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
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
                style={{
                  fontFamily: fontStack(selectedRecord.familyName),
                  ...(axisSettings(axisDraft)
                    ? { fontVariationSettings: axisSettings(axisDraft) }
                    : {}),
                }}
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

              <VariableAxesPanel
                record={selectedRecord}
                values={axisDraft}
                onChange={handleAxisChange}
                onReset={resetAxes}
              />

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
                {(onSelect || onSelectFace) && selectedRecord.installed && (
                  <button
                    type="button"
                    className="font-browser__use-btn"
                    onClick={applySelected}
                    aria-label={
                      selectedFace
                        ? `Use ${selectedFace.family} face`
                        : `Use ${selectedRecord.familyName}`
                    }
                    disabled={!selectedFace && selectedRecord.familyName === selectedFamilyProp}
                  >
                    {selectedFace
                      ? 'Use face'
                      : selectedRecord.familyName === selectedFamilyProp
                        ? 'Current font'
                        : 'Use font'}
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
