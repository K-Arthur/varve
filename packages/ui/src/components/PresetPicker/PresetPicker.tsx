import type { CustomPreset, Preset, PresetGroup } from '@strata/shared';
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { SearchField } from '../SearchField';
import { PresetTile } from './PresetTile';

export interface PresetPickerProps {
  /** Built-in preset groups, in display order. */
  groups: PresetGroup[];
  /** User-created presets, shown in their own "Custom" section. */
  customPresets?: CustomPreset[];
  /** Preset ids (built-in or custom), most-recent-first. */
  recentIds?: string[];
  /** Preset ids (built-in or custom) currently favorited. */
  favoriteIds?: Set<string>;
  /** The currently applied preset's id, if any (highlights that tile). */
  selectedId?: string;
  /** Accessible name for the picker's listbox. */
  label: string;
  onSelect: (preset: Preset) => void;
  onToggleFavorite?: (preset: Preset) => void;
  onEditCustom?: (preset: CustomPreset) => void;
  onDuplicateCustom?: (preset: CustomPreset) => void;
  onDeleteCustom?: (preset: CustomPreset) => void;
  /** Show the search field. Defaults to true — with 10 categories of
   *  built-ins plus custom presets, search is useful even for small lists. */
  searchable?: boolean;
}

type PickerRow =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'preset'; key: string; preset: Preset; isCustom: boolean };

function matchesQuery(preset: Preset, query: string): boolean {
  if (!query) return true;
  if (preset.name.toLowerCase().includes(query)) return true;
  return preset.tags?.some((tag) => tag.toLowerCase().includes(query)) ?? false;
}

function buildRows(
  groups: PresetGroup[],
  customPresets: CustomPreset[],
  recentIds: string[],
  favoriteIds: Set<string>,
  query: string,
): PickerRow[] {
  const q = query.trim().toLowerCase();
  const byId = new Map<string, Preset>();
  for (const preset of customPresets) byId.set(preset.id, preset);
  for (const group of groups) {
    for (const preset of group.presets) byId.set(preset.id, preset);
  }

  const rows: PickerRow[] = [];

  const favoritePresets = [...favoriteIds]
    .map((id) => byId.get(id))
    .filter((p): p is Preset => p != null && matchesQuery(p, q));
  if (favoritePresets.length > 0) {
    rows.push({ kind: 'header', key: 'section-favorites', label: 'Favorites' });
    for (const preset of favoritePresets) {
      rows.push({
        kind: 'preset',
        key: `favorite-${preset.id}`,
        preset,
        isCustom: preset.category === 'custom',
      });
    }
  }

  const recentPresets = recentIds
    .map((id) => byId.get(id))
    .filter((p): p is Preset => p != null && matchesQuery(p, q));
  if (recentPresets.length > 0) {
    rows.push({ kind: 'header', key: 'section-recent', label: 'Recent' });
    for (const preset of recentPresets) {
      rows.push({
        kind: 'preset',
        key: `recent-${preset.id}`,
        preset,
        isCustom: preset.category === 'custom',
      });
    }
  }

  const filteredCustom = customPresets.filter((p) => matchesQuery(p, q));
  if (filteredCustom.length > 0) {
    rows.push({ kind: 'header', key: 'section-custom', label: 'Custom' });
    for (const preset of filteredCustom) {
      rows.push({ kind: 'preset', key: `custom-${preset.id}`, preset, isCustom: true });
    }
  }

  for (const group of groups) {
    const filtered = group.presets.filter((p) => matchesQuery(p, q));
    if (filtered.length === 0) continue;
    rows.push({ kind: 'header', key: `section-${group.category}`, label: group.label });
    for (const preset of filtered) {
      rows.push({ kind: 'preset', key: `builtin-${preset.id}`, preset, isCustom: false });
    }
  }

  return rows;
}

function firstPresetIndex(rows: PickerRow[]): number {
  return rows.findIndex((row) => row.kind === 'preset');
}

function lastPresetIndex(rows: PickerRow[]): number {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]?.kind === 'preset') return i;
  }
  return -1;
}

// Stable references for omitted array/set props, so a caller that doesn't
// pass customPresets/recentIds/favoriteIds doesn't produce a new empty
// array/Set identity on every render — that would make `rows` recompute
// every render and re-trigger the highlight-reset effect below, silently
// undoing keyboard navigation.
const EMPTY_CUSTOM_PRESETS: CustomPreset[] = [];
const EMPTY_RECENT_IDS: string[] = [];
const EMPTY_FAVORITE_IDS = new Set<string>();

/**
 * A searchable, grouped, favorites/recents-aware preset picker — shared by
 * frame creation/resizing (@strata/editor) and new-document creation
 * (@strata/home). Always rendered inline and already "open" (both real
 * consumers show it inside an already-visible panel), so this manages its
 * own roving aria-activedescendant listbox rather than a popover.
 */
export function PresetPicker({
  groups,
  customPresets = EMPTY_CUSTOM_PRESETS,
  recentIds = EMPTY_RECENT_IDS,
  favoriteIds = EMPTY_FAVORITE_IDS,
  selectedId,
  label,
  onSelect,
  onToggleFavorite,
  onEditCustom,
  onDuplicateCustom,
  onDeleteCustom,
  searchable = true,
}: PresetPickerProps) {
  const [query, setQuery] = useState('');
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const listboxRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const rows = useMemo(
    () => buildRows(groups, customPresets, recentIds, favoriteIds, query),
    [groups, customPresets, recentIds, favoriteIds, query],
  );

  const presetRowCount = useMemo(() => rows.filter((r) => r.kind === 'preset').length, [rows]);

  // Reset to the first preset row only when the search query changes (typed
  // by the user) — not on every `rows` recomputation, which would also fire
  // for unrelated re-renders (e.g. a favorite toggled elsewhere) and yank
  // the keyboard cursor back to the top mid-navigation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset selection when query changes only
  useEffect(() => {
    const first = firstPresetIndex(rows);
    setHighlightedIdx(first === -1 ? 0 : first);
  }, [query]);

  // Defensive clamp: if rows changed shape (e.g. the highlighted custom
  // preset was deleted) so the current index no longer points at a valid
  // row, fall back to the first preset row. Uses the functional updater form
  // so it's a no-op (bails out of re-rendering) whenever the index is still
  // valid — safe to key off `rows` even though its identity can change on
  // unrelated re-renders, since it won't touch state unless truly stale.
  useEffect(() => {
    setHighlightedIdx((prev) => {
      if (prev < rows.length && rows[prev]?.kind === 'preset') return prev;
      const first = firstPresetIndex(rows);
      return first === -1 ? prev : first;
    });
  }, [rows]);

  useEffect(() => {
    const highlighted = listboxRef.current?.querySelector<HTMLElement>('[data-highlighted="true"]');
    highlighted?.scrollIntoView({ block: 'nearest' });
  }, []);

  const selectRow = useCallback(
    (idx: number) => {
      const row = rows[idx];
      if (row?.kind === 'preset') onSelect(row.preset);
    },
    [rows, onSelect],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightedIdx((i) => {
            let next = i + 1;
            while (next < rows.length && rows[next]?.kind === 'header') next++;
            return next < rows.length ? next : i;
          });
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightedIdx((i) => {
            let prev = i - 1;
            while (prev >= 0 && rows[prev]?.kind === 'header') prev--;
            return prev >= 0 ? prev : i;
          });
          break;
        case 'Home':
          e.preventDefault();
          setHighlightedIdx((i) => {
            const first = firstPresetIndex(rows);
            return first === -1 ? i : first;
          });
          break;
        case 'End':
          e.preventDefault();
          setHighlightedIdx((i) => {
            const last = lastPresetIndex(rows);
            return last === -1 ? i : last;
          });
          break;
        case 'Enter':
          e.preventDefault();
          selectRow(highlightedIdx);
          break;
        case 'Escape':
          if (query) {
            e.preventDefault();
            setQuery('');
          }
          break;
      }
    },
    [rows, highlightedIdx, selectRow, query],
  );

  const activeOptionId =
    rows[highlightedIdx]?.kind === 'preset' ? `${listboxId}-option-${highlightedIdx}` : undefined;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: composite combobox+listbox keydown handler, mirroring HomeSearchPalette — catches bubbled keydown from whichever real interactive descendant (search input or listbox) currently has focus.
    <div className="preset-picker" onKeyDown={handleKeyDown}>
      {searchable && (
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search presets..."
          resultCount={presetRowCount}
          className="preset-picker__search"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          aria-autocomplete="list"
          aria-label={label}
        />
      )}
      <div
        ref={listboxRef}
        id={listboxId}
        role="listbox"
        aria-label={label}
        // Only independently focusable when there's no combobox input to
        // hold focus instead — otherwise this would be a redundant second
        // Tab stop ahead of the virtual aria-activedescendant navigation.
        tabIndex={searchable ? undefined : 0}
        className="preset-picker__listbox"
      >
        {rows.length === 0 && (
          <div className="preset-picker__empty">No presets match "{query}"</div>
        )}
        {rows.map((row, idx) => {
          if (row.kind === 'header') {
            return (
              <div key={row.key} role="presentation" className="preset-picker__group-label">
                {row.label}
              </div>
            );
          }
          const { preset, isCustom } = row;
          return (
            <PresetTile
              key={row.key}
              preset={preset}
              optionId={`${listboxId}-option-${idx}`}
              isCustom={isCustom}
              isHighlighted={idx === highlightedIdx}
              isSelected={preset.id === selectedId}
              isFavorite={favoriteIds.has(preset.id)}
              onSelect={() => onSelect(preset)}
              onMouseEnter={() => setHighlightedIdx(idx)}
              onToggleFavorite={onToggleFavorite ? () => onToggleFavorite(preset) : undefined}
              onEdit={
                isCustom && onEditCustom ? () => onEditCustom(preset as CustomPreset) : undefined
              }
              onDuplicate={
                isCustom && onDuplicateCustom
                  ? () => onDuplicateCustom(preset as CustomPreset)
                  : undefined
              }
              onDelete={
                isCustom && onDeleteCustom
                  ? () => onDeleteCustom(preset as CustomPreset)
                  : undefined
              }
            />
          );
        })}
      </div>
    </div>
  );
}
