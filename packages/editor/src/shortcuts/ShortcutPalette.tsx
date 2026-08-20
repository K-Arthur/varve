import { FocusTrap, Icon, SOLID_CHROME_ICONS, SolidIcon, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getActionRegistry } from '../actions/ActionRegistry';
import { getRegisteredTools, type ToolId } from '../tools/toolRegistry';
import { useEffectiveWorkspaceConfig } from '../workspace/useWorkspaceConfig';
import { getToolbarToolIds, type WorkspaceMode } from '../workspace/workspaceTypes';
import {
  captureKeyCombo,
  clearAllOverrides,
  clearOverride,
  exportKeymap,
  formatShortcut,
  getEffectiveBinding,
  getOverrides,
  importKeymap,
  SHORTCUT_DEFS,
  setOverride,
} from './ShortcutManager';
import type { ShortcutDef } from './types';
import { useShortcutUsage } from './useShortcutUsage';
import './ShortcutPalette.css';

/** Entries are items whose shortcut ID corresponds to a menu item with workspace
 *  filtering. The value is the set of workspace modes where the item is visible. */
const SHORTCUT_WORKSPACE_TAGS: Record<string, string[]> = {
  textBold: ['design', 'print', 'drawing', 'image', 'motion'],
  textItalic: ['design', 'print', 'drawing', 'image', 'motion'],
  textUnderline: ['design', 'print', 'drawing', 'image', 'motion'],
  textIncreaseSize: ['design', 'print', 'drawing', 'image', 'motion'],
  textDecreaseSize: ['design', 'print', 'drawing', 'image', 'motion'],
  textToOutlines: ['design', 'print', 'drawing'],
  toggleTimelinePanel: ['design', 'motion'],
  toggleGraphEditor: ['design', 'motion'],
  toggleStateMachinePanel: ['design', 'motion'],
};

interface ShortcutPaletteProps {
  open: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  /** Current workspace mode for tag display. */
  workspaceMode?: WorkspaceMode;
  /** When set, auto-filters to this shortcut on open. */
  focusShortcutId?: string;
}

export function ShortcutPalette({
  open,
  onClose,
  onSelect,
  workspaceMode,
  focusShortcutId,
}: ShortcutPaletteProps) {
  const [query, setQuery] = useState('');
  const [remappingId, setRemappingId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  // Element focused before the palette opened; restored on close.
  const restoreRef = useRef<HTMLElement | null>(null);
  const effectiveConfig = useEffectiveWorkspaceConfig(workspaceMode ?? 'design');
  const hiddenToolShortcutIds = useMemo(() => {
    const visible = new Set(getToolbarToolIds(effectiveConfig.toolbar));
    return new Set(
      getRegisteredTools()
        .filter((definition) => definition.shortcutId && !visible.has(definition.id as ToolId))
        .map((definition) => definition.shortcutId as string),
    );
  }, [effectiveConfig]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }, []);

  const all = useMemo(
    () =>
      Object.entries(SHORTCUT_DEFS).map(([id, def]) => ({
        id,
        def: { ...def, id } as ShortcutDef,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reloadKey],
  );

  const grouped = useMemo(() => {
    const groups: Record<string, typeof all> = {};
    for (const item of all) {
      const g = item.def.category || 'Other';
      if (!groups[g]) groups[g] = [];
      groups[g]?.push(item);
    }
    return groups;
  }, [all]);

  const filtered = useMemo(() => {
    if (!query) return grouped;
    const q = query.toLowerCase();
    const result: Record<string, typeof all> = {};
    for (const [group, items] of Object.entries(grouped)) {
      const matching = items.filter(({ id, def }) => {
        const binding = getEffectiveBinding(id);
        const combo = binding?.key ? formatShortcut(binding).toLowerCase() : '';
        return (
          def.label.toLowerCase().includes(q) ||
          group.toLowerCase().includes(q) ||
          combo.includes(q)
        );
      });
      if (matching.length > 0) {
        result[group] = matching;
      }
    }
    return result;
  }, [grouped, query]);

  useEffect(() => {
    if (open) {
      const prior = document.activeElement;
      if (prior instanceof HTMLElement && prior !== document.body) {
        restoreRef.current = prior;
      }
      setRemappingId(null);
      setReloadKey((k) => k + 1);
      if (focusShortcutId) {
        const def = SHORTCUT_DEFS[focusShortcutId as keyof typeof SHORTCUT_DEFS];
        setQuery(def?.label ?? focusShortcutId);
      } else {
        setQuery('');
      }
      setTimeout(() => inputRef.current?.focus(), 0);
    } else if (restoreRef.current) {
      // Restore focus to the invoking control on every close path (Escape,
      // selection, outside click, unmount) — unless the user deliberately
      // moved focus elsewhere (e.g. clicked a toolbar button).
      const active = document.activeElement;
      if (active === document.body || paletteRef.current?.contains(active)) {
        restoreRef.current.focus({ preventScroll: true });
      }
      restoreRef.current = null;
    }
  }, [open, focusShortcutId]);

  const handleExport = useCallback(() => {
    const data = exportKeymap();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'strata-keymap.json';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string);
          const count = importKeymap(data);
          showToast(`Imported ${count} shortcut${count === 1 ? '' : 's'}`);
          setReloadKey((k) => k + 1);
        } catch {
          showToast('Invalid keymap file');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [showToast],
  );

  const handleResetAll = useCallback(() => {
    clearAllOverrides();
    showToast('All shortcuts reset to defaults');
    setReloadKey((k) => k + 1);
  }, [showToast]);

  const handleResetOne = useCallback(
    (id: string) => {
      clearOverride(id);
      showToast('Shortcut reset to default');
      setReloadKey((k) => k + 1);
    },
    [showToast],
  );

  const handleRemapClick = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRemappingId(id);
  }, []);

  const handleRowClick = useCallback(
    (id: string) => {
      if (remappingId) return;
      getActionRegistry().recordUsage(id);
      onSelect(id);
      onClose();
    },
    [onClose, onSelect, remappingId],
  );

  const allActionIds = useMemo(() => Object.keys(SHORTCUT_DEFS), []);
  const usage = useShortcutUsage(allActionIds);
  // Flat list of visible option ids in render order (for roving highlight).
  const visibleIds = useMemo(() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const [, items] of Object.entries(filtered)) {
      for (const { id } of items) {
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    }
    if (query === '') {
      for (const id of usage.neverUsed.slice(0, 20)) {
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    }
    return ids;
  }, [filtered, query, usage.neverUsed]);

  // Roving highlight: reset to the first visible option when the filtered
  // set changes or the palette opens.
  useEffect(() => {
    setHighlightId(visibleIds[0] ?? null);
  }, [visibleIds]);

  const scrollHighlightIntoView = useCallback(() => {
    if (!highlightId) return;
    const el = paletteRef.current?.querySelector<HTMLElement>(
      `[id="palette-option-${highlightId}"]`,
    );
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [highlightId]);

  const moveHighlight = useCallback(
    (dir: 1 | -1) => {
      if (visibleIds.length === 0) return;
      setHighlightId((current) => {
        const idx = visibleIds.indexOf(current ?? '');
        const base = idx < 0 ? 0 : idx;
        const next = (base + dir + visibleIds.length) % visibleIds.length;
        return visibleIds[next] ?? null;
      });
      scrollHighlightIntoView();
    },
    [visibleIds, scrollHighlightIntoView],
  );

  const handleKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (remappingId) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setRemappingId(null);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const binding = captureKeyCombo(e.nativeEvent);
        if (binding?.key) {
          clearOverride(remappingId);
          setOverride(remappingId, binding);
          setRemappingId(null);
          showToast(`Remapped to ${formatShortcut(binding)}`);
          setReloadKey((k) => k + 1);
        }
        return;
      }

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          return;
        case 'ArrowDown':
          e.preventDefault();
          moveHighlight(1);
          return;
        case 'ArrowUp':
          e.preventDefault();
          moveHighlight(-1);
          return;
        case 'Home':
          e.preventDefault();
          setHighlightId(visibleIds[0] ?? null);
          return;
        case 'End':
          e.preventDefault();
          setHighlightId(visibleIds[visibleIds.length - 1] ?? null);
          return;
        case 'Enter': {
          if (e.altKey) break;
          const targetId = highlightId ?? visibleIds[0];
          if (targetId) {
            e.preventDefault();
            getActionRegistry().recordUsage(targetId);
            onSelect(targetId);
            onClose();
          }
          return;
        }
      }

      // Alt+Enter: remap the highlighted shortcut; Alt+Backspace: reset it.
      if (e.altKey && e.key === 'Enter') {
        const targetId = highlightId ?? visibleIds[0];
        if (targetId) {
          e.preventDefault();
          setRemappingId(targetId);
        }
      } else if (e.altKey && e.key === 'Backspace') {
        const targetId = highlightId ?? visibleIds[0];
        if (targetId) {
          e.preventDefault();
          handleResetOne(targetId);
        }
      }
    },
    [
      filtered,
      onClose,
      onSelect,
      remappingId,
      showToast,
      visibleIds,
      highlightId,
      moveHighlight,
      handleResetOne,
    ],
  );

  if (!open) return null;

  const hasOverrides = Object.keys(getOverrides()).length > 0;
  const groupEntries = Object.entries(filtered);

  return createPortal(
    <FocusTrap active initialFocus=".shortcut-palette__search">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="shortcut-palette"
        onClick={(e) => {
          if (e.target === e.currentTarget && !remappingId) onClose();
        }}
        onKeyDown={handleKey}
        ref={paletteRef}
      >
        <div className="shortcut-palette__panel">
          <div className="shortcut-palette__toolbar">
            <input
              ref={inputRef}
              type="text"
              className="shortcut-palette__search"
              placeholder="Search commands\u2026"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search commands"
              role="combobox"
              aria-expanded="true"
              aria-autocomplete="list"
              aria-controls="shortcut-palette-listbox"
              aria-activedescendant={highlightId ? `palette-option-${highlightId}` : undefined}
            />
            <Tooltip label="Export keymap">
              <button
                type="button"
                className="shortcut-palette__btn"
                onClick={handleExport}
                aria-label="Export keymap"
              >
                <SolidIcon name={SOLID_CHROME_ICONS.download} />
              </button>
            </Tooltip>
            <Tooltip label="Import keymap">
              <button
                type="button"
                className="shortcut-palette__btn"
                onClick={() => fileRef.current?.click()}
                aria-label="Import keymap"
              >
                <SolidIcon name={SOLID_CHROME_ICONS.upload} />
              </button>
            </Tooltip>
            {hasOverrides && (
              <Tooltip label="Reset all to defaults">
                <button
                  type="button"
                  className="shortcut-palette__btn"
                  onClick={handleResetAll}
                  aria-label="Reset all to defaults"
                >
                  <SolidIcon name={SOLID_CHROME_ICONS.rotateCcw} />
                </button>
              </Tooltip>
            )}
            <input ref={fileRef} type="file" accept=".json" hidden onChange={handleImport} />
          </div>

          {toast && (
            <div className="shortcut-palette__toast" role="status" aria-live="polite">
              {toast}
            </div>
          )}

          {remappingId && (
            <div className="shortcut-palette__remap-hint">
              Press new shortcut for &quot;
              {SHORTCUT_DEFS[remappingId as keyof typeof SHORTCUT_DEFS]?.label ?? remappingId}&quot;
              (Esc to cancel)
            </div>
          )}

          <div
            className="shortcut-palette__list"
            id="shortcut-palette-listbox"
            role="listbox"
            aria-label="Commands"
          >
            {groupEntries.length === 0 && (
              <div className="shortcut-palette__empty">No commands match</div>
            )}
            {groupEntries.map(([group, items]) => (
              <div key={group}>
                <div className="shortcut-palette__group-header">{group}</div>
                {items.map(({ id, def }) => {
                  const isRemapping = remappingId === id;
                  const binding = getEffectiveBinding(id);
                  const usageInfo = usage.usages.get(id);
                  const useCount = usageInfo?.count ?? 0;
                  const hiddenFromToolbar = hiddenToolShortcutIds.has(id);

                  return (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: pointer click on a row is the mouse-path duplicate of Enter; both call handleRowClick(id).
                    // biome-ignore lint/a11y/useFocusableInteractive: option rows are not tab stops by design — keyboard interaction is handled by the combobox input via aria-activedescendant (WAI-ARIA listbox pattern); Enter lives in handleKey.
                    <div
                      key={id}
                      id={`palette-option-${id}`}
                      role="option"
                      aria-selected={highlightId === id}
                      aria-label={`${def.label}${hiddenFromToolbar ? ', hidden from current toolbar' : ''}`}
                      className={`shortcut-palette__row${isRemapping ? ' shortcut-palette__row--remapping' : ''}${highlightId === id ? ' shortcut-palette__row--highlighted' : ''}`}
                      onMouseEnter={() => setHighlightId(id)}
                      onClick={() => handleRowClick(id)}
                    >
                      <span className="shortcut-palette__row-label">
                        {def.label}
                        {hiddenFromToolbar && (
                          <span className="shortcut-palette__workspace-tag">
                            Hidden from toolbar
                          </span>
                        )}
                        {workspaceMode &&
                          SHORTCUT_WORKSPACE_TAGS[id] &&
                          !SHORTCUT_WORKSPACE_TAGS[id].includes(workspaceMode) && (
                            <span className="shortcut-palette__workspace-tag">
                              {SHORTCUT_WORKSPACE_TAGS[id]
                                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                                .join(', ')}
                            </span>
                          )}
                      </span>
                      <Tooltip label={`Used ${useCount} times`}>
                        <span className="shortcut-palette__usage">
                          {useCount > 0 ? `${useCount}x` : 'Not used'}
                        </span>
                      </Tooltip>
                      {isRemapping ? (
                        <span className="shortcut-palette__combo shortcut-palette__combo--active">
                          Press key…
                        </span>
                      ) : (
                        <span className="shortcut-palette__combo">
                          {binding?.key ? formatShortcut(binding) : '—'}
                        </span>
                      )}
                      <Tooltip label="Remap shortcut">
                        <button
                          type="button"
                          className="shortcut-palette__btn"
                          onClick={(e) => handleRemapClick(id, e)}
                          aria-label="Remap shortcut"
                          aria-keyshortcuts="Alt+Enter"
                          tabIndex={-1}
                        >
                          <Icon name="Keyboard" />
                        </button>
                      </Tooltip>
                      <Tooltip
                        label="Reset to default"
                        disabledReason={
                          isRemapping ? 'Wait until the current remap completes' : undefined
                        }
                      >
                        <button
                          type="button"
                          className="shortcut-palette__btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleResetOne(id);
                          }}
                          aria-label="Reset to default"
                          aria-keyshortcuts="Alt+Backspace"
                          tabIndex={-1}
                        >
                          <SolidIcon name={SOLID_CHROME_ICONS.rotateCcw} />
                        </button>
                      </Tooltip>
                    </div>
                  );
                })}
              </div>
            ))}

            {query === '' && usage.neverUsed.length > 0 && (
              <div className="shortcut-palette__not-used">
                <details>
                  <summary className="shortcut-palette__group-header">
                    Not used ({usage.neverUsed.length})
                  </summary>
                  {usage.neverUsed.slice(0, 20).map((id) => {
                    const def = SHORTCUT_DEFS[id as keyof typeof SHORTCUT_DEFS];
                    const binding = getEffectiveBinding(id);
                    return (
                      // biome-ignore lint/a11y/useKeyWithClickEvents: pointer click on a row is the mouse-path duplicate of Enter; both call handleRowClick(id).
                      // biome-ignore lint/a11y/useFocusableInteractive: option rows are not tab stops by design — keyboard interaction is handled by the combobox input via aria-activedescendant (WAI-ARIA listbox pattern); Enter lives in handleKey.
                      <div
                        key={`unused-${id}`}
                        role="option"
                        aria-selected={false}
                        className="shortcut-palette__row shortcut-palette__row--unused"
                        onClick={() => handleRowClick(id)}
                      >
                        <span className="shortcut-palette__row-label">
                          {def?.label ?? id}
                          {hiddenToolShortcutIds.has(id) && (
                            <span className="shortcut-palette__workspace-tag">
                              Hidden from toolbar
                            </span>
                          )}
                        </span>
                        <span className="shortcut-palette__usage">Not used</span>
                        <span className="shortcut-palette__combo">
                          {binding?.key ? formatShortcut(binding) : '—'}
                        </span>
                      </div>
                    );
                  })}
                  {usage.neverUsed.length > 20 && (
                    <div className="shortcut-palette__more">
                      +{usage.neverUsed.length - 20} more
                    </div>
                  )}
                </details>
              </div>
            )}
          </div>
        </div>
      </div>
    </FocusTrap>,
    document.body,
  );
}
