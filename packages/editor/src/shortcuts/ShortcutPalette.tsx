import { CHROME_ICONS, Icon } from '@strata/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

interface ShortcutPaletteProps {
  open: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
}

export function ShortcutPalette({ open, onClose, onSelect }: ShortcutPaletteProps) {
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
      setQuery('');
      setRemappingId(null);
      setReloadKey((k) => k + 1);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

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
      onSelect(id);
      onClose();
    },
    [onClose, onSelect, remappingId],
  );

  if (!open) return null;

  const hasOverrides = Object.keys(getOverrides()).length > 0;

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    padding: 'var(--space-1) var(--space-2)',
    border: 'none',
    borderRadius: 0,
    background: 'none',
    color: 'var(--color-text-primary)',
    font: 'inherit',
    fontSize: 'var(--font-size-sm)',
    textAlign: 'left',
    cursor: 'pointer',
    gap: 'var(--space-1)',
  };

  const comboStyle: React.CSSProperties = {
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color-text-muted)',
    background: 'var(--color-surface-sunken)',
    padding: '1px 6px',
    borderRadius: 'var(--radius-sm)',
    fontFamily: 'var(--font-mono, monospace)',
    whiteSpace: 'nowrap',
  };

  const btnStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    background: 'none',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
  };

  const sectionHeaderStyle: React.CSSProperties = {
    padding: 'var(--space-1) var(--space-2)',
    fontSize: 'var(--font-size-xs)',
    fontWeight: 600,
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    background: 'var(--color-surface-sunken)',
    borderBottom: '1px solid var(--color-border-subtle)',
  };

  const groupEntries = Object.entries(filtered);

  return (
    <div
      role="dialog"
      aria-label="Command palette"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        justifyContent: 'center',
        paddingTop: '10vh',
        background: 'rgba(0,0,0,0.3)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !remappingId) onClose();
      }}
      onKeyDown={handleKey}
      ref={paletteRef}
    >
      <div
        style={{
          width: 420,
          maxHeight: 400,
          background: 'var(--color-surface-raised)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* ── Top bar: Search + actions ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            padding: 'var(--space-1)',
            borderBottom: '1px solid var(--color-border-subtle)',
            background: 'var(--color-surface-sunken)',
          }}
        >
          <input
            ref={inputRef}
            type="text"
            placeholder="Search commands\u2026"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search commands"
            disabled={!!remappingId}
            style={{
              flex: 1,
              padding: 'var(--space-1) var(--space-2)',
              border: 'none',
              background: 'transparent',
              color: 'var(--color-text-primary)',
              font: 'inherit',
              fontSize: 'var(--font-size-sm)',
              outline: 'none',
            }}
          />
          <button type="button" style={btnStyle} onClick={handleExport} title="Export keymap">
            <Icon name={CHROME_ICONS.download} />
          </button>
          <button
            type="button"
            style={btnStyle}
            onClick={() => fileRef.current?.click()}
            title="Import keymap"
          >
            <Icon name={CHROME_ICONS.upload} />
          </button>
          {hasOverrides && (
            <button
              type="button"
              style={btnStyle}
              onClick={handleResetAll}
              title="Reset all to defaults"
            >
              <Icon name={CHROME_ICONS.rotateCcw} />
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={handleImport}
          />
        </div>

        {/* ── Toast ── */}
        {toast && (
          <div
            style={{
              padding: 'var(--space-1) var(--space-2)',
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-primary)',
              background: 'var(--color-accent-subtle, var(--color-interactive-default))',
              borderBottom: '1px solid var(--color-border-subtle)',
            }}
            role="status"
            aria-live="polite"
          >
            {toast}
          </div>
        )}

        {/* ── Remap capture indicator ── */}
        {remappingId && (
          <div
            style={{
              padding: 'var(--space-1) var(--space-2)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-accent)',
              background: 'var(--color-accent-subtle, var(--color-interactive-default))',
              borderBottom: '1px solid var(--color-border-subtle)',
            }}
          >
            Press new shortcut for &quot;
            {SHORTCUT_DEFS[remappingId as keyof typeof SHORTCUT_DEFS]?.label ?? remappingId}&quot;
            (Esc to cancel)
          </div>
        )}

        {/* ── Shortcut list ── */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {groupEntries.length === 0 && (
            <div
              style={{
                padding: 'var(--space-3)',
                color: 'var(--color-text-muted)',
                fontSize: 'var(--font-size-sm)',
                textAlign: 'center',
              }}
            >
              No commands match
            </div>
          )}
          {groupEntries.map(([group, items]) => (
            <div key={group}>
              <div style={sectionHeaderStyle}>{group}</div>
              {items.map(({ id, def }) => {
                const isRemapping = remappingId === id;
                const binding = getEffectiveBinding(id);

                return (
                  <div
                    key={id}
                    role="option"
                    aria-selected={false}
                    style={{
                      ...rowStyle,
                      background: isRemapping
                        ? 'var(--color-accent-subtle, var(--color-interactive-default))'
                        : undefined,
                    }}
                    onMouseEnter={(e) => {
                      if (!isRemapping)
                        (e.currentTarget as HTMLElement).style.background =
                          'var(--color-interactive-default)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isRemapping) (e.currentTarget as HTMLElement).style.background = 'none';
                    }}
                    onClick={() => handleRowClick(id)}
                  >
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {def.label}
                    </span>
                    {isRemapping ? (
                      <span
                        style={{
                          ...comboStyle,
                          color: 'var(--color-accent)',
                          background: 'transparent',
                        }}
                      >
                        Press key\u2026
                      </span>
                    ) : (
                      <span style={comboStyle}>
                        {binding?.key ? formatShortcut(binding) : '\u2014'}
                      </span>
                    )}
                    <button
                      type="button"
                      style={btnStyle}
                      onClick={(e) => handleRemapClick(id, e)}
                      title="Remap shortcut"
                      disabled={isRemapping}
                    >
                      <Icon name="Keyboard" />
                    </button>
                    <button
                      type="button"
                      style={btnStyle}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleResetOne(id);
                      }}
                      title="Reset to default"
                      disabled={isRemapping}
                    >
                      <Icon name={CHROME_ICONS.rotateCcw} />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
