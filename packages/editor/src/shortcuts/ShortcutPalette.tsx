import { Icon, SOLID_CHROME_ICONS, SolidIcon } from '@strata/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getActionRegistry } from '../actions/ActionRegistry';
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
  workspaceMode?: string;
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
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);

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
      setRemappingId(null);
      setReloadKey((k) => k + 1);
      if (focusShortcutId) {
        const def = SHORTCUT_DEFS[focusShortcutId as keyof typeof SHORTCUT_DEFS];
        setQuery(def?.label ?? focusShortcutId);
      } else {
        setQuery('');
      }
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, focusShortcutId]);

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

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
      if (e.key === 'Enter' && !remappingId && Object.keys(filtered).length > 0) {
        const firstGroup = Object.values(filtered)[0];
        const first = firstGroup?.[0];
        if (first) {
          onSelect(first.id);
          onClose();
        }
      }
    },
    [filtered, onClose, onSelect, remappingId, showToast],
  );

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

  if (!open) return null;

  const hasOverrides = Object.keys(getOverrides()).length > 0;
  const groupEntries = Object.entries(filtered);

  return createPortal(
    <div
      role="dialog"
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
            disabled={!!remappingId}
          />
          <button
            type="button"
            className="shortcut-palette__btn"
            onClick={handleExport}
            title="Export keymap"
          >
            <SolidIcon name={SOLID_CHROME_ICONS.download} />
          </button>
          <button
            type="button"
            className="shortcut-palette__btn"
            onClick={() => fileRef.current?.click()}
            title="Import keymap"
          >
            <SolidIcon name={SOLID_CHROME_ICONS.upload} />
          </button>
          {hasOverrides && (
            <button
              type="button"
              className="shortcut-palette__btn"
              onClick={handleResetAll}
              title="Reset all to defaults"
            >
              <SolidIcon name={SOLID_CHROME_ICONS.rotateCcw} />
            </button>
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

        <div className="shortcut-palette__list">
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

                return (
                  <div
                    key={id}
                    role="option"
                    aria-selected={false}
                    tabIndex={0}
                    className={`shortcut-palette__row${isRemapping ? ' shortcut-palette__row--remapping' : ''}`}
                    onClick={() => handleRowClick(id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleRowClick(id);
                      }
                    }}
                  >
                    <span className="shortcut-palette__row-label">
                      {def.label}
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
                    <span className="shortcut-palette__usage" title={`Used ${useCount} times`}>
                      {useCount > 0 ? `${useCount}x` : 'Not used'}
                    </span>
                    {isRemapping ? (
                      <span className="shortcut-palette__combo shortcut-palette__combo--active">
                        Press key…
                      </span>
                    ) : (
                      <span className="shortcut-palette__combo">
                        {binding?.key ? formatShortcut(binding) : '—'}
                      </span>
                    )}
                    <button
                      type="button"
                      className="shortcut-palette__btn"
                      onClick={(e) => handleRemapClick(id, e)}
                      title="Remap shortcut"
                      disabled={isRemapping}
                    >
                      <Icon name="Keyboard" />
                    </button>
                    <button
                      type="button"
                      className="shortcut-palette__btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleResetOne(id);
                      }}
                      title="Reset to default"
                      disabled={isRemapping}
                    >
                      <SolidIcon name={SOLID_CHROME_ICONS.rotateCcw} />
                    </button>
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
                    <div
                      key={id}
                      role="option"
                      aria-selected={false}
                      tabIndex={0}
                      className="shortcut-palette__row shortcut-palette__row--unused"
                      onClick={() => handleRowClick(id)}
                    >
                      <span className="shortcut-palette__row-label">{def?.label ?? id}</span>
                      <span className="shortcut-palette__usage">Not used</span>
                      <span className="shortcut-palette__combo">
                        {binding?.key ? formatShortcut(binding) : '—'}
                      </span>
                    </div>
                  );
                })}
                {usage.neverUsed.length > 20 && (
                  <div className="shortcut-palette__more">+{usage.neverUsed.length - 20} more</div>
                )}
              </details>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
