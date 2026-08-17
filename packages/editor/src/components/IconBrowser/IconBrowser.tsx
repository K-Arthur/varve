/**
 * IconBrowser — first-class icon library surface.
 *
 * Discovery: search (online + local), filters, curated packs, recents,
 * favourites, downloaded icons. Acquisition is one-action: activating an
 * icon runs cache-check -> fetch -> sanitize -> cache -> insert as a single
 * coordinated operation (see iconAcquisition.ts).
 *
 * Layout is panel-first (embedded in the Resources panel) and also mounts
 * inside the quick-insert dialog via IconBrowserDialog.
 */

import {
  ensureIconProviders,
  type IconPackInfo,
  type IconSourceDescriptor,
  isBrandPack,
} from '@varve/engine';
import {
  collectIconAttribution,
  generateAttributionReportMarkdown,
  generateAttributionReportText,
} from '@varve/scene';
import { Button, Icon, Select } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { IconDetailsPanel } from './IconDetailsPanel';
import { IconDiscoverySections } from './IconDiscoverySections';
import { IconGrid, type IconGridItemView } from './IconGrid';
import { getIconAcquisitionService, IconAcquisitionError } from './iconAcquisition';
import './IconBrowser.css';
import {
  getStoredIcon,
  type IconStorageRecord,
  listStoredIcons,
  migrateLegacyFavourites,
  removeStoredIcon,
  saveFavourites,
} from './iconStorage';
import { IconPackManager } from './PackManager';
import { loadRecents, type RecentIconEntry, recordRecentIcon } from './recents';
import { MIN_QUERY_LENGTH, useIconSearch } from './useIconSearch';

export interface IconInsertPayload {
  id: string;
  name: string;
  svg: string;
  prefix: string;
  providerId?: string;
  styles?: string[];
  licence?: string;
  /** Provenance carried into the document asset. */
  spdxId?: string;
  licenceUrl?: string;
  attributionText?: string;
  author?: string;
  sourceUrl?: string;
  sourceVersion?: string;
  paletteType?: 'monotone' | 'multicolor';
}

export type IconSourceFilter = 'all' | 'online' | 'downloaded' | 'favourites' | 'recent';
export type IconLicenceFilter = 'any' | 'commercial' | 'attribution-required' | 'unknown';
export type IconStyleFilter = 'any' | IconSourceDescriptor['styles'][number];
export type IconPaletteFilter = 'any' | 'monotone' | 'multicolor';
export type IconBrandFilter = 'any' | 'general' | 'brands';

export interface IconBrowserProps {
  onInsert: (payload: IconInsertPayload) => void;
  selectedIconId?: string;
  maxHeight?: number;
  /** Quick-insert mode: hide the details panel on small heights. */
  compact?: boolean;
  onOpenPackManager?: () => void;
}

interface IconBrowserItem extends IconGridItemView {
  descriptor: IconSourceDescriptor;
  svg?: string;
  loading?: boolean;
}

const STYLE_OPTIONS: Array<{ value: IconStyleFilter; label: string }> = [
  { value: 'any', label: 'Any style' },
  { value: 'outline', label: 'Outline' },
  { value: 'filled', label: 'Filled' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'sharp', label: 'Sharp' },
  { value: 'duotone', label: 'Duotone' },
  { value: 'thin', label: 'Thin' },
  { value: 'bold', label: 'Bold' },
];

export function IconBrowser({
  onInsert,
  selectedIconId,
  maxHeight,
  onOpenPackManager,
}: IconBrowserProps) {
  const search = useIconSearch();
  const editorCtx = useEditor();
  const acquisition = useRef(getIconAcquisitionService());

  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<IconSourceFilter>('all');
  const [licenceFilter, setLicenceFilter] = useState<IconLicenceFilter>('any');
  const [styleFilter, setStyleFilter] = useState<IconStyleFilter>('any');
  const [paletteFilter, setPaletteFilter] = useState<IconPaletteFilter>('any');
  const [brandFilter, setBrandFilter] = useState<IconBrandFilter>('any');

  const [localRecords, setLocalRecords] = useState<IconStorageRecord[]>([]);
  const [favourites, setFavourites] = useState<Set<string>>(new Set());
  const [recents, setRecents] = useState<RecentIconEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>(selectedIconId);
  const [acquiringIds, setAcquiringIds] = useState<Set<string>>(new Set());
  const [previews, setPreviews] = useState<Map<string, string>>(new Map());
  const [loadingPreviews, setLoadingPreviews] = useState<Set<string>>(new Set());
  const [packs, setPacks] = useState<IconPackInfo[]>([]);
  const [packsLoading, setPacksLoading] = useState(false);
  const [browsingPack, setBrowsingPack] = useState<string | null>(null);
  const [packPage, setPackPage] = useState<IconSourceDescriptor[]>([]);
  const [packTotal, setPackTotal] = useState(0);
  const [packExhausted, setPackExhausted] = useState(false);
  const [packLoading, setPackLoading] = useState(false);
  const [insertError, setInsertError] = useState<string | null>(null);
  const [packManagerOpen, setPackManagerOpen] = useState(false);
  const [viewDensity, setViewDensity] = useState<'comfortable' | 'compact'>('comfortable');

  const statusRef = useRef<HTMLDivElement | null>(null);

  // Guard the async setState: if the component unmounts before the
  // IndexedDB read resolves (tests call cleanup() immediately, and
  // navigation can unmount mid-read), React 19's dispatchSetState runs
  // after teardown and throws "window is not defined" as an unhandled
  // rejection that fails the whole test run. A module-level flag avoids the
  // stale-closure trap of reading a ref after unmount.
  const disposedRef = useRef(false);
  useEffect(() => {
    return () => {
      disposedRef.current = true;
    };
  }, []);

  const refreshLocal = useCallback(async () => {
    const records = await listStoredIcons();
    if (!disposedRef.current) setLocalRecords(records);
  }, []);

  useEffect(() => {
    migrateLegacyFavourites();
    setFavourites(readFavourites());
    setRecents(loadRecents());
    void refreshLocal();
  }, [refreshLocal]);

  useEffect(() => {
    ensureIconProviders();
    if (!browsingPack) {
      setPacksLoading(true);
      void (async () => {
        try {
          const { getIconProviderRegistry } = await import('@varve/engine');
          const list = await getIconProviderRegistry().getPacks();
          setPacks(list);
        } catch {
          // keep the curated catalogue fallback
        } finally {
          setPacksLoading(false);
        }
      })();
    }
  }, [browsingPack]);

  // -------------------------------------------------------------------------
  // Descriptor helpers
  // -------------------------------------------------------------------------

  const descriptorFromRecord = useCallback(
    (record: IconStorageRecord): IconSourceDescriptor => ({
      canonicalId: record.canonicalId ?? record.id,
      providerId: record.providerId || 'iconify',
      packId: record.prefix,
      iconId: record.id.split(':').pop() ?? record.name,
      name: record.name,
      displayName: record.name,
      aliases: [],
      keywords: [],
      categories: record.categories ?? [],
      styles: (record.styles ?? ['outline']) as IconSourceDescriptor['styles'],
      paletteType: record.paletteType ?? 'monotone',
      licence: {
        spdxId: record.spdxId,
        title: record.licence,
        url: record.licenceUrl,
        attributionText: record.attributionText,
      },
      version: record.sourceVersion,
      isOfflineAvailable: true,
    }),
    [],
  );

  /** Every selectable item: local records + online search results + pack browse. */
  const allItems = useMemo(() => {
    const items: IconBrowserItem[] = [];
    const seen = new Set<string>();
    for (const record of localRecords) {
      if (seen.has(record.canonicalId)) continue;
      seen.add(record.canonicalId);
      const descriptor = descriptorFromRecord(record);
      const svg = previews.get(record.canonicalId) ?? record.svg;
      items.push({
        descriptor,
        svg,
        isFavourite: favourites.has(record.canonicalId),
        isInDocument: false,
        isBrand: isBrandPack(record.prefix),
        licenceWarning: record.spdxId === undefined,
      });
    }
    const online = browsingPack ? packPage : search.results;
    for (const descriptor of online) {
      if (seen.has(descriptor.canonicalId)) continue;
      seen.add(descriptor.canonicalId);
      items.push({
        descriptor,
        svg: previews.get(descriptor.canonicalId),
        loading: loadingPreviews.has(descriptor.canonicalId),
        isFavourite: favourites.has(descriptor.canonicalId),
        isInDocument: false,
        isBrand: isBrandPack(descriptor.packId),
        licenceWarning: Boolean(descriptor.licence.unverified),
      });
    }
    return items;
  }, [
    localRecords,
    search.results,
    browsingPack,
    packPage,
    previews,
    loadingPreviews,
    favourites,
    descriptorFromRecord,
  ]);

  // -------------------------------------------------------------------------
  // Filtering
  // -------------------------------------------------------------------------

  const matchesFilters = useCallback(
    (item: IconBrowserItem): boolean => {
      const d = item.descriptor;
      if (licenceFilter === 'commercial' && d.licence.commercialUse !== true) return false;
      if (licenceFilter === 'attribution-required' && d.licence.attributionRequired !== true)
        return false;
      if (licenceFilter === 'unknown' && !d.licence.unverified) return false;
      if (styleFilter !== 'any' && !d.styles.includes(styleFilter)) return false;
      if (paletteFilter !== 'any' && d.paletteType !== paletteFilter) return false;
      if (brandFilter === 'general' && isBrandPack(d.packId)) return false;
      if (brandFilter === 'brands' && !isBrandPack(d.packId)) return false;
      return true;
    },
    [licenceFilter, styleFilter, paletteFilter, brandFilter],
  );

  const filteredItems = useMemo(() => {
    let items = allItems;
    if (sourceFilter === 'downloaded') items = items.filter((i) => i.descriptor.isOfflineAvailable);
    if (sourceFilter === 'favourites')
      items = items.filter((i) => favourites.has(i.descriptor.canonicalId));
    if (sourceFilter === 'recent') {
      const recentIds = new Set(recents.map((r) => r.canonicalId));
      items = items.filter((i) => recentIds.has(i.descriptor.canonicalId));
    }
    if (sourceFilter === 'online') items = items.filter((i) => !i.descriptor.isOfflineAvailable);
    return items.filter(matchesFilters);
  }, [allItems, sourceFilter, favourites, recents, matchesFilters]);

  // -------------------------------------------------------------------------
  // Preview acquisition (visible range only, batched by pack)
  // -------------------------------------------------------------------------

  const previewSignalRef = useRef<AbortController | null>(null);
  /** Ids whose preview fetch already failed — not retried until the query changes. */
  const failedPreviewIdsRef = useRef<Set<string>>(new Set());
  /** Ids with an in-flight preview batch — same-range callbacks are no-ops. */
  const pendingBatchIdsRef = useRef<Set<string>>(new Set());

  const handleVisibleRange = useCallback(
    (start: number, end: number) => {
      const visible = allItems
        .slice(start, end)
        .filter((i) => !i.svg && !loadingPreviews.has(i.descriptor.canonicalId));
      if (visible.length === 0) return;
      previewSignalRef.current?.abort();
      const controller = new AbortController();
      previewSignalRef.current = controller;
      setLoadingPreviews((prev) => {
        const next = new Set(prev);
        for (const item of visible) next.add(item.descriptor.canonicalId);
        return next;
      });
      void acquisition.current
        .prefetchBatch(
          visible.map((i) => i.descriptor),
          { signal: controller.signal },
        )
        .then((svgMap) => {
          for (const item of visible)
            pendingBatchIdsRef.current.delete(item.descriptor.canonicalId);
          if (controller.signal.aborted) return;
          setPreviews((prev) => {
            const next = new Map(prev);
            for (const [id, svg] of svgMap) next.set(id, svg);
            return next;
          });
          // Icons that resolved with no body won't resolve on retry either.
          for (const item of visible) {
            if (!svgMap.has(item.descriptor.canonicalId)) {
              failedPreviewIdsRef.current.add(item.descriptor.canonicalId);
            }
          }
          setLoadingPreviews((prev) => {
            const next = new Set(prev);
            for (const item of visible) next.delete(item.descriptor.canonicalId);
            return next;
          });
          void refreshLocal();
        })
        .catch(() => {
          for (const item of visible)
            pendingBatchIdsRef.current.delete(item.descriptor.canonicalId);
          for (const item of visible) failedPreviewIdsRef.current.add(item.descriptor.canonicalId);
          setLoadingPreviews((prev) => {
            const next = new Set(prev);
            for (const item of visible) next.delete(item.descriptor.canonicalId);
            return next;
          });
        });
    },
    [allItems, loadingPreviews, refreshLocal],
  );

  useEffect(() => {
    return () => previewSignalRef.current?.abort();
  }, []);

  // -------------------------------------------------------------------------
  // Selection / details
  // -------------------------------------------------------------------------

  const selectedItem = useMemo(
    () => allItems.find((i) => i.descriptor.canonicalId === selectedId) ?? null,
    [allItems, selectedId],
  );

  const ensureSelectedPreview = useCallback(
    async (item: IconBrowserItem) => {
      if (item.svg) return;
      try {
        const result = await acquisition.current.acquire(item.descriptor, {
          signal: previewSignalRef.current?.signal,
        });
        setPreviews((prev) => new Map(prev).set(item.descriptor.canonicalId, result.svg));
        void refreshLocal();
      } catch {
        // preview failure is non-fatal
      }
    },
    [refreshLocal],
  );

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      const item = allItems.find((i) => i.descriptor.canonicalId === id);
      if (item) void ensureSelectedPreview(item);
    },
    [allItems, ensureSelectedPreview],
  );

  // -------------------------------------------------------------------------
  // Search / pack browsing
  // -------------------------------------------------------------------------

  const handleSearchChange = useCallback(
    (value: string) => {
      setQuery(value);
      setBrowsingPack(null);
      failedPreviewIdsRef.current.clear();
      pendingBatchIdsRef.current.clear();
      search.search(value);
    },
    [search],
  );

  const handleOpenPack = useCallback(async (prefix: string) => {
    setBrowsingPack(prefix);
    setPackPage([]);
    setPackTotal(0);
    setPackExhausted(false);
    setPackLoading(true);
    try {
      const { getIconProviderRegistry } = await import('@varve/engine');
      const provider = getIconProviderRegistry().get('iconify');
      if (!provider?.getPackIcons) return;
      const page = await provider.getPackIcons(prefix, { limit: 96, start: 0 });
      setPackPage(page.items);
      setPackTotal(page.total);
      setPackExhausted(page.exhausted);
    } finally {
      setPackLoading(false);
    }
  }, []);

  const handleLoadMorePack = useCallback(async () => {
    if (!browsingPack || packLoading || packExhausted) return;
    setPackLoading(true);
    try {
      const { getIconProviderRegistry } = await import('@varve/engine');
      const provider = getIconProviderRegistry().get('iconify');
      if (!provider?.getPackIcons) return;
      const page = await provider.getPackIcons(browsingPack, { limit: 96, start: packPage.length });
      setPackPage((prev) => [...prev, ...page.items]);
      setPackTotal(page.total);
      setPackExhausted(page.exhausted);
    } finally {
      setPackLoading(false);
    }
  }, [browsingPack, packLoading, packExhausted, packPage.length]);

  const handleClosePack = useCallback(() => {
    setBrowsingPack(null);
    setPackPage([]);
    setPackTotal(0);
  }, []);

  // -------------------------------------------------------------------------
  // Insertion — the one-action command path
  // -------------------------------------------------------------------------

  const handleInsert = useCallback(
    async (id: string) => {
      const item =
        filteredItems.find((i) => i.descriptor.canonicalId === id) ??
        allItems.find((i) => i.descriptor.canonicalId === id);
      if (!item) return;
      const descriptor = item.descriptor;
      setInsertError(null);

      // Cached (or already-fetched) icon inserts without any network work.
      let svg = item.svg;
      if (!svg) {
        setAcquiringIds((prev) => new Set(prev).add(descriptor.canonicalId));
        try {
          const result = await acquisition.current.acquire(descriptor, {
            signal: previewSignalRef.current?.signal,
          });
          svg = result.svg;
          setPreviews((prev) => new Map(prev).set(descriptor.canonicalId, result.svg));
        } catch (err) {
          const message =
            err instanceof IconAcquisitionError
              ? acquisitionErrorMessage(err)
              : 'Could not load this icon — check the connection and try again.';
          setInsertError(message);
          setSelectedId(descriptor.canonicalId);
          return;
        } finally {
          setAcquiringIds((prev) => {
            const next = new Set(prev);
            next.delete(descriptor.canonicalId);
            return next;
          });
        }
      }
      if (!svg) return;

      recordRecentIcon({
        canonicalId: descriptor.canonicalId,
        name: descriptor.name,
        packId: descriptor.packId,
      });
      setRecents(loadRecents());
      void refreshLocal();

      onInsert({
        id: descriptor.canonicalId,
        name: descriptor.name,
        svg,
        prefix: descriptor.packId,
        providerId: descriptor.providerId,
        styles: descriptor.styles,
        licence: descriptor.licence.title,
        spdxId: descriptor.licence.spdxId,
        licenceUrl: descriptor.licence.url,
        attributionText: descriptor.licence.attributionRequired
          ? descriptor.licence.attributionText
          : undefined,
        author: descriptor.author,
        sourceUrl: descriptor.sourceUrl,
        sourceVersion: descriptor.version,
        paletteType: descriptor.paletteType,
      });
    },
    [filteredItems, allItems, onInsert, refreshLocal],
  );

  const handleToggleFavourite = useCallback((id: string) => {
    setFavourites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveFavourites(next);
      return next;
    });
  }, []);

  const handleToggleCache = useCallback(
    async (id: string) => {
      const item = allItems.find((i) => i.descriptor.canonicalId === id);
      if (!item) return;
      const cached = await getStoredIcon(id);
      if (cached) {
        await removeStoredIcon(id);
        setPreviews((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
      } else {
        setAcquiringIds((prev) => new Set(prev).add(id));
        try {
          await acquisition.current.acquire(item.descriptor);
        } finally {
          setAcquiringIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }
      }
      void refreshLocal();
    },
    [allItems, refreshLocal],
  );

  const handleCopySvg = useCallback(
    async (id: string) => {
      const item = allItems.find((i) => i.descriptor.canonicalId === id);
      if (!item?.svg) return;
      try {
        await navigator.clipboard.writeText(item.svg);
        announce('SVG copied to clipboard');
      } catch {
        announce('Could not copy SVG');
      }
    },
    [allItems],
  );

  const announce = useCallback((message: string) => {
    if (statusRef.current) {
      statusRef.current.textContent = message;
    }
  }, []);

  // -------------------------------------------------------------------------
  // Recents → descriptors for the discovery surface
  // -------------------------------------------------------------------------

  const recentSvg = useMemo(() => {
    const map = new Map<string, string>();
    for (const record of localRecords) {
      if (recents.some((r) => r.canonicalId === record.canonicalId)) {
        map.set(record.canonicalId, record.svg);
      }
    }
    return map;
  }, [localRecords, recents]);

  const handleCopyAttributionReport = useCallback(() => {
    try {
      const doc = editorCtx?.state.document;
      if (!doc) return;
      const entries = collectIconAttribution(doc);
      if (entries.length === 0) {
        setInsertError('This document contains no icons with attribution requirements.');
        return;
      }
      const text = generateAttributionReportText(entries);
      const markdown = generateAttributionReportMarkdown(entries);
      void navigator.clipboard.writeText(markdown).then(
        () => announce('Attribution report copied to clipboard'),
        () => announce('Could not copy the attribution report'),
      );
      void text;
    } catch {
      announce('Could not generate the attribution report');
    }
  }, [editorCtx, announce]);

  const handleSelectRecent = useCallback(
    (canonicalId: string) => {
      setSourceFilter('recent');
      const item = allItems.find((i) => i.descriptor.canonicalId === canonicalId);
      if (item) handleSelect(canonicalId);
    },
    [allItems, handleSelect],
  );

  // -------------------------------------------------------------------------
  // Status / error surfaces
  // -------------------------------------------------------------------------

  const statusMessage = useMemo(() => {
    if (insertError) return insertError;
    if (packLoading && browsingPack) return `Loading pack…`;
    if (search.isLoading) return 'Searching icons…';
    if (search.isLoadingMore) return 'Loading more…';
    if (search.error && query) {
      return searchErrorMessage(search.error.code, search.isOnline);
    }
    if (!search.isOnline && filteredItems.length === 0 && !query) {
      return 'You are offline. Downloaded icons remain available.';
    }
    if (filteredItems.length === 0 && query && query.trim().length >= MIN_QUERY_LENGTH) {
      return `No icons match "${query.trim()}".`;
    }
    return `${filteredItems.length.toLocaleString()} icon${filteredItems.length === 1 ? '' : 's'}`;
  }, [
    insertError,
    packLoading,
    browsingPack,
    search.isLoading,
    search.isLoadingMore,
    search.error,
    search.isOnline,
    query,
    filteredItems.length,
  ]);

  const selectedDescriptor = selectedItem?.descriptor ?? null;
  const selectedSvg = selectedItem?.svg;

  return (
    <div className="icon-browser" style={maxHeight ? { maxHeight } : undefined}>
      <div className="icon-browser__header">
        <div className="icon-browser__search">
          <Icon name="Search" className="icon-browser__search-icon" />
          <input
            type="search"
            value={query}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={
              browsingPack ? `Search icons…` : 'Search icons (e.g. "arrow left", "settings")…'
            }
            className="icon-browser__search-input"
            aria-label="Search icons"
          />
          {query && (
            <button
              type="button"
              className="icon-browser__clear-btn"
              onClick={() => handleSearchChange('')}
              aria-label="Clear search"
            >
              <Icon name="X" />
            </button>
          )}
        </div>
        <div className="icon-browser__header-actions">
          <span
            className={`icon-browser__conn ${search.isOnline ? 'icon-browser__conn--online' : 'icon-browser__conn--offline'}`}
            title={search.isOnline ? 'Online' : 'Offline'}
            role="img"
          />
          <button
            type="button"
            className="icon-browser__header-btn"
            onClick={() => {
              if (onOpenPackManager) onOpenPackManager();
              else setPackManagerOpen(true);
            }}
            aria-label="Manage icon packs"
          >
            <Icon name="Package" size={16} />
          </button>
          <button
            type="button"
            className="icon-browser__header-btn"
            onClick={() => setViewDensity((v) => (v === 'comfortable' ? 'compact' : 'comfortable'))}
            aria-label={viewDensity === 'comfortable' ? 'Compact grid' : 'Comfortable grid'}
            aria-pressed={viewDensity === 'compact'}
          >
            <Icon name={viewDensity === 'comfortable' ? 'LayoutGrid' : 'Rows3'} size={16} />
          </button>
        </div>
      </div>

      {browsingPack && (
        <div className="icon-browser__pack-bar">
          <Button variant="ghost" size="sm" onClick={handleClosePack}>
            <Icon name="ArrowLeft" size={14} /> All packs
          </Button>
          <span className="icon-browser__pack-name">
            {packs.find((p) => p.prefix === browsingPack)?.name ?? browsingPack}
          </span>
          {packTotal > 0 && (
            <span className="icon-browser__pack-total">{packTotal.toLocaleString()} icons</span>
          )}
        </div>
      )}

      <fieldset className="icon-browser__filters">
        <legend className="icon-browser__filters-legend">Icon sources</legend>
        {(['all', 'online', 'downloaded', 'favourites', 'recent'] as const).map((filter) => (
          <button
            type="button"
            key={filter}
            className={`icon-browser__filter ${sourceFilter === filter ? 'icon-browser__filter--active' : ''}`}
            onClick={() => setSourceFilter(filter)}
            aria-pressed={sourceFilter === filter}
          >
            {filter === 'all'
              ? 'All'
              : filter === 'downloaded'
                ? 'Downloaded'
                : filter.charAt(0).toUpperCase() + filter.slice(1)}
          </button>
        ))}
      </fieldset>

      <div className="icon-browser__filter-row">
        <div className="icon-browser__filter-select">
          <Select
            label="Filter by licence"
            options={[
              { value: 'any', label: 'Licence: any' },
              { value: 'commercial', label: 'Commercial use OK' },
              { value: 'attribution-required', label: 'Attribution required' },
              { value: 'unknown', label: 'Unknown licence' },
            ]}
            value={licenceFilter}
            onChange={(v) => setLicenceFilter(v as IconLicenceFilter)}
          />
        </div>
        <div className="icon-browser__filter-select">
          <Select
            label="Filter by style"
            options={STYLE_OPTIONS.map((o) => ({ value: o.value, label: `Style: ${o.label}` }))}
            value={styleFilter}
            onChange={(v) => setStyleFilter(v as IconStyleFilter)}
          />
        </div>
        <div className="icon-browser__filter-select">
          <Select
            label="Filter by palette"
            options={[
              { value: 'any', label: 'Colour: any' },
              { value: 'monotone', label: 'Monotone' },
              { value: 'multicolor', label: 'Multicolour' },
            ]}
            value={paletteFilter}
            onChange={(v) => setPaletteFilter(v as IconPaletteFilter)}
          />
        </div>
        <div className="icon-browser__filter-select">
          <Select
            label="Filter by icon type"
            options={[
              { value: 'any', label: 'Type: all icons' },
              { value: 'general', label: 'General UI' },
              { value: 'brands', label: 'Brands (trademarked)' },
            ]}
            value={brandFilter}
            onChange={(v) => setBrandFilter(v as IconBrandFilter)}
          />
        </div>
      </div>

      <div
        className="icon-browser__status"
        role="status"
        aria-live="polite"
        ref={statusRef}
        data-error={Boolean(search.error || insertError) || undefined}
      >
        {statusMessage}
      </div>

      {query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH ? (
        <div className="icon-browser__empty">
          <Icon name="Type" size={32} />
          <p>Type at least {MIN_QUERY_LENGTH} characters to search icons.</p>
        </div>
      ) : search.error && query.trim().length >= MIN_QUERY_LENGTH ? (
        <div className="icon-browser__error-state" role="alert">
          <Icon name="WifiOff" size={32} />
          <p className="icon-browser__error-title">
            {searchErrorMessage(search.error.code, search.isOnline)}
          </p>
          {!search.isOnline && (
            <p className="icon-browser__error-hint">
              Your downloaded icons are still available — switch to the Downloaded filter.
            </p>
          )}
          <Button variant="secondary" size="sm" onClick={() => handleSearchChange(query)}>
            <Icon name="RefreshCw" size={14} /> Retry
          </Button>
        </div>
      ) : browsingPack ? (
        <>
          <IconGrid
            items={filteredItems}
            selectedId={selectedId}
            acquiringIds={acquiringIds}
            onSelect={handleSelect}
            onInsert={(id) => void handleInsert(id)}
            onToggleFavourite={handleToggleFavourite}
            onVisibleRangeChange={handleVisibleRange}
            ariaLabel={`Icons in pack ${browsingPack}`}
            emptyState={
              <div className="icon-browser__empty">
                <Icon name="PackageX" size={32} />
                <p>No icons in this pack match your filters.</p>
              </div>
            }
          />
          <div className="icon-browser__load-more">
            {packLoading ? (
              <span className="icon-browser__load-more-status">Loading…</span>
            ) : !packExhausted ? (
              <Button variant="secondary" size="sm" onClick={() => void handleLoadMorePack()}>
                Load more ({Math.max(0, packTotal - packPage.length).toLocaleString()} remaining)
              </Button>
            ) : (
              <span className="icon-browser__load-more-status">
                {packTotal.toLocaleString()} icons loaded
              </span>
            )}
          </div>
        </>
      ) : !query && sourceFilter === 'all' ? (
        <div className="icon-browser__discovery-scroll">
          <IconDiscoverySections
            recents={recents}
            favouriteCount={favourites.size}
            downloadedCount={localRecords.length}
            packs={packs}
            packsLoading={packsLoading}
            recentSvg={recentSvg}
            onOpenPack={(prefix) => void handleOpenPack(prefix)}
            onSelectRecent={handleSelectRecent}
            onSelectFavourites={() => setSourceFilter('favourites')}
            onSelectDownloaded={() => setSourceFilter('downloaded')}
            onOpenPackManager={() => {
              if (onOpenPackManager) onOpenPackManager();
              else setPackManagerOpen(true);
            }}
            onCopyAttributionReport={handleCopyAttributionReport}
            hasAttribution={Boolean(
              editorCtx?.state?.document?.iconAssets &&
                Object.keys(editorCtx.state.document.iconAssets).length > 0,
            )}
          />
        </div>
      ) : (
        <>
          <IconGrid
            items={filteredItems}
            selectedId={selectedId}
            acquiringIds={acquiringIds}
            onSelect={handleSelect}
            onInsert={(id) => void handleInsert(id)}
            onToggleFavourite={handleToggleFavourite}
            onVisibleRangeChange={handleVisibleRange}
            cardSize={viewDensity === 'compact' ? 56 : 68}
            ariaLabel="Icon results"
            emptyState={
              <div className="icon-browser__empty">
                <Icon name="SearchX" size={32} />
                <p>{query ? 'No icons match your search.' : 'No icons here yet.'}</p>
              </div>
            }
          />
          {query && !search.exhausted && (
            <div className="icon-browser__load-more">
              {search.isLoadingMore ? (
                <span className="icon-browser__load-more-status">Loading…</span>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => void search.loadMore()}>
                  Load more ({Math.max(0, search.total - search.results.length).toLocaleString()}{' '}
                  remaining)
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {!query &&
        sourceFilter === 'all' &&
        !browsingPack &&
        filteredItems.length === 0 &&
        packs.length === 0 && (
          <div className="icon-browser__footer-hint">
            Icon search requires an internet connection on first use; downloaded icons work offline.
          </div>
        )}

      {selectedDescriptor && (
        <IconDetailsPanel
          descriptor={selectedDescriptor}
          svg={selectedSvg}
          isFavourite={favourites.has(selectedDescriptor.canonicalId)}
          isInDocument={false}
          isCached={Boolean(selectedItem?.descriptor.isOfflineAvailable)}
          isBrand={isBrandPack(selectedDescriptor.packId)}
          isAcquiring={acquiringIds.has(selectedDescriptor.canonicalId)}
          onInsert={() => void handleInsert(selectedDescriptor.canonicalId)}
          onToggleFavourite={() => handleToggleFavourite(selectedDescriptor.canonicalId)}
          onToggleCache={() => void handleToggleCache(selectedDescriptor.canonicalId)}
          onCopySvg={() => void handleCopySvg(selectedDescriptor.canonicalId)}
        />
      )}

      {packManagerOpen && !onOpenPackManager && (
        <IconPackManager
          packs={packs}
          packsLoading={packsLoading}
          onClose={() => setPackManagerOpen(false)}
          onBrowsePack={(prefix) => {
            setPackManagerOpen(false);
            void handleOpenPack(prefix);
          }}
          onStorageChanged={() => void refreshLocal()}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

function searchErrorMessage(code: string, isOnline: boolean): string {
  switch (code) {
    case 'registry-empty':
      return 'Icon sources are not configured.';
    case 'csp-blocked':
      return 'The app security policy is blocking icon requests.';
    case 'timeout':
      return 'The icon service took too long to respond.';
    case 'invalid-response':
      return 'The icon service returned an unexpected response.';
    case 'network-error':
    case 'http-error':
      return isOnline ? 'Could not reach the icon service.' : 'You are offline.';
    default:
      return 'Could not search icons.';
  }
}

function acquisitionErrorMessage(err: IconAcquisitionError): string {
  switch (err.code) {
    case 'icon-not-found':
      return 'This icon no longer exists in its source pack.';
    case 'sanitizer-rejected':
      return 'This icon was rejected by the security sanitizer.';
    case 'storage-quota':
      return 'The icon cache is full — remove cached icons and try again.';
    case 'storage-unavailable':
      return 'Icon storage is unavailable in this environment.';
    case 'icon-too-large':
      return 'This icon is too large to import safely.';
    case 'csp-blocked':
      return 'The app security policy blocked this icon.';
    case 'timeout':
      return 'The icon service took too long to respond.';
    default:
      return 'Could not load this icon — check the connection and try again.';
  }
}

function readFavourites(): Set<string> {
  try {
    const raw = localStorage.getItem('varve-icon-favourites');
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return new Set(
      Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [],
    );
  } catch {
    return new Set();
  }
}
