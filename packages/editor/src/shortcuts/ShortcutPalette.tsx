import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatShortcut, SHORTCUT_DEFS } from './ShortcutManager';
import type { ShortcutDef } from './types';

interface ShortcutPaletteProps {
  open: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
}

export function ShortcutPalette({ open, onClose, onSelect }: ShortcutPaletteProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const all = useMemo(() => Object.entries(SHORTCUT_DEFS).map(([id, def]) => ({ id, def })), []);

  const filtered = useMemo(() => {
    if (!query) return all;
    const q = query.toLowerCase();
    return all.filter(
      ({ def }) => def.label.toLowerCase().includes(q) || def.category.toLowerCase().includes(q),
    );
  }, [all, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const handleKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
      if (e.key === 'Enter' && filtered.length > 0) {
        e.preventDefault();
        const first = filtered[0];
        if (first) {
          onSelect(first.id);
          onClose();
        }
      }
    },
    [filtered, onClose, onSelect],
  );

  if (!open) return null;

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
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        style={{
          width: 380,
          maxHeight: 300,
          background: 'var(--color-surface-raised)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <input
          ref={inputRef}
          type="text"
          placeholder="Search commands\u2026"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKey}
          aria-label="Search commands"
          style={{
            padding: 'var(--space-2)',
            border: 'none',
            borderBottom: '1px solid var(--color-border-subtle)',
            background: 'var(--color-surface-sunken)',
            color: 'var(--color-text-primary)',
            font: 'inherit',
            fontSize: 'var(--font-size-sm)',
            outline: 'none',
          }}
        />
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {filtered.length === 0 && (
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
          {filtered.map(({ id, def }: { id: string; def: ShortcutDef }) => (
            <button
              key={id}
              type="button"
              style={{
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
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background =
                  'var(--color-interactive-default)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'none';
              }}
              onClick={() => {
                onSelect(id);
                onClose();
              }}
            >
              <span style={{ flex: 1 }}>{def.label}</span>
              <span
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--color-text-muted)',
                }}
              >
                {formatShortcut(def.binding)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
