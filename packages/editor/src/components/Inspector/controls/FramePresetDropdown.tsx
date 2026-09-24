/**
 * FramePresetDropdown — searchable, categorized preset switcher for frames.
 *
 * Displays the currently detected preset name (e.g. "iPhone 16", "Desktop",
 * "Mixed", or "Custom" if arbitrary dimensions). When opened, presents an instant
 * search field, category filter chips (All, Phone, Desktop, Social, Comic, Print,
 * Custom, Favorites), Favorites/Recents, custom preset management, and dimension tags,
 * eliminating the long scrolling complaints common in Figma and Penpot.
 */

import type { FrameNode } from '@varve/scene';
import {
  BUILTIN_PRESET_GROUPS,
  findMatchingPreset,
  type Preset,
  type PresetCategory,
  type PresetGroup,
  physicalToPx,
} from '@varve/shared';
import { FloatingPortal, Icon, type IconName, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { usePresetLibrary } from '../../../presetLibrary';
import { promptDialog } from '../../PromptDialog';

const FRAME_CATEGORY_ORDER: readonly PresetGroup['category'][] = [
  'mobile-tablet',
  'desktop',
  'watch',
  'presentation',
  'social',
  'video-motion',
  'icon-asset',
  'paper',
  'comic',
  'print',
];

export type FilterCategory =
  | 'all'
  | 'favorites'
  | 'phone'
  | 'desktop'
  | 'social'
  | 'comic'
  | 'print'
  | 'custom';

export interface CategoryChip {
  id: FilterCategory;
  label: string;
  icon?: IconName;
}

export const CATEGORY_CHIPS: readonly CategoryChip[] = [
  { id: 'all', label: 'All' },
  { id: 'favorites', label: 'Favorites', icon: 'Star' },
  { id: 'phone', label: 'Phone', icon: 'Smartphone' },
  { id: 'desktop', label: 'Desktop', icon: 'Monitor' },
  { id: 'social', label: 'Social', icon: 'Share2' },
  { id: 'comic', label: 'Comic', icon: 'BookOpen' },
  { id: 'print', label: 'Print', icon: 'FileText' },
  { id: 'custom', label: 'Custom', icon: 'SlidersHorizontal' },
];

export function previewDims(
  preset: { width: number; height: number },
  box = 14,
): { w: number; h: number } {
  const min = Math.max(3, Math.round(box / 4));
  const ratio = preset.width / preset.height;
  if (ratio >= 1) return { w: box, h: Math.max(min, Math.round(box / ratio)) };
  return { w: Math.max(min, Math.round(box * ratio)), h: box };
}

export function formatPresetSize(preset: Preset): string {
  const w = Math.round(physicalToPx(preset.width, preset.unit));
  const h = Math.round(physicalToPx(preset.height, preset.unit));
  return `${w} x ${h}`;
}

export function matchesPreset(preset: Preset, query: string): boolean {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  if (preset.name.toLowerCase().includes(q)) return true;
  if (preset.category.toLowerCase().includes(q)) return true;
  const pw = String(Math.round(physicalToPx(preset.width, preset.unit)));
  const ph = String(Math.round(physicalToPx(preset.height, preset.unit)));
  if (pw.includes(q) || ph.includes(q)) return true;
  if (`${pw}x${ph}`.includes(q) || `${pw} x ${ph}`.includes(q)) return true;
  if (preset.tags?.some((tag) => tag.toLowerCase().includes(q))) return true;
  if (q === '4k' && (pw === '3840' || ph === '2160')) return true;
  return false;
}

export function categoryMatchesFilter(category: PresetCategory, filter: FilterCategory): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'phone':
      return category === 'mobile-tablet' || category === 'watch';
    case 'desktop':
      return category === 'desktop' || category === 'web' || category === 'presentation';
    case 'social':
      return category === 'social' || category === 'video-motion';
    case 'comic':
      return category === 'comic';
    case 'print':
      return category === 'print' || category === 'paper';
    case 'custom':
      return category === 'custom';
    default:
      return true;
  }
}

interface FramePresetDropdownProps {
  /** The selected frame (for single selection). */
  frame?: FrameNode;
  /** All selected frames (for single or multi-frame selection). */
  frames?: FrameNode[];
}

export function FramePresetDropdown({ frame, frames }: FramePresetDropdownProps) {
  const editor = useEditor();
  const { applyFramePreset, platform } = editor;
  const lib = usePresetLibrary(platform);

  const allFrames = useMemo(() => {
    if (frames && frames.length > 0) return frames;
    if (frame) return [frame];
    return [];
  }, [frame, frames]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<FilterCategory>('all');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const singleFrame = allFrames.length === 1 ? allFrames[0] : null;

  // Detect if current frame width/height matches any known preset
  const matched = useMemo(() => {
    if (!singleFrame) return null;
    return findMatchingPreset(singleFrame.w, singleFrame.h);
  }, [singleFrame?.w, singleFrame?.h]);

  const multiPreset = useMemo(() => {
    if (allFrames.length <= 1) return null;
    const firstW = allFrames[0]!.w;
    const firstH = allFrames[0]!.h;
    const allSame = allFrames.every((f) => f.w === firstW && f.h === firstH);
    if (!allSame) return 'mixed';
    const m = findMatchingPreset(firstW, firstH);
    return m ? (m.isLandscape ? `${m.preset.name} (Landscape)` : m.preset.name) : 'Custom';
  }, [allFrames]);

  const activeLabel = useMemo(() => {
    if (allFrames.length > 1) {
      if (multiPreset === 'mixed') return 'Mixed';
      return multiPreset ?? 'Custom';
    }
    if (!matched) return 'Custom';
    return matched.isLandscape ? `${matched.preset.name} (Landscape)` : matched.preset.name;
  }, [allFrames.length, multiPreset, matched]);

  const activeIcon = useMemo<IconName>(() => {
    if (allFrames.length > 1 && multiPreset === 'mixed') return 'Layers';
    const category = matched?.preset.category;
    switch (category) {
      case 'mobile-tablet':
        return matched?.isLandscape ? 'Tablet' : 'Smartphone';
      case 'desktop':
      case 'web':
        return 'Monitor';
      case 'watch':
        return 'Watch';
      case 'social':
        return 'Share2';
      case 'presentation':
        return 'Presentation';
      case 'paper':
      case 'print':
        return 'FileText';
      case 'video-motion':
        return 'Film';
      case 'comic':
        return 'BookOpen';
      case 'custom':
        return 'SlidersHorizontal';
      default:
        return 'LayoutGrid';
    }
  }, [allFrames.length, multiPreset, matched]);

  // Built-in groups sorted by category priority
  const sortedBuiltinGroups = useMemo(() => {
    return [...BUILTIN_PRESET_GROUPS].sort((a, b) => {
      const idxA = FRAME_CATEGORY_ORDER.indexOf(a.category);
      const idxB = FRAME_CATEGORY_ORDER.indexOf(b.category);
      const rankA = idxA === -1 ? FRAME_CATEGORY_ORDER.length : idxA;
      const rankB = idxB === -1 ? FRAME_CATEGORY_ORDER.length : idxB;
      return rankA - rankB;
    });
  }, []);

  const customPresets = useMemo(() => lib.customPresets ?? [], [lib.customPresets]);
  const favoriteIds = useMemo(() => lib.favoriteIds ?? new Set<string>(), [lib.favoriteIds]);
  const recentIds = useMemo(() => lib.recentIds ?? [], [lib.recentIds]);

  // Map of all presets by ID for quick resolution of favorites and recents
  const presetsById = useMemo(() => {
    const map = new Map<string, Preset>();
    for (const cp of customPresets) map.set(cp.id, cp);
    for (const g of sortedBuiltinGroups) {
      for (const p of g.presets) map.set(p.id, p);
    }
    return map;
  }, [customPresets, sortedBuiltinGroups]);

  // Filtered presets organized into displayable groups
  const displayGroups = useMemo(() => {
    const groups: { key: string; label: string; presets: Preset[]; isCustom?: boolean }[] = [];

    // Favorites
    if (selectedFilter === 'all' || selectedFilter === 'favorites') {
      const favList: Preset[] = [];
      for (const favId of favoriteIds) {
        const p = presetsById.get(favId);
        if (p && matchesPreset(p, query)) {
          favList.push(p);
        }
      }
      if (favList.length > 0) {
        groups.push({ key: 'section-favorites', label: 'Favorites', presets: favList });
      }
    }

    // Recent
    if (selectedFilter === 'all' && !query.trim()) {
      const recentList: Preset[] = [];
      for (const recId of recentIds.slice(0, 4)) {
        const p = presetsById.get(recId);
        if (p && !favoriteIds.has(recId)) {
          recentList.push(p);
        }
      }
      if (recentList.length > 0) {
        groups.push({ key: 'section-recent', label: 'Recent', presets: recentList });
      }
    }

    // Custom
    if (selectedFilter === 'all' || selectedFilter === 'custom') {
      const customFiltered = customPresets.filter((p) => matchesPreset(p, query));
      if (customFiltered.length > 0) {
        groups.push({
          key: 'section-custom',
          label: 'Custom',
          presets: customFiltered,
          isCustom: true,
        });
      }
    }

    // Built-in categories
    if (selectedFilter !== 'favorites' && selectedFilter !== 'custom') {
      for (const g of sortedBuiltinGroups) {
        if (!categoryMatchesFilter(g.category, selectedFilter)) continue;
        const matching = g.presets.filter((p) => matchesPreset(p, query));
        if (matching.length > 0) {
          groups.push({ key: `builtin-${g.category}`, label: g.label, presets: matching });
        }
      }
    }

    return groups;
  }, [
    selectedFilter,
    query,
    favoriteIds,
    recentIds,
    customPresets,
    presetsById,
    sortedBuiltinGroups,
  ]);

  // Flat array of all visible presets for arrow-key roving index
  const flatVisiblePresets = useMemo(() => {
    return displayGroups.flatMap((g) => g.presets);
  }, [displayGroups]);

  useEffect(() => {
    if (open) {
      searchInputRef.current?.focus();
      setHighlightedIndex(0);
    } else {
      setQuery('');
      setSelectedFilter('all');
    }
  }, [open]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query, selectedFilter]);

  const handleSelect = useCallback(
    (preset: Preset) => {
      const w = Math.round(physicalToPx(preset.width, preset.unit));
      const h = Math.round(physicalToPx(preset.height, preset.unit));

      if (allFrames.length > 1) {
        editor.beginTransaction();
        for (const f of allFrames) {
          editor.updateNode(f.id, (n) => (n.kind === 'frame' ? { ...n, w, h } : n));
        }
        editor.commitTransaction();
      } else {
        applyFramePreset({ name: preset.name, w, h });
      }
      lib.recordRecent?.(preset.id);
      setOpen(false);
    },
    [allFrames, applyFramePreset, editor, lib],
  );

  const handleSaveCurrentAsPreset = useCallback(async () => {
    const primary = allFrames[0];
    if (!primary) return;
    const defaultName = primary.name || 'Custom Preset';
    const name = await promptDialog('Save frame size as preset', defaultName);
    if (!name) return;
    lib.addCustomPreset?.({
      name,
      width: primary.w,
      height: primary.h,
      unit: 'px',
      orientation:
        primary.w === primary.h ? 'square' : primary.w > primary.h ? 'landscape' : 'portrait',
    });
  }, [allFrames, lib]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev < flatVisiblePresets.length - 1 ? prev + 1 : 0));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : Math.max(0, flatVisiblePresets.length - 1),
        );
        return;
      }
      if (e.key === 'Enter') {
        if (flatVisiblePresets[highlightedIndex]) {
          e.preventDefault();
          handleSelect(flatVisiblePresets[highlightedIndex]!);
        }
      }
    },
    [flatVisiblePresets, highlightedIndex, handleSelect],
  );

  return (
    <div className="insp-preset-dropdown-container">
      <Tooltip label={`Resize to preset: ${activeLabel}`}>
        <button
          ref={triggerRef}
          type="button"
          className="insp-preset-dropdown__trigger"
          onClick={() => setOpen((prev) => !prev)}
          aria-label="Resize to Preset"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          data-testid="frame-preset-dropdown-trigger"
        >
          <span className="insp-preset-dropdown__trigger-content">
            <Icon
              name={activeIcon}
              size={13}
              className="insp-preset-dropdown__trigger-leading-icon"
            />
            <span className="insp-preset-dropdown__trigger-text">{activeLabel}</span>
          </span>
          <Icon name="ChevronDown" size={12} className="insp-preset-dropdown__trigger-icon" />
        </button>
      </Tooltip>

      {open && (
        <FloatingPortal
          anchorRef={triggerRef}
          open={open}
          onClose={() => setOpen(false)}
          placement="bottom-start"
          maxHeight={460}
          kind="combobox-popup"
          dismissOnEscape
          className="varve-floating-layer"
        >
          <div
            id={listboxId}
            className="insp-preset-popover"
            role="dialog"
            aria-label="Select frame preset"
            data-testid="frame-preset-popover"
            onKeyDown={handleKeyDown}
          >
            {/* Search header */}
            <div className="insp-preset-popover__search">
              <Icon name="Search" size={14} className="insp-preset-popover__search-icon" />
              <input
                ref={searchInputRef}
                type="text"
                className="insp-preset-popover__search-input"
                placeholder="Search presets or size (e.g. 1080, 4k)..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Filter presets"
              />
              {query && (
                <button
                  type="button"
                  className="insp-preset-popover__clear"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                >
                  <Icon name="X" size={12} />
                </button>
              )}
            </div>

            {/* Category filter chips */}
            <div className="insp-preset-chips" role="tablist" aria-label="Preset categories">
              {CATEGORY_CHIPS.map((chip) => {
                const isActive = selectedFilter === chip.id;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    role="tab"
                    aria-label={chip.label}
                    aria-selected={isActive}
                    className={`insp-preset-chip${isActive ? ' insp-preset-chip--active' : ''}`}
                    onClick={() => setSelectedFilter(chip.id)}
                  >
                    {chip.icon && (
                      <Icon
                        name={chip.icon}
                        size={11}
                        className="insp-preset-chip__icon"
                        aria-hidden="true"
                      />
                    )}
                    <span>{chip.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Preset options list */}
            <div ref={listboxRef} className="insp-preset-popover__list" role="listbox">
              {displayGroups.length === 0 ? (
                <p className="insp-preset-popover__empty">No presets matching "{query}"</p>
              ) : (
                displayGroups.map((group) => (
                  <div key={group.key} className="insp-preset-group">
                    <div className="insp-preset-group__header">{group.label}</div>
                    {group.presets.map((preset) => {
                      const isSelected =
                        matched?.preset.id === preset.id ||
                        (singleFrame != null &&
                          Math.round(singleFrame.w) ===
                            Math.round(physicalToPx(preset.width, preset.unit)) &&
                          Math.round(singleFrame.h) ===
                            Math.round(physicalToPx(preset.height, preset.unit)));
                      const isFav = favoriteIds.has(preset.id);
                      const isCustom = preset.category === 'custom';
                      const preview = previewDims(preset, 14);

                      return (
                        <div
                          key={preset.id}
                          className={`insp-preset-item-wrapper${
                            isSelected ? ' insp-preset-item-wrapper--selected' : ''
                          }`}
                        >
                          <button
                            type="button"
                            role="option"
                            aria-label={preset.name}
                            aria-selected={isSelected}
                            className={`insp-preset-item${
                              isSelected ? ' insp-preset-item--selected' : ''
                            }`}
                            onClick={() => handleSelect(preset)}
                          >
                            <span
                              className="insp-preset-item__preview"
                              style={{ width: `${preview.w}px`, height: `${preview.h}px` }}
                              aria-hidden="true"
                            />
                            <span className="insp-preset-item__name">
                              {isSelected && (
                                <Icon
                                  name="Check"
                                  size={12}
                                  className="insp-preset-item__check"
                                  aria-hidden="true"
                                />
                              )}
                              <span>{preset.name}</span>
                            </span>
                            <span className="insp-preset-item__dims">
                              {formatPresetSize(preset)}
                            </span>
                          </button>

                          {/* Quick favorite star toggle */}
                          <button
                            type="button"
                            className={`insp-preset-fav-btn${
                              isFav ? ' insp-preset-fav-btn--active' : ''
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              lib.toggleFavorite?.(preset.id);
                            }}
                            title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                            aria-label={
                              isFav
                                ? `Remove ${preset.name} from favorites`
                                : `Add ${preset.name} to favorites`
                            }
                          >
                            <Icon name="Star" size={12} />
                          </button>

                          {/* Custom preset delete */}
                          {isCustom && (
                            <button
                              type="button"
                              className="insp-preset-delete-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                lib.deleteCustomPreset?.(preset.id);
                              }}
                              title="Delete custom preset"
                              aria-label={`Delete preset ${preset.name}`}
                            >
                              <Icon name="Trash2" size={11} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            {/* Footer action: Save current size as preset */}
            {allFrames.length > 0 && (
              <div className="insp-preset-popover__footer">
                <button
                  type="button"
                  className="insp-preset-popover__save-btn"
                  aria-label="Save current size as preset"
                  onClick={handleSaveCurrentAsPreset}
                >
                  <Icon name="Plus" size={13} className="insp-preset-popover__save-icon" />
                  <span>Save current size as preset</span>
                </button>
              </div>
            )}
          </div>
        </FloatingPortal>
      )}
    </div>
  );
}
