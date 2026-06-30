import { exportDocumentToSvg } from '@strata/codegen';
import { getTheme, setTheme } from '@strata/ui/tokens';
import type { Theme } from '@strata/ui/tokens';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type ToolId, useEditor } from './context';
import { formatShortcut, SHORTCUT_DEFS } from './shortcuts';

type MenuId = 'File' | 'Edit' | 'View' | 'Object' | 'Arrange' | 'Plugins' | 'Help';

interface MenuItem {
  label: string;
  shortcut?: string;
  action?: string;
}

const THEMES: { id: Theme; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'high-contrast', label: 'High Contrast' },
];

const MENUS: { id: MenuId; items: MenuItem[] }[] = [
  {
    id: 'File',
    items: [
      { label: 'New', shortcut: formatShortcut(SHORTCUT_DEFS.newDocument.binding), action: 'new' },
      { label: 'Open\u2026', shortcut: formatShortcut(SHORTCUT_DEFS.open.binding), action: 'open' },
      { label: 'Save', shortcut: formatShortcut(SHORTCUT_DEFS.save.binding), action: 'save' },
      {
        label: 'Save As\u2026',
        shortcut: formatShortcut(SHORTCUT_DEFS.saveAs.binding),
        action: 'saveAs',
      },
      {
        label: 'Export SVG\u2026',
        shortcut: formatShortcut(SHORTCUT_DEFS.exportSvg.binding),
        action: 'exportSvg',
      },
    ],
  },
  {
    id: 'Edit',
    items: [
      { label: 'Undo', shortcut: formatShortcut(SHORTCUT_DEFS.undo.binding), action: 'undo' },
      { label: 'Redo', shortcut: formatShortcut(SHORTCUT_DEFS.redo.binding), action: 'redo' },
      { label: 'Delete', shortcut: '\u232B', action: 'delete' },
    ],
  },
  {
    id: 'View',
    items: [
      ...THEMES.map((t) => ({
        label: t.label,
        action: `theme:${t.id}`,
      })),
      { label: '---' },
      {
        label: 'Zoom to 100%',
        shortcut: formatShortcut(SHORTCUT_DEFS.zoomReset.binding),
        action: 'zoomReset',
      },
      {
        label: 'Inspect Mode',
        shortcut: formatShortcut(SHORTCUT_DEFS.toolInspect.binding),
        action: 'inspectMode',
      },
      { label: 'Home', shortcut: '\u21E7\u2318H', action: 'home' },
    ],
  },
  {
    id: 'Object',
    items: [
      { label: 'Group', shortcut: formatShortcut(SHORTCUT_DEFS.group.binding), action: 'group' },
    ],
  },
  {
    id: 'Arrange',
    items: [{ label: 'Bring to Front', shortcut: '\u21E7\u2318]', action: 'bringFront' }],
  },
  { id: 'Plugins', items: [{ label: 'No plugins loaded', action: '' }] },
  { id: 'Help', items: [{ label: 'About Strata', action: 'about' }] },
];

export function Menubar({ onBackToHome }: { onBackToHome?: () => void }) {
  const { state, newDocument, serializeDocument, undo, redo, removeSelected, setTool, setZoom } =
    useEditor();
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [currentTheme, setCurrentTheme] = useState<Theme>(() => getTheme() ?? 'light');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('strata-theme') as Theme | null;
    if (saved && saved !== getTheme()) {
      setTheme(saved);
      setCurrentTheme(saved);
    }
  }, []);

  const handleAction = useCallback(
    (action: string) => {
      setOpenMenu(null);
      switch (action) {
        case 'new':
          if (confirm('Create a new document? Unsaved changes will be lost.')) newDocument();
          break;
        case 'save':
        case 'saveAs': {
          const json = serializeDocument();
          const blob = new Blob([json], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${state.document.name || 'untitled'}.strata.json`;
          a.click();
          URL.revokeObjectURL(url);
          break;
        }
        case 'open':
          document.querySelector<HTMLInputElement>('#file-open-input')?.click();
          break;
        case 'undo':
          undo();
          break;
        case 'redo':
          redo();
          break;
        case 'delete':
          removeSelected();
          break;
        case 'exportSvg': {
          const svg = exportDocumentToSvg(state.document);
          const blob = new Blob([svg], { type: 'image/svg+xml' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${state.document.name || 'untitled'}.svg`;
          a.click();
          URL.revokeObjectURL(url);
          break;
        }
        case 'zoomReset':
          setZoom(1);
          break;
        case 'inspectMode':
          setTool(state.tool === 'inspect' ? 'select' : ('inspect' as ToolId));
          break;
        case 'home':
          onBackToHome?.();
          break;
        default:
          if (action.startsWith('theme:')) {
            const theme = action.slice(6) as Theme;
            setTheme(theme);
            setCurrentTheme(theme);
            localStorage.setItem('strata-theme', theme);
          }
          break;
      }
    },
    [newDocument, serializeDocument, undo, redo, removeSelected, setTool, setZoom, state, onBackToHome],
  );

  const isActiveTheme = (item: MenuItem) =>
    item.action?.startsWith('theme:') && currentTheme === item.action.slice(6);

  return (
    <div
      className="editor-menubar"
      role="menubar"
      aria-label="Application"
      ref={menuRef}
      onMouseLeave={() => setOpenMenu(null)}
    >
      {MENUS.map((menu) => (
        <div key={menu.id} style={{ position: 'relative' }}>
          <button
            role="menuitem"
            className="editor-menubar__item"
            aria-haspopup="true"
            aria-expanded={openMenu === menu.id}
            tabIndex={0}
            type="button"
            onClick={() => setOpenMenu(openMenu === menu.id ? null : menu.id)}
            onMouseEnter={() => openMenu && setOpenMenu(menu.id)}
          >
            {menu.id}
          </button>
          {openMenu === menu.id && (
            <div
              role="menu"
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                zIndex: 100,
                background: 'var(--color-surface-raised)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-sm)',
                minWidth: 180,
                padding: 'var(--space-1)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              }}
            >
              {menu.items.map((item) =>
                item.label === '---' ? (
                  <hr
                    key="sep"
                    role="separator"
                    style={{
                      margin: 'var(--space-1) 0',
                      border: 'none',
                      borderTop: '1px solid var(--color-border-subtle)',
                    }}
                  />
                ) : (
                  <button
                    key={item.label}
                    role="menuitem"
                    type="button"
                    disabled={!item.action}
                    onClick={() => handleAction(item.action ?? '')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      width: '100%',
                      padding: 'var(--space-1) var(--space-2)',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      background: isActiveTheme(item)
                        ? 'var(--color-interactive-default)'
                        : 'none',
                      color: item.action ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                      cursor: 'default',
                      font: 'inherit',
                      fontSize: 'var(--font-size-sm)',
                      textAlign: 'left',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        'var(--color-interactive-default)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = isActiveTheme(item)
                        ? 'var(--color-interactive-default)'
                        : 'none';
                    }}
                  >
                    <span style={{ flex: 1 }}>{item.label}</span>
                    {item.shortcut && (
                      <span
                        style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}
                      >
                        {item.shortcut}
                      </span>
                    )}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
