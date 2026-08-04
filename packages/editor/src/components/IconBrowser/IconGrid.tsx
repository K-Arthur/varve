/**
 * IconGrid — virtualized, keyboard-navigable icon grid.
 *
 * APG pattern: role="grid" with roving tabindex. Navigation uses the actual
 * rendered column count (measured from the container), not a hard-coded
 * step. Home/End/PageUp/PageDown/arrows supported; Enter/Space activates
 * insertion.
 */

import { useVirtualizer } from '@tanstack/react-virtual';
import type { IconSourceDescriptor } from '@varve/engine';
import { Icon, SolidIcon, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SafeSvg } from './SafeSvg';

export const ICON_CARD_SIZE = 68;
export const ICON_CARD_GAP = 6;
export const GRID_PADDING = 8;

export interface IconGridItemView {
  descriptor: IconSourceDescriptor;
  /** Sanitized SVG when a preview is available. */
  svg?: string;
  /** True while the preview is being fetched. */
  loading?: boolean;
  isFavourite: boolean;
  isInDocument: boolean;
  isBrand: boolean;
  licenceWarning: boolean;
}

export interface IconGridProps {
  items: IconGridItemView[];
  selectedId?: string;
  acquiringIds: Set<string>;
  onSelect: (id: string) => void;
  onInsert: (id: string) => void;
  onToggleFavourite: (id: string) => void;
  onVisibleRangeChange?: (start: number, end: number) => void;
  ariaLabel?: string;
  emptyState?: React.ReactNode;
  /** Card size in px; controls column count and row height. */
  cardSize?: number;
}

export function IconGrid({
  items,
  selectedId,
  acquiringIds,
  onSelect,
  onInsert,
  onToggleFavourite,
  onVisibleRangeChange,
  ariaLabel = 'Icon results',
  emptyState,
  cardSize = ICON_CARD_SIZE,
}: IconGridProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [columns, setColumns] = useState(4);

  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth - GRID_PADDING * 2;
      const cols = Math.max(1, Math.floor((width + ICON_CARD_GAP) / (cardSize + ICON_CARD_GAP)));
      setColumns(cols);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const count = items.length;

  const rowCount = Math.ceil(count / columns);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => cardSize + ICON_CARD_GAP,
    overscan: 2,
  });

  const visibleRange = useMemo(() => {
    const start = Math.max(0, virtualizer.range?.startIndex ?? 0);
    const end = Math.min(rowCount, (virtualizer.range?.endIndex ?? 0) + 1);
    return { start, end };
  }, [virtualizer.range?.startIndex, virtualizer.range?.endIndex, rowCount]);

  useEffect(() => {
    if (visibleRange.end > visibleRange.start) {
      onVisibleRangeChange?.(
        visibleRange.start * columns,
        Math.min(count, visibleRange.end * columns),
      );
    }
  }, [visibleRange, columns, count, onVisibleRangeChange]);

  useEffect(() => {
    if (focusedIndex >= count) setFocusedIndex(Math.max(0, count - 1));
  }, [count, focusedIndex]);

  const focusIndex = (index: number) => {
    const clamped = Math.max(0, Math.min(count - 1, index));
    setFocusedIndex(clamped);
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (count === 0) return;
      const current = focusedIndex;
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          focusIndex(current + 1);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          focusIndex(current - 1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          focusIndex(current + columns);
          break;
        case 'ArrowUp':
          e.preventDefault();
          focusIndex(current - columns);
          break;
        case 'Home':
          e.preventDefault();
          focusIndex(0);
          break;
        case 'End':
          e.preventDefault();
          focusIndex(count - 1);
          break;
        case 'PageDown':
          e.preventDefault();
          focusIndex(current + columns * 4);
          break;
        case 'PageUp':
          e.preventDefault();
          focusIndex(current - columns * 4);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          onInsert(items[current]?.descriptor.canonicalId ?? '');
          break;
        default:
          return;
      }
    },
    [count, focusedIndex, columns, items, onInsert],
  );

  const getItem = (index: number): IconGridItemView | undefined => items[index];

  return (
    // biome-ignore lint/a11y/useSemanticElements: virtualized scroll container cannot be a <table>; APG grid pattern kept on div
    <div
      className="icon-grid__scroll"
      ref={parentRef}
      role="grid"
      aria-label={ariaLabel}
      aria-rowcount={rowCount}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {count === 0 ? (
        (emptyState ?? null)
      ) : (
        <div
          className="icon-grid__inner"
          style={{ height: virtualizer.getTotalSize() }}
          data-columns={columns}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const rowStart = virtualRow.index * columns;
            const cells: React.ReactNode[] = [];
            for (let c = 0; c < columns; c++) {
              const index = rowStart + c;
              if (index >= count) break;
              const item = getItem(index);
              if (!item) break;
              const isFocused = index === focusedIndex;
              const isSelected = selectedId === item.descriptor.canonicalId;
              const isAcquiring = acquiringIds.has(item.descriptor.canonicalId);
              cells.push(
                <IconGridCard
                  key={item.descriptor.canonicalId}
                  item={item}
                  index={index}
                  cardSize={cardSize}
                  isFocused={isFocused}
                  isSelected={isSelected}
                  isAcquiring={isAcquiring}
                  onSelect={onSelect}
                  onInsert={onInsert}
                  onToggleFavourite={onToggleFavourite}
                />,
              );
            }
            return (
              // biome-ignore lint/a11y/useSemanticElements: virtualized rows cannot be <tr>; the parent grid handles keyboard navigation
              // biome-ignore lint/a11y/useFocusableInteractive: rows are non-interactive containers; focus lands on the focused gridcell
              <div
                key={virtualRow.key}
                role="row"
                aria-rowindex={virtualRow.index + 1}
                className="icon-grid__row"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                {cells}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface IconGridCardProps {
  item: IconGridItemView;
  index: number;
  cardSize: number;
  isFocused: boolean;
  isSelected: boolean;
  isAcquiring: boolean;
  onSelect: (id: string) => void;
  onInsert: (id: string) => void;
  onToggleFavourite: (id: string) => void;
}

function IconGridCard({
  item,
  index,
  cardSize,
  isFocused,
  isSelected,
  isAcquiring,
  onSelect,
  onInsert,
  onToggleFavourite,
}: IconGridCardProps) {
  const { descriptor } = item;
  const name = descriptor.displayName;
  const brandWarning = item.isBrand;
  const licenceWarning = item.licenceWarning;

  return (
    // biome-ignore lint/a11y/useSemanticElements: virtualized grid cells cannot be <td>; APG grid pattern kept on div
    <div
      role="gridcell"
      aria-rowindex={index + 1}
      aria-label={`${name}${item.isFavourite ? ', favourite' : ''}`}
      aria-selected={isSelected}
      tabIndex={isFocused ? 0 : -1}
      className={[
        'icon-card',
        isSelected ? 'icon-card--selected' : '',
        isFocused ? 'icon-card--focused' : '',
        cardSize < ICON_CARD_SIZE ? 'icon-card--compact' : '',
      ].join(' ')}
      data-icon-id={descriptor.canonicalId}
      onFocus={() => {
        if (!isFocused) onSelect(descriptor.canonicalId);
      }}
      onClick={() => onSelect(descriptor.canonicalId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(descriptor.canonicalId);
        }
      }}
      onDoubleClick={() => {
        onSelect(descriptor.canonicalId);
        onInsert(descriptor.canonicalId);
      }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(
          'application/x-varve-icon',
          JSON.stringify({
            canonicalId: descriptor.canonicalId,
            name: descriptor.name,
            packId: descriptor.packId,
            providerId: descriptor.providerId,
            svg: item.svg ?? '',
          }),
        );
        e.dataTransfer.effectAllowed = 'copy';
      }}
    >
      <div className="icon-card__preview" style={{ height: cardSize - 28 }}>
        {item.svg ? (
          <SafeSvg svg={item.svg} label={name} className="icon-card__svg" />
        ) : isAcquiring ? (
          <Icon name="Loader" size={18} className="icon-card__spinner" aria-label="Loading" />
        ) : item.loading ? (
          <div className="icon-card__skeleton" aria-hidden="true" />
        ) : (
          <div className="icon-card__skeleton" aria-hidden="true" />
        )}
      </div>
      <Tooltip label={name} truncationOnly>
        <span className="icon-card__name">{name}</span>
      </Tooltip>
      <div className="icon-card__badges">
        {item.isInDocument && (
          <span className="icon-card__badge icon-card__badge--doc" title="Already in document">
            <Icon name="Check" size={10} />
          </span>
        )}
        {item.isFavourite && (
          <span className="icon-card__badge icon-card__badge--fav" title="Favourite">
            <SolidIcon name="HeartFill" size={10} />
          </span>
        )}
        {brandWarning && (
          <span className="icon-card__badge icon-card__badge--brand" title="Brand/trademark icon">
            TM
          </span>
        )}
        {licenceWarning && (
          <span
            className="icon-card__badge icon-card__badge--licence"
            title="Licence requires review"
          >
            (c)
          </span>
        )}
      </div>
      <button
        type="button"
        className="icon-card__fav"
        aria-label={
          item.isFavourite ? `Remove ${name} from favourites` : `Add ${name} to favourites`
        }
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavourite(descriptor.canonicalId);
        }}
      >
        <SolidIcon name={item.isFavourite ? 'HeartFill' : 'Heart'} size={14} />
      </button>
    </div>
  );
}
