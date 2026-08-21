/**
 * Brush Browser — search, categorise and pick brushes.
 *
 * Thumbnails are rendered lazily as tiles scroll into view and cached by
 * fingerprint, so opening the panel with several hundred brushes installed
 * costs a handful of renders rather than one per brush. Tiles are real buttons
 * in a listbox, so a brush can be found and chosen entirely from the keyboard
 * and announced by name — a thumbnail grid alone would make brush choice
 * unavailable to anyone not looking at it.
 */
import type { BrushPreset } from '@varve/scene';
import { BUILT_IN_BRUSH_PRESETS } from '@varve/scene';
import { type BrushCategory, searchBrushes } from '@varve/shared';
import { EmptyState, IconButton, Input } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrushPreviewCache, brushPreviewDataUrl } from '../../brush/brushPreview';
import './BrushBrowser.css';

const PREVIEW_SIZE = { width: 112, height: 56 };

export interface BrushBrowserItem {
  id: string;
  name: string;
  category: BrushCategory | string;
  tags?: string[];
  preset: BrushPreset;
  isBuiltIn: boolean;
}

export interface BrushBrowserProps {
  /** User-created and imported brushes. */
  customItems?: BrushBrowserItem[];
  selectedId: string;
  favoriteIds: ReadonlySet<string>;
  recentIds: readonly string[];
  onSelect: (item: BrushBrowserItem) => void;
  onToggleFavorite: (id: string) => void;
  onEdit?: (item: BrushBrowserItem) => void;
  onDelete?: (id: string) => void;
  onImport?: () => void;
  onExport?: (item: BrushBrowserItem) => void;
}

type Filter = 'all' | 'favorites' | 'recent' | BrushCategory | string;

function builtInItems(): BrushBrowserItem[] {
  return Object.values(BUILT_IN_BRUSH_PRESETS).map((preset) => ({
    id: preset.id,
    name: preset.name,
    category: categoryFor(preset),
    tags: [],
    preset,
    isBuiltIn: true,
  }));
}

/** Best-effort category for a built-in, from what the preset actually does. */
function categoryFor(preset: BrushPreset): BrushCategory {
  if (preset.eraser) return 'basic';
  if (preset.grainId) return 'texture';
  if (preset.smudgeStrength > 0 && preset.opacity < 0.6) return 'smudge';
  if (preset.hardness >= 0.85) return 'ink';
  if (preset.hardness <= 0.35) return 'paint';
  return 'basic';
}

export function BrushBrowser({
  customItems = [],
  selectedId,
  favoriteIds,
  recentIds,
  onSelect,
  onToggleFavorite,
  onEdit,
  onDelete,
  onImport,
  onExport,
}: BrushBrowserProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const cacheRef = useRef(new BrushPreviewCache());

  const allItems = useMemo(() => [...builtInItems(), ...customItems], [customItems]);

  const categories = useMemo(() => {
    const present = new Set<string>();
    for (const item of allItems) present.add(item.category);
    return [...present].sort();
  }, [allItems]);

  const visible = useMemo(() => {
    let items = allItems;
    if (filter === 'favorites') items = items.filter((i) => favoriteIds.has(i.id));
    else if (filter === 'recent') {
      const order = new Map(recentIds.map((id, index) => [id, index]));
      items = items
        .filter((i) => order.has(i.id))
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    } else if (filter !== 'all') items = items.filter((i) => i.category === filter);
    // Search runs on the already-filtered list, and only re-filters — no
    // preview is regenerated per keystroke.
    return searchBrushes(items, query);
  }, [allItems, filter, favoriteIds, recentIds, query]);

  return (
    <div className="brush-browser">
      <div className="brush-browser__search">
        <Input
          type="search"
          value={query}
          placeholder="Search brushes"
          aria-label="Search brushes"
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        {onImport ? <IconButton icon="Upload" label="Import brushes" onClick={onImport} /> : null}
      </div>

      <div className="brush-browser__filters" role="tablist" aria-label="Brush categories">
        <FilterChip current={filter} value="all" label="All" onSelect={setFilter} />
        <FilterChip current={filter} value="favorites" label="Favorites" onSelect={setFilter} />
        <FilterChip current={filter} value="recent" label="Recent" onSelect={setFilter} />
        {categories.map((category) => (
          <FilterChip
            key={category}
            current={filter}
            value={category}
            label={category[0]!.toUpperCase() + category.slice(1)}
            onSelect={setFilter}
          />
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          illustration={<EmptyBrushIllustration />}
          headline="No brushes match"
          description={query ? `Nothing matches “${query}”.` : 'This category is empty.'}
        />
      ) : (
        <ul className="brush-browser__grid" aria-label="Brushes">
          {visible.map((item) => (
            <BrushTile
              key={item.id}
              item={item}
              selected={item.id === selectedId}
              favorite={favoriteIds.has(item.id)}
              cache={cacheRef.current}
              onSelect={onSelect}
              onToggleFavorite={onToggleFavorite}
              onEdit={onEdit}
              onDelete={onDelete}
              onExport={onExport}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Outline of a brush stroke. SVG, per the zero-emoji icon contract. */
function EmptyBrushIllustration() {
  return (
    <svg viewBox="0 0 48 32" width="48" height="32" fill="none" aria-hidden="true">
      <path
        d="M4 24c6-12 14-16 20-12s4 12 10 12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.45"
      />
    </svg>
  );
}

function FilterChip({
  current,
  value,
  label,
  onSelect,
}: {
  current: Filter;
  value: Filter;
  label: string;
  onSelect: (v: Filter) => void;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`brush-browser__chip${active ? ' is-active' : ''}`}
      onClick={() => onSelect(value)}
    >
      {label}
    </button>
  );
}

interface BrushTileProps {
  item: BrushBrowserItem;
  selected: boolean;
  favorite: boolean;
  cache: BrushPreviewCache;
  onSelect: (item: BrushBrowserItem) => void;
  onToggleFavorite: (id: string) => void;
  onEdit?: (item: BrushBrowserItem) => void;
  onDelete?: (id: string) => void;
  onExport?: (item: BrushBrowserItem) => void;
}

function BrushTile({
  item,
  selected,
  favorite,
  cache,
  onSelect,
  onToggleFavorite,
  onEdit,
  onDelete,
  onExport,
}: BrushTileProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const ref = useRef<HTMLLIElement>(null);

  // Render the thumbnail only once the tile is actually near the viewport, so
  // opening the panel does not synchronously rasterise every installed brush.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let cancelled = false;
    const render = () => {
      if (cancelled) return;
      setPreview(brushPreviewDataUrl(item.preset, PREVIEW_SIZE, cache));
    };
    if (typeof IntersectionObserver === 'undefined') {
      render();
      return () => {
        cancelled = true;
      };
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          render();
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);

    // Deadlock guard. A zero-area element is reported as *not* intersecting,
    // so a tile observed before its styles apply would never render a preview,
    // and without a preview the placeholder never gains height — the tile stays
    // zero-area and the observer never fires again. Rendering anyway after a
    // beat costs one thumbnail in the worst case and cannot get stuck.
    const fallback = setTimeout(() => {
      render();
      observer.disconnect();
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(fallback);
      observer.disconnect();
    };
  }, [item.preset, cache]);

  const handleKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
        onToggleFavorite(item.id);
        e.preventDefault();
      }
    },
    [item.id, onToggleFavorite],
  );

  return (
    <li
      ref={ref}
      id={`brush-tile-${item.id}`}
      className={`brush-browser__tile${selected ? ' is-selected' : ''}`}
    >
      {/* A listbox whose options contain buttons is invalid ARIA — options
          must not hold focusable children — and each tile needs favourite,
          edit, export and delete alongside selection. A list of toggle
          buttons keeps every action reachable and announces which brush is
          active via aria-pressed. */}
      <button
        type="button"
        className="brush-browser__tile-main"
        aria-pressed={selected}
        onClick={() => onSelect(item)}
        onKeyDown={handleKey}
      >
        <span className="brush-browser__preview">
          {preview ? (
            <img src={preview} alt="" width={PREVIEW_SIZE.width} height={PREVIEW_SIZE.height} />
          ) : (
            <span className="brush-browser__preview-placeholder" aria-hidden="true" />
          )}
        </span>
        <span className="brush-browser__name">{item.name}</span>
      </button>
      <div className="brush-browser__tile-actions">
        <IconButton
          icon="Star"
          solid={favorite}
          pressed={favorite}
          label={favorite ? `Unfavorite ${item.name}` : `Favorite ${item.name}`}
          onClick={() => onToggleFavorite(item.id)}
        />
        {onEdit ? (
          <IconButton
            icon="Pencil"
            label={item.isBuiltIn ? `Edit a copy of ${item.name}` : `Edit ${item.name}`}
            onClick={() => onEdit(item)}
          />
        ) : null}
        {onExport ? (
          <IconButton
            icon="Download"
            label={`Export ${item.name}`}
            onClick={() => onExport(item)}
          />
        ) : null}
        {onDelete && !item.isBuiltIn ? (
          <IconButton
            icon="Trash2"
            label={`Delete ${item.name}`}
            onClick={() => onDelete(item.id)}
          />
        ) : null}
      </div>
    </li>
  );
}
