import { exportDocumentToSvg } from '@strata/codegen';
import { CHROME_ICONS, IconButton, StrataLogo } from '@strata/ui';
import type { Theme } from '@strata/ui/tokens';
import { getTheme, setTheme } from '@strata/ui/tokens';
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
      {
        label: 'Import\u2026',
        shortcut: '\u2318I',
        action: 'import',
      },
      {
        label: 'Export\u2026',
        shortcut: formatShortcut(SHORTCUT_DEFS.export.binding),
        action: 'export',
      },
      { label: '---' },
      {
        label: 'Present\u2026',
        shortcut: '\u21E7\u2318P',
        action: 'present',
      },
      { label: '---' },
      {
        label: 'Settings\u2026',
        shortcut: formatShortcut(SHORTCUT_DEFS.settings.binding),
        action: 'settings',
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
      { label: '---' },
      {
        label: 'Keyboard Shortcuts',
        shortcut: formatShortcut(SHORTCUT_DEFS.shortcutPalette.binding),
        action: 'shortcutPalette',
      },
      {
        label: 'Toggle Snap',
        shortcut: formatShortcut(SHORTCUT_DEFS.toggleSnap.binding),
        action: 'toggleSnap',
      },
      {
        label: 'Soft Proofing',
        shortcut: formatShortcut(SHORTCUT_DEFS.softProof.binding),
        action: 'softProof',
      },
      { label: '---' },
      {
        label: 'Clear All Guides',
        action: 'clearGuides',
      },
      { label: '---' },
      {
        label: 'Outline Mode',
        shortcut: formatShortcut(SHORTCUT_DEFS.canvasModeOutline.binding),
        action: 'canvasModeOutline',
      },
      {
        label: 'Preview Mode',
        shortcut: formatShortcut(SHORTCUT_DEFS.canvasModePreview.binding),
        action: 'canvasModePreview',
      },
      { label: '---' },
      {
        label: 'Home',
        shortcut: formatShortcut(SHORTCUT_DEFS.home.binding),
        action: 'home',
      },
    ],
  },
  {
    id: 'Object',
    items: [
      { label: 'Group', shortcut: formatShortcut(SHORTCUT_DEFS.group.binding), action: 'group' },
      {
        label: 'Ungroup',
        shortcut: formatShortcut(SHORTCUT_DEFS.ungroup.binding),
        action: 'ungroup',
      },
      { label: '---' },
      {
        label: 'Union',
        shortcut: formatShortcut(SHORTCUT_DEFS.booleanUnion.binding),
        action: 'booleanUnion',
      },
      {
        label: 'Subtract',
        shortcut: formatShortcut(SHORTCUT_DEFS.booleanSubtract.binding),
        action: 'booleanSubtract',
      },
      {
        label: 'Intersect',
        shortcut: formatShortcut(SHORTCUT_DEFS.booleanIntersect.binding),
        action: 'booleanIntersect',
      },
      {
        label: 'Exclude',
        shortcut: formatShortcut(SHORTCUT_DEFS.booleanExclude.binding),
        action: 'booleanExclude',
      },
    ],
  },
  {
    id: 'Arrange',
    items: [
      {
        label: 'Bring to Front',
        shortcut: formatShortcut(SHORTCUT_DEFS.bringFront.binding),
        action: 'bringFront',
      },
      {
        label: 'Bring Forward',
        shortcut: formatShortcut(SHORTCUT_DEFS.bringForward.binding),
        action: 'bringForward',
      },
      {
        label: 'Send Backward',
        shortcut: formatShortcut(SHORTCUT_DEFS.sendBackward.binding),
        action: 'sendBackward',
      },
      {
        label: 'Send to Back',
        shortcut: formatShortcut(SHORTCUT_DEFS.sendBack.binding),
        action: 'sendBack',
      },
    ],
  },
  { id: 'Plugins', items: [{ label: 'No plugins loaded', action: '' }] },
  {
    id: 'Help',
    items: [
      { label: 'Take a tour', action: 'startTour' },
      { label: '---' },
      { label: 'About Strata', action: 'about' },
    ],
  },
];

function itemRole(item: MenuItem): string {
  if (item.action?.startsWith('theme:')) return 'menuitemradio';
  if (item.action?.startsWith('canvasMode')) return 'menuitemcheckbox';
  return 'menuitem';
}

export function Menubar({
  onBackToHome,
  onOpenSettings,
  onStartTour,
  onOpenPalette,
}: {
  onBackToHome?: () => void;
  onOpenSettings?: () => void;
  onStartTour?: () => void;
  onOpenPalette?: () => void;
}) {
  const {
    state,
    newDocument,
    serializeDocument,
    loadDocument,
    undo,
    redo,
    removeSelected,
    setTool,
    setZoom,
    setShowExportDialog,
    groupSelected,
    ungroupSelected,
    arrangeSelected,
    setSnapEnabled,
    setSoftProofEnabled,
    setCanvasMode,
    booleanOp,
    startPresentation,
    clearAllGuides,
    save,
    saveAs,
  } = useEditor();
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [currentTheme, setCurrentTheme] = useState<Theme>(() => getTheme() ?? 'light');
  const menuRef = useRef<HTMLDivElement>(null);
  const topLevelRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('strata-theme') as Theme | null;
    if (saved && saved !== getTheme()) {
      setTheme(saved);
      setCurrentTheme(saved);
    }
  }, []);

  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [editingName]);

  // Focus the active menu item when dropdown opens or index changes
  useEffect(() => {
    if (openMenu) {
      const menu = menuRef.current?.querySelector<HTMLDivElement>('[role="menu"]');
      if (!menu) return;
      const items = menu.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]',
      );
      const el = items[activeItemIndex];
      if (el) {
        el.focus();
        el.style.background = 'var(--color-interactive-default)';
      }
      return () => {
        // Reset hover styles on cleanup
        items.forEach((btn) => {
          btn.style.background = '';
        });
      };
    }
  }, [openMenu, activeItemIndex]);

  const startNameEdit = useCallback(() => {
    setNameDraft(state.document.name || '');
    setEditingName(true);
  }, [state.document.name]);

  const commitName = useCallback(() => {
    setEditingName(false);
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== state.document.name) {
      const json = serializeDocument();
      const doc = JSON.parse(json);
      doc.name = trimmed;
      loadDocument(JSON.stringify(doc), { name: trimmed });
    }
  }, [nameDraft, state.document.name, serializeDocument, loadDocument]);

  const handleAction = useCallback(
    (action: string) => {
      setOpenMenu(null);
      switch (action) {
        case 'new':
          if (confirm('Create a new document? Unsaved changes will be lost.')) newDocument();
          break;
        case 'save':
          save();
          break;
        case 'saveAs':
          saveAs();
          break;
        case 'open':
          document.querySelector<HTMLInputElement>('#file-open-input')?.click();
          break;
        case 'import':
          document.querySelector<HTMLInputElement>('#file-import-input')?.click();
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
        case 'export':
          setShowExportDialog(true);
          break;
        case 'zoomReset':
          setZoom(1);
          break;
        case 'inspectMode':
          setTool(state.tool === 'inspect' ? 'select' : ('inspect' as ToolId));
          break;
        case 'home':
          onBackToHome?.();
          break;
        case 'settings':
          onOpenSettings?.();
          break;
        case 'startTour':
          onStartTour?.();
          break;
        case 'shortcutPalette':
          onOpenPalette?.();
          break;
        case 'group':
          groupSelected();
          break;
        case 'ungroup':
          ungroupSelected();
          break;
        case 'bringFront':
          arrangeSelected('front');
          break;
        case 'bringForward':
          arrangeSelected('forward');
          break;
        case 'sendBackward':
          arrangeSelected('backward');
          break;
        case 'sendBack':
          arrangeSelected('back');
          break;
        case 'toggleSnap':
          setSnapEnabled(!state.snapEnabled);
          break;
        case 'softProof':
          setSoftProofEnabled(!state.softProofEnabled);
          break;
        case 'clearGuides':
          clearAllGuides();
          break;
        case 'booleanUnion':
          booleanOp('union');
          break;
        case 'booleanSubtract':
          booleanOp('subtract');
          break;
        case 'booleanIntersect':
          booleanOp('intersect');
          break;
        case 'booleanExclude':
          booleanOp('exclude');
          break;
        case 'present':
          startPresentation();
          break;
        case 'canvasModeOutline':
          setCanvasMode('outline');
          break;
        case 'canvasModePreview':
          setCanvasMode('preview');
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
    [
      newDocument,
      serializeDocument,
      undo,
      redo,
      removeSelected,
      setTool,
      setZoom,
      setSnapEnabled,
      state,
      onBackToHome,
      onOpenSettings,
      onStartTour,
      save,
      saveAs,
    ],
  );

  const isActiveTheme = (item: MenuItem) =>
    item.action?.startsWith('theme:') && currentTheme === item.action.slice(6);

  const handleZoomInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseFloat(e.target.value);
      if (!Number.isNaN(v) && v > 0) setZoom(v / 100);
    },
    [setZoom],
  );

  const handleZoomKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
  }, []);

  // ─── keyboard navigation ──────────────────────────────────────────────

  const handleMenuKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const openIdx = openMenu ? MENUS.findIndex((m) => m.id === openMenu) : -1;

      if (openIdx >= 0 && openMenu) {
        // Dropdown is open — navigate items
        const menu = MENUS[openIdx];
        if (!menu) return;
        const items = menu.items.filter((i) => i.label !== '---');

        switch (e.key) {
          case 'ArrowDown':
          case 'ArrowUp': {
            e.preventDefault();
            const dir = e.key === 'ArrowDown' ? 1 : -1;
            setActiveItemIndex((prev) => {
              const next = prev + dir;
              if (next < 0) return items.length - 1;
              if (next >= items.length) return 0;
              return next;
            });
            return;
          }
          case 'Enter':
          case ' ': {
            e.preventDefault();
            const item = items[activeItemIndex];
            if (item?.action) handleAction(item.action);
            return;
          }
          case 'Escape': {
            e.preventDefault();
            setOpenMenu(null);
            setActiveItemIndex(0);
            topLevelRefs.current[openIdx]?.focus();
            return;
          }
          case 'ArrowLeft': {
            e.preventDefault();
            const prev = (openIdx - 1 + MENUS.length) % MENUS.length;
            setOpenMenu(MENUS[prev]?.id ?? null);
            setActiveItemIndex(0);
            setFocusedIndex(prev);
            return;
          }
          case 'ArrowRight': {
            e.preventDefault();
            const next = (openIdx + 1) % MENUS.length;
            setOpenMenu(MENUS[next]?.id ?? null);
            setActiveItemIndex(0);
            setFocusedIndex(next);
            return;
          }
          case 'Home': {
            e.preventDefault();
            setActiveItemIndex(0);
            return;
          }
          case 'End': {
            e.preventDefault();
            setActiveItemIndex(items.length - 1);
            return;
          }
        }
      } else {
        // Top-level navigation
        switch (e.key) {
          case 'ArrowRight':
          case 'ArrowDown': {
            e.preventDefault();
            const next = (focusedIndex + 1) % MENUS.length;
            setFocusedIndex(next);
            topLevelRefs.current[next]?.focus();
            return;
          }
          case 'ArrowLeft':
          case 'ArrowUp': {
            e.preventDefault();
            const prev = (focusedIndex - 1 + MENUS.length) % MENUS.length;
            setFocusedIndex(prev);
            topLevelRefs.current[prev]?.focus();
            return;
          }
          case 'Enter':
          case ' ': {
            e.preventDefault();
            setOpenMenu(MENUS[focusedIndex]?.id ?? null);
            setActiveItemIndex(0);
            return;
          }
          case 'Home': {
            e.preventDefault();
            setFocusedIndex(0);
            topLevelRefs.current[0]?.focus();
            return;
          }
          case 'End': {
            e.preventDefault();
            setFocusedIndex(MENUS.length - 1);
            topLevelRefs.current[MENUS.length - 1]?.focus();
            return;
          }
        }
      }
    },
    [openMenu, focusedIndex, activeItemIndex, handleAction],
  );

  return (
    <div
      className="editor-menubar"
      role="menubar"
      aria-label="Application"
      ref={menuRef}
      onMouseLeave={() => setOpenMenu(null)}
      onKeyDown={handleMenuKeyDown}
    >
      {/* ── Left: Home button + Menu buttons ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
        <button
          type="button"
          className="editor-menubar__home"
          aria-label="Home (Ctrl+Shift+H)"
          title="Home (Ctrl+Shift+H)"
          onClick={() => onBackToHome?.()}
        >
          <StrataLogo size={16} />
        </button>
        {MENUS.map((menu, i) => (
          <div key={menu.id} style={{ position: 'relative' }}>
            <button
              ref={(el) => {
                topLevelRefs.current[i] = el;
              }}
              role="menuitem"
              className="editor-menubar__item"
              aria-haspopup="true"
              aria-expanded={openMenu === menu.id}
              tabIndex={focusedIndex === i ? 0 : -1}
              type="button"
              onClick={() => {
                setOpenMenu(openMenu === menu.id ? null : menu.id);
                setFocusedIndex(i);
                setActiveItemIndex(0);
              }}
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
                {menu.items.map((item) => {
                  if (item.label === '---') {
                    return (
                      <hr
                        key="sep"
                        tabIndex={-1}
                        style={{
                          margin: 'var(--space-1) 0',
                          border: 'none',
                          borderTop: '1px solid var(--color-border-subtle)',
                        }}
                      />
                    );
                  }
                  return (
                    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-checked is valid for menuitemradio role per ARIA spec
                    <button
                      key={item.label}
                      role={itemRole(item)}
                      type="button"
                      aria-checked={
                        item.action?.startsWith('theme:')
                          ? currentTheme === item.action.slice(6)
                          : item.action === 'canvasModeOutline'
                            ? state.canvasMode === 'outline'
                            : item.action === 'canvasModePreview'
                              ? state.canvasMode === 'preview'
                              : undefined
                      }
                      disabled={!item.action}
                      onClick={() => handleAction(item.action ?? '')}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background =
                          'var(--color-interactive-default)';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = isActiveTheme(item)
                          ? 'var(--color-interactive-default)'
                          : '';
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-3)',
                        width: '100%',
                        padding: 'var(--space-1) var(--space-2)',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        background: isActiveTheme(item) ? 'var(--color-interactive-default)' : '',
                        color: item.action
                          ? 'var(--color-text-primary)'
                          : 'var(--color-text-muted)',
                        cursor: 'default',
                        font: 'inherit',
                        fontSize: 'var(--font-size-sm)',
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ flex: 1 }}>{item.label}</span>
                      {item.shortcut && (
                        <span
                          style={{
                            fontSize: 'var(--font-size-xs)',
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          {item.shortcut}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Center: Document name ── */}
      <div className="editor-menubar__doc-name">
        {editingName ? (
          <input
            ref={nameInputRef}
            className="editor-menubar__doc-name-input"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') setEditingName(false);
            }}
            aria-label="Document name"
          />
        ) : (
          // biome-ignore lint/a11y/useSemanticElements: span with role="button" is intentional for inline clickable text; keyboard + click handlers present
          <span
            role="button"
            tabIndex={0}
            onClick={startNameEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                startNameEdit();
              }
            }}
            title="Click to rename"
            style={{ cursor: 'pointer' }}
          >
            {state.document.name || 'Untitled'}
          </span>
        )}
      </div>

      {/* ── Right: Zoom + Undo/Redo ── */}
      <div className="editor-menubar__controls">
        <IconButton icon={CHROME_ICONS.undo} label="Undo" size="sm" onClick={undo} />
        <IconButton icon={CHROME_ICONS.redo} label="Redo" size="sm" onClick={redo} />
        <div className="editor-menubar__zoom">
          <span aria-hidden style={{ color: 'var(--color-text-muted)' }}>
            |
          </span>
          <label htmlFor="menubar-zoom" className="sr-only">
            Zoom
          </label>
          <input
            id="menubar-zoom"
            className="editor-menubar__zoom-input"
            type="number"
            min={1}
            max={1000}
            step={1}
            value={Math.round(state.zoom * 100)}
            onChange={handleZoomInput}
            onKeyDown={handleZoomKey}
            aria-label={`Zoom ${Math.round(state.zoom * 100)}%`}
          />
          <span style={{ color: 'var(--color-text-muted)' }}>%</span>
        </div>
      </div>
    </div>
  );
}
