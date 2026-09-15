/**
 * FramePresetDropdown — searchable, categorized preset switcher for frames.
 *
 * Displays the currently detected preset name (e.g. "iPhone 16 Pro", "Desktop",
 * or "Custom" if arbitrary dimensions). When opened, shows an instant search input
 * and categorized device dimensions in tabular layout, solving the long-scrolling
 * complaint common in Figma and Penpot.
 */

import type { FrameNode } from '@varve/scene';
import {
  BUILTIN_PRESET_GROUPS,
  findMatchingPreset,
  type Preset,
  type PresetGroup,
  physicalToPx,
} from '@varve/shared';
import { FloatingPortal, Icon, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { usePresetLibrary } from '../../../presetLibrary';

const FRAME_CATEGORY_ORDER: readonly PresetGroup['category'][] = [
  'mobile-tablet',
  'desktop',
  'watch',
  'presentation',
  'social',
  'video-motion',
  'icon-asset',
  'paper',
  'print',
];

interface FramePresetDropdownProps {
  frame: FrameNode;
}

export function FramePresetDropdown({ frame }: FramePresetDropdownProps) {
  const { applyFramePreset, platform } = useEditor();
  const lib = usePresetLibrary(platform);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  useEffect(() => {
    if (open) {
      searchInputRef.current?.focus();
    }
  }, [open]);

  // Detect if current frame width/height matches any known preset
  const matched = useMemo(() => {
    return findMatchingPreset(frame.w, frame.h);
  }, [frame.w, frame.h]);

  const activeLabel = useMemo(() => {
    if (!matched) return 'Custom';
    return matched.isLandscape ? `${matched.preset.name} (Landscape)` : matched.preset.name;
  }, [matched]);

  // Sort groups prioritizing screens/devices
  const groups = useMemo(() => {
    const list = [...BUILTIN_PRESET_GROUPS].sort((a, b) => {
      const idxA = FRAME_CATEGORY_ORDER.indexOf(a.category);
      const idxB = FRAME_CATEGORY_ORDER.indexOf(b.category);
      const rankA = idxA === -1 ? FRAME_CATEGORY_ORDER.length : idxA;
      const rankB = idxB === -1 ? FRAME_CATEGORY_ORDER.length : idxB;
      return rankA - rankB;
    });

    if (!query.trim()) return list;

    const q = query.toLowerCase();
    return list
      .map((g) => ({
        ...g,
        presets: g.presets.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.category.toLowerCase().includes(q) ||
            `${p.width}x${p.height}`.includes(q) ||
            `${p.width} x ${p.height}`.includes(q),
        ),
      }))
      .filter((g) => g.presets.length > 0);
  }, [query]);

  const handleSelect = useCallback(
    (preset: Preset) => {
      const w = Math.round(physicalToPx(preset.width, preset.unit));
      const h = Math.round(physicalToPx(preset.height, preset.unit));
      applyFramePreset({ name: preset.name, w, h });
      lib.recordRecent(preset.id);
      setOpen(false);
    },
    [applyFramePreset, lib],
  );

  return (
    <div className="insp-preset-dropdown-container">
      <Tooltip label="Frame size preset">
        <button
          ref={triggerRef}
          type="button"
          className="insp-preset-dropdown__trigger"
          onClick={() => setOpen((prev) => !prev)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          data-testid="frame-preset-dropdown-trigger"
        >
          <span className="insp-preset-dropdown__trigger-text">{activeLabel}</span>
          <Icon name="ChevronDown" size={12} className="insp-preset-dropdown__trigger-icon" />
        </button>
      </Tooltip>

      {open && (
        <FloatingPortal
          anchorRef={triggerRef}
          open={open}
          onClose={() => setOpen(false)}
          placement="bottom-start"
          maxHeight={380}
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
          >
            <div className="insp-preset-popover__search">
              <Icon name="Search" size={14} className="insp-preset-popover__search-icon" />
              <input
                ref={searchInputRef}
                type="text"
                className="insp-preset-popover__search-input"
                placeholder="Search frame presets..."
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

            <div className="insp-preset-popover__list" role="listbox">
              {groups.length === 0 ? (
                <p className="insp-preset-popover__empty">No presets matching "{query}"</p>
              ) : (
                groups.map((group) => (
                  <div key={group.category} className="insp-preset-group">
                    <div className="insp-preset-group__header">{group.label}</div>
                    {group.presets.map((preset) => {
                      const pw = Math.round(physicalToPx(preset.width, preset.unit));
                      const ph = Math.round(physicalToPx(preset.height, preset.unit));
                      const isSelected = matched?.preset.id === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          className={`insp-preset-item${isSelected ? ' insp-preset-item--selected' : ''}`}
                          onClick={() => handleSelect(preset)}
                        >
                          <span className="insp-preset-item__name">
                            {isSelected && (
                              <Icon
                                name="Check"
                                size={12}
                                className="insp-preset-item__check"
                                aria-hidden="true"
                              />
                            )}
                            {preset.name}
                          </span>
                          <span className="insp-preset-item__dims">
                            {pw} &times; {ph}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        </FloatingPortal>
      )}
    </div>
  );
}
