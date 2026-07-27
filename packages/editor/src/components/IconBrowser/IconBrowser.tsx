/**
 * IconBrowser — searchable icon browser with online/local/favourites filters.
 */

import type { IconProviderResult } from '@strata/engine';
import { Icon, SolidIcon } from '@strata/ui';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getIconDownloadManager } from './iconDownloadManager';
import { type IconStorageRecord, listStoredIcons, removeStoredIcon } from './iconStorage';
import { useIconSearch } from './useIconSearch';
import './IconBrowser.css';

export interface IconInsertPayload {
  id: string;
  name: string;
  svg: string;
  prefix: string;
  styles?: string[];
  licence?: string;
}

interface IconGridItem {
  id: string;
  name: string;
  source: 'online' | 'local';
  prefix: string;
  styles: string[];
  category?: string;
  licence?: string;
  svg?: string;
}

interface IconBrowserProps {
  onInsert: (payload: IconInsertPayload) => void;
  selectedIconId?: string;
  maxHeight?: number;
}

const FAVOURITES_KEY = 'strata-icon-favourites';

function loadFavourites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVOURITES_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function saveFavourites(favs: Set<string>): void {
  try {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify([...favs]));
  } catch {
    // ignore
  }
}

function stripOuterSvg(svg: string): string {
  return svg
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>/, '')
    .trim();
}

export function IconBrowser({ onInsert, selectedIconId, maxHeight = 600 }: IconBrowserProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'online' | 'local' | 'favourites'>(
    'all',
  );
  const [localIcons, setLocalIcons] = useState<IconStorageRecord[]>([]);
  const [favourites, setFavourites] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | undefined>(selectedIconId);
  const [previewIcon, setPreviewIcon] = useState<IconGridItem | null>(null);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [viewBox, setViewBox] = useState('0 0 24 24');

  const gridRef = useRef<HTMLDivElement>(null);
  const { results, isLoading, search, clear } = useIconSearch();

  useEffect(() => {
    listStoredIcons().then(setLocalIcons);
    setFavourites(loadFavourites());
  }, []);

  const gridItems = useMemo(() => {
    const items: IconGridItem[] = [];
    const seen = new Set<string>();

    for (const local of localIcons) {
      if (seen.has(local.id)) continue;
      seen.add(local.id);
      items.push({
        id: local.id,
        name: local.name,
        source: 'local',
        prefix: local.prefix,
        styles: local.styles ?? [],
        category: local.category,
        licence: local.licence,
        svg: local.svg,
      });
    }

    for (const result of results) {
      if (seen.has(result.id)) continue;
      seen.add(result.id);
      items.push({
        id: result.id,
        name: result.name,
        source: 'online',
        prefix: result.prefix,
        styles: result.styles ?? [],
        category: result.category,
        licence: result.license?.name,
      });
    }

    return items;
  }, [localIcons, results]);

  const filteredItems = useMemo(() => {
    if (activeFilter === 'all') return gridItems;
    if (activeFilter === 'local') return gridItems.filter((i) => i.source === 'local');
    if (activeFilter === 'favourites') return gridItems.filter((i) => favourites.has(i.id));
    return gridItems;
  }, [gridItems, activeFilter, favourites]);

  const handleSearch = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setSearchQuery(value);
      search(value);
    },
    [search],
  );

  const handleClear = useCallback(() => {
    setSearchQuery('');
    clear();
  }, [clear]);

  const handleInsert = useCallback(
    (item: IconGridItem) => {
      if (!item.svg) return;
      onInsert({
        id: item.id,
        name: item.name,
        svg: item.svg,
        prefix: item.prefix,
        styles: item.styles,
        licence: item.licence,
      });
    },
    [onInsert],
  );

  const handleToggleFavourite = useCallback((id: string) => {
    setFavourites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      saveFavourites(next);
      return next;
    });
  }, []);

  const handleRemove = useCallback(async (item: IconGridItem) => {
    if (item.source === 'local') {
      await removeStoredIcon(item.id);
      setLocalIcons((prev) => prev.filter((i) => i.id !== item.id));
    }
    setPreviewIcon(null);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!gridRef.current) return;
      const cards = Array.from(
        gridRef.current.querySelectorAll<HTMLDivElement>('.icon-browser__card'),
      );
      const currentIdx = cards.indexOf(document.activeElement);
      let nextIdx = currentIdx;

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          nextIdx = Math.min(currentIdx + 1, cards.length - 1);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          nextIdx = Math.max(currentIdx - 1, 0);
          break;
        case 'ArrowDown':
          e.preventDefault();
          nextIdx = Math.min(currentIdx + 4, cards.length - 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          nextIdx = Math.max(currentIdx - 4, 0);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (currentIdx >= 0) {
            const id = cards[currentIdx]?.dataset.iconId;
            const item = filteredItems.find((i) => i.id === id);
            if (item) handleInsert(item);
          }
          return;
        default:
          return;
      }

      cards[nextIdx]?.focus();
    },
    [filteredItems, handleInsert],
  );

  const handleDownload = useCallback(async (item: IconGridItem) => {
    if (item.svg) return;
    setDownloadingIds((prev) => new Set(prev).add(item.id));
    const manager = getIconDownloadManager();
    await manager.downloadIcon(
      {
        id: item.id,
        name: item.name,
        prefix: item.prefix,
        styles: item.styles,
        category: item.category ?? '',
        license: {
          name: item.licence ?? 'unknown',
          spdxId: 'unknown',
          url: '',
          commercialUse: false,
          modification: false,
          redistribution: false,
          attributionRequired: false,
          attributionText: '',
        },
      } as IconProviderResult,
      async () => null,
    );
    setDownloadingIds((prev) => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });
    listStoredIcons().then(setLocalIcons);
  }, []);

  return (
    <div className="icon-browser" style={{ maxHeight }}>
      <div className="icon-browser__search">
        <Icon name="search" className="icon-browser__search-icon" />
        <input
          type="text"
          value={searchQuery}
          onChange={handleSearch}
          placeholder="Search icons..."
          className="icon-browser__search-input"
          aria-label="Search icons"
        />
        {searchQuery && (
          <button
            type="button"
            className="icon-browser__clear-btn"
            onClick={handleClear}
            aria-label="Clear search"
          >
            <Icon name="x" />
          </button>
        )}
      </div>

      <div className="icon-browser__filters" role="tablist">
        {(['all', 'online', 'local', 'favourites'] as const).map((filter) => (
          <button
            type="button"
            key={filter}
            role="tab"
            aria-selected={activeFilter === filter}
            className={`icon-browser__filter ${activeFilter === filter ? 'icon-browser__filter--active' : ''}`}
            onClick={() => setActiveFilter(filter)}
          >
            {filter.charAt(0).toUpperCase() + filter.slice(1)}
          </button>
        ))}
      </div>

      <div className="icon-browser__status">
        {isLoading ? 'Searching...' : `${filteredItems.length} icons`}
      </div>

      <div className="icon-browser__grid" ref={gridRef} onKeyDown={handleKeyDown} role="listbox">
        {filteredItems.length === 0 && (
          <div className="icon-browser__empty">
            <Icon name="search-x" size={32} />
            <p>No icons found</p>
          </div>
        )}
        {filteredItems.map((item) => (
          <button
            type="button"
            key={item.id}
            className={`icon-browser__card ${selectedId === item.id ? 'icon-browser__card--selected' : ''}`}
            data-icon-id={item.id}
            aria-label={`${item.name} icon`}
            onClick={() => {
              setSelectedId(item.id);
              setPreviewIcon(item);
              if (item.svg) {
                const vb = item.svg.match(/viewBox="([^"]+)"/)?.[1];
                if (vb) setViewBox(vb);
              }
            }}
            onDoubleClick={() => item.svg && handleInsert(item)}
          >
            {item.svg ? (
              <div
                className="icon-browser__card-preview"
                dangerouslySetInnerHTML={{ __html: stripOuterSvg(item.svg) }}
              />
            ) : (
              <div className="icon-browser__card-preview icon-browser__card-preview--placeholder">
                {downloadingIds.has(item.id) ? (
                  <Icon name="loader" size={20} className="icon-browser__card-spinner" />
                ) : (
                  <Icon name="download" size={20} onClick={() => handleDownload(item)} />
                )}
              </div>
            )}
            <span className="icon-browser__card-name" title={item.name}>
              {item.name}
            </span>
            <span className={`icon-browser__card-badge icon-browser__card-badge--${item.source}`}>
              {item.source}
            </span>
          </button>
        ))}
      </div>

      {previewIcon && (
        <div className="icon-browser__details">
          <div className="icon-browser__details-header">
            <div className="icon-browser__details-preview">
              {previewIcon.svg && (
                <div
                  className="icon-browser__details-svg"
                  dangerouslySetInnerHTML={{ __html: stripOuterSvg(previewIcon.svg) }}
                />
              )}
            </div>
            <div className="icon-browser__details-info">
              <h4 className="icon-browser__details-name">{previewIcon.name}</h4>
              <div className="icon-browser__details-actions">
                <button
                  type="button"
                  className={`icon-browser__detail-btn ${favourites.has(previewIcon.id) ? 'icon-browser__detail-btn--favourite' : ''}`}
                  onClick={() => handleToggleFavourite(previewIcon.id)}
                  aria-label={
                    favourites.has(previewIcon.id) ? 'Remove from favourites' : 'Add to favourites'
                  }
                >
                  <SolidIcon
                    name={favourites.has(previewIcon.id) ? 'heart-filled' : 'heart'}
                    size={16}
                  />
                </button>
                <button
                  type="button"
                  className="icon-browser__detail-btn icon-browser__detail-btn--primary"
                  onClick={() => handleInsert(previewIcon)}
                  disabled={!previewIcon.svg}
                >
                  Insert
                </button>
                {previewIcon.source === 'local' && (
                  <button
                    type="button"
                    className="icon-browser__detail-btn icon-browser__detail-btn--danger"
                    onClick={() => handleRemove(previewIcon)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="icon-browser__details-meta">
            <div className="icon-browser__meta-item">Prefix: {previewIcon.prefix}</div>
            {previewIcon.category && (
              <div className="icon-browser__meta-item">Category: {previewIcon.category}</div>
            )}
            {previewIcon.licence && (
              <div className="icon-browser__meta-item">Licence: {previewIcon.licence}</div>
            )}
            <div className="icon-browser__meta-item">ViewBox: {viewBox}</div>
            {previewIcon.styles.length > 0 && (
              <div className="icon-browser__details-variants">
                {previewIcon.styles.map((s) => (
                  <span key={s} className="icon-browser__variant-badge">
                    {s}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
