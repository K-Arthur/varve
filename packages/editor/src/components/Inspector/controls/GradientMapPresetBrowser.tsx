/**
 * Gradient preset browser — searchable list with favorites/recents, keyboard
 * navigation (roving tabindex), and the shared context-menu system. Pure
 * props: no editor context required, so it is unit-testable.
 */
import type { GradientPreset } from '@varve/scene';
import { displayName } from '@varve/scene';
import { ContextMenu, IconButton, SearchField, ToggleButton } from '@varve/ui';
import { type KeyboardEvent, useMemo, useRef, useState } from 'react';
import { gradientPresetToCss } from '../../../gradientPresets/thumbnail';
import { useRovingTabIndex } from '../../../hooks';
import { confirmDialog, promptDialog } from '../../PromptDialog';

type Category = 'all' | 'favorites' | 'recent';

export interface GradientPresetBrowserProps {
  presets: GradientPreset[];
  favoriteIds: Set<string>;
  recentIds: string[];
  selectedId?: string;
  onSelect: (preset: GradientPreset) => void;
  onToggleFavorite?: (id: string) => void;
  onImport?: () => void;
  onRename?: (id: string, name: string) => void;
  onDuplicate?: (id: string) => void;
  onDelete?: (id: string) => void;
  onExport?: (preset: GradientPreset) => void;
  label?: string;
}

export function GradientMapPresetBrowser({
  presets,
  favoriteIds,
  recentIds,
  selectedId,
  onSelect,
  onToggleFavorite,
  onImport,
  onRename,
  onDuplicate,
  onDelete,
  onExport,
  label = 'Gradient presets',
}: GradientPresetBrowserProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [context, setContext] = useState<{ x: number; y: number; preset: GradientPreset } | null>(
    null,
  );
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return presets.filter((p) => {
      if (category === 'favorites' && !favoriteIds.has(p.id)) return false;
      if (category === 'recent' && !recentIds.includes(p.id)) return false;
      if (q.length > 0 && !displayName(p).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [presets, query, category, favoriteIds, recentIds]);

  const roving = useRovingTabIndex({ orientation: 'vertical', wrap: true });

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (filtered.length === 0) return;
    roving.handleKeyDown(e);
    if (
      e.target === e.currentTarget &&
      e.key === 'Enter' &&
      roving.currentIndex >= 0 &&
      filtered[roving.currentIndex]
    ) {
      onSelect(filtered[roving.currentIndex]!);
    }
  };

  const contextItems = useMemo<import('@varve/ui').MenuEntry[]>(() => {
    if (!context) return [];
    const id = context.preset.id;
    const items: import('@varve/ui').MenuEntry[] = [];
    if (onToggleFavorite) {
      items.push({
        id: 'favorite',
        label: favoriteIds.has(id) ? 'Remove from favorites' : 'Add to favorites',
        onAction: () => onToggleFavorite(id),
      });
    }
    if (onRename) {
      items.push({
        id: 'rename',
        label: 'Rename',
        onAction: async () => {
          const name = await promptDialog('Rename preset', displayName(context.preset));
          if (name?.trim()) onRename(id, name.trim());
        },
      });
    }
    if (onDuplicate) {
      items.push({ id: 'duplicate', label: 'Duplicate', onAction: () => onDuplicate(id) });
    }
    if (onExport) {
      items.push({
        id: 'export',
        label: 'Export preset',
        onAction: () => onExport(context.preset),
      });
    }
    if (onDelete) {
      items.push({
        id: 'delete',
        label: 'Delete',
        onAction: async () => {
          if (
            await confirmDialog(
              'Delete preset',
              `Delete preset "${displayName(context.preset)}"?`,
              {
                confirmLabel: 'Delete',
                variant: 'danger',
              },
            )
          )
            onDelete(id);
        },
      });
    }
    return items;
  }, [context, favoriteIds, onToggleFavorite, onRename, onDuplicate, onExport, onDelete]);

  return (
    <section className="gmp-browser" aria-label={label}>
      <div className="gmp-browser__toolbar">
        <SearchField
          aria-label="Search gradient presets"
          value={query}
          onChange={setQuery}
          placeholder="Search presets"
          resultCount={filtered.length}
        />
        {onImport && (
          <IconButton label="Import gradient presets" icon="Upload" size="sm" onClick={onImport} />
        )}
      </div>
      <div className="gmp-browser__categories">
        {(
          [
            ['all', 'All'],
            ['favorites', 'Favorites'],
            ['recent', 'Recent'],
          ] as const
        ).map(([key, text]) => (
          <ToggleButton
            key={key}
            label={text}
            pressed={category === key}
            onPressedChange={() => setCategory(key)}
            size="sm"
          />
        ))}
      </div>
      <div
        ref={listRef}
        className="gmp-browser__list"
        role="listbox"
        aria-label="Gradient preset list"
        tabIndex={0}
        aria-activedescendant={
          roving.currentIndex >= 0 && filtered[roving.currentIndex]
            ? `gmp-item-${filtered[roving.currentIndex]!.id}`
            : undefined
        }
        onKeyDown={handleKeyDown}
      >
        {filtered.length === 0 && (
          <p className="gmp-browser__empty">
            {query || category !== 'all'
              ? 'No matching presets'
              : 'No presets yet. Import a .grd file to get started.'}
          </p>
        )}
        {filtered.map((preset, index) => {
          const selected = preset.id === selectedId;
          return (
            <div
              key={preset.id}
              id={`gmp-item-${preset.id}`}
              role="option"
              aria-selected={selected}
              aria-label={`${displayName(preset)}${preset.compatibility?.status === 'unsupported' ? ' (read-only)' : ''}`}
              tabIndex={roving.getTabIndex(index)}
              className={`gmp-item${selected ? ' gmp-item--selected' : ''}`}
              onClick={() => onSelect(preset)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(preset);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setContext({ x: e.clientX, y: e.clientY, preset });
              }}
            >
              <span
                className="gmp-item__swatch"
                style={{ background: gradientPresetToCss(preset) }}
                aria-hidden="true"
              />
              <span className="gmp-item__name">{displayName(preset)}</span>
              {preset.compatibility?.status === 'unsupported' && (
                <span
                  className="gmp-item__badge gmp-item__badge--warn"
                  title={preset.compatibility.message}
                >
                  Read-only
                </span>
              )}
              {preset.compatibility?.status === 'approximated' && (
                <span className="gmp-item__badge" title={preset.compatibility.message}>
                  Approx.
                </span>
              )}
              {onToggleFavorite && (
                <IconButton
                  label={favoriteIds.has(preset.id) ? 'Remove from favorites' : 'Add to favorites'}
                  icon="Star"
                  size="sm"
                  className="gmp-item__fav"
                  aria-pressed={favoriteIds.has(preset.id)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite(preset.id);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <ContextMenu
        items={contextItems}
        position={context ? { x: context.x, y: context.y } : null}
        onClose={() => setContext(null)}
        label="Gradient preset actions"
      />
    </section>
  );
}
