/**
 * QuickActionsBar — context-aware action search and launch.
 *
 * Renders as a floating bar near the cursor (or at a fixed position) that
 * surfaces recently used actions + a fuzzy-search filter. Modeled after
 * Figma's command palette and VS Code's quick open.
 *
 * Research basis: Figma ⌘/ palette, VS Code Ctrl+Shift+P, Penpot shortcuts.
 */
import {
  FloatingPortal,
  FocusTrap,
  Icon,
  type OverlayAnchor,
  pointAnchor,
  viewportPoint,
} from '@varve/ui';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  dispatchRegisteredAction,
  getActionRegistry,
  type RegisteredAction,
} from '../../actions/ActionRegistry';
import { getRegisteredTools, type ToolId } from '../../tools/toolRegistry';
import { useEffectiveWorkspaceConfig } from '../../workspace/useWorkspaceConfig';
import { getToolbarToolIds, type WorkspaceMode } from '../../workspace/workspaceTypes';
import './QuickActionsBar.css';

const MAX_VISIBLE = 12;
const RECENT_KEY = 'strata-quick-actions-recent';

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRecent(recent: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, 20)));
  } catch {}
}

export interface QuickActionsBarProps {
  open: boolean;
  onClose: () => void;
  context?: 'always' | 'selection' | 'textEdit' | 'multiSelect' | 'canvas';
  onExecute?: (actionId: string) => void;
  /** Explicit viewport/element/range anchor for detached-window callers. */
  anchor?: OverlayAnchor | null;
  /** Legacy viewport CSS-pixel point; prefer `anchor` for new callers. */
  position?: { x: number; y: number };
  workspaceMode?: WorkspaceMode;
}

export function QuickActionsBar({
  open,
  onClose,
  onExecute,
  anchor,
  position,
  workspaceMode = 'design',
}: QuickActionsBarProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const launchElementRef = useRef<HTMLElement | null>(null);

  const registry = getActionRegistry();
  const effectiveConfig = useEffectiveWorkspaceConfig(workspaceMode);
  const hiddenToolActionIds = useMemo(() => {
    const visible = new Set(getToolbarToolIds(effectiveConfig.toolbar));
    return new Set(
      getRegisteredTools()
        .filter((definition) => definition.shortcutId && !visible.has(definition.id as ToolId))
        .map((definition) => definition.shortcutId as string),
    );
  }, [effectiveConfig]);

  const allActions = useMemo(
    () => registry.getAll().filter((action) => !action.placeholder),
    [registry, open],
  );

  const filtered = useMemo(() => {
    let actions = query
      ? registry.search(query).filter((action) => !action.placeholder)
      : allActions;

    if (!query) {
      const recentSet = new Set(recent);
      const recentActions = actions.filter((a) => recentSet.has(a.id));
      const otherActions = actions.filter((a) => !recentSet.has(a.id));
      actions = [...recentActions, ...otherActions];
    }

    return actions.slice(0, MAX_VISIBLE);
  }, [query, registry, allActions, recent]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
  }, [open]);

  // Capture before FloatingPortal mounts its window-local host. FocusTrap is
  // deliberately not also restoring focus: this is the one owner for the
  // command surface's handoff, and it can avoid stealing focus from a dialog
  // opened synchronously by an action.
  useLayoutEffect(() => {
    const ownerDocument =
      anchor?.kind === 'point'
        ? anchor.ownerDocument
        : anchor?.kind === 'element'
          ? anchor.element.ownerDocument
          : anchor?.kind === 'range'
            ? (anchor.range.startContainer.ownerDocument ?? document)
            : document;
    if (open) {
      const active = ownerDocument.activeElement as HTMLElement | null;
      if (active && active !== ownerDocument.body) launchElementRef.current = active;
      return;
    }
    const target = launchElementRef.current;
    launchElementRef.current = null;
    const active = ownerDocument.activeElement;
    if (target?.isConnected && (!active || active === ownerDocument.body || !active.isConnected)) {
      target.focus({ preventScroll: true });
    }
  }, [open]);

  const actionAnchor = useMemo(() => {
    if (anchor) return anchor;
    const ownerDocument = document;
    const ownerWindow = ownerDocument.defaultView;
    const width = ownerWindow?.innerWidth ?? ownerDocument.documentElement.clientWidth;
    const height = ownerWindow?.innerHeight ?? ownerDocument.documentElement.clientHeight;
    const x = position?.x ?? width / 2;
    const y = position?.y ?? Math.max(0, height - 8);
    return pointAnchor(viewportPoint(x, y), ownerDocument);
  }, [anchor, position?.x, position?.y]);

  const execute = useCallback(
    (action: RegisteredAction) => {
      const updated = [action.id, ...recent.filter((id) => id !== action.id)];
      setRecent(updated);
      saveRecent(updated);
      onExecute?.(action.id);
      dispatchRegisteredAction(action.id);
      onClose();
    },
    [recent, onExecute, onClose],
  );

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && filtered[activeIndex]) {
        e.preventDefault();
        execute(filtered[activeIndex]);
      }
    },
    [filtered, activeIndex, execute, onClose],
  );

  useEffect(() => {
    if (open && listRef.current) {
      const el = listRef.current.children[activeIndex] as HTMLElement | undefined;
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [activeIndex, open]);

  if (!open) return null;

  return (
    <FloatingPortal
      anchor={actionAnchor}
      open={open}
      placement={position ? 'bottom-start' : 'top'}
      fallbackPlacements={['top-start', 'bottom-end', 'left-start', 'right-start']}
      offsetDistance={8}
      maxHeight={420}
      kind="action-menu"
      dismissOnEscape={false}
      onClose={onClose}
      className="quick-actions-bar__layer"
    >
      {/* FocusTrap supplies what aria-modal only claims: Tab containment plus
          restoration of focus to whatever launched the palette. */}
      <FocusTrap
        active
        initialFocus=".quick-actions-bar__input"
        onClose={onClose}
        restoreFocus={false}
      >
        <div
          className="quick-actions-bar"
          role="dialog"
          aria-modal={true}
          aria-label="Quick actions"
          onKeyDown={handleKeyDown}
        >
          <div className="quick-actions-bar__input-wrap">
            <Icon name="Search" size={16} className="quick-actions-bar__search-icon" />
            <input
              ref={inputRef}
              className="quick-actions-bar__input"
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              placeholder="Search actions..."
              aria-label="Search actions"
            />
            <button
              type="button"
              className="quick-actions-bar__close-btn"
              onClick={onClose}
              aria-label="Close quick actions"
            >
              <Icon name="X" size={16} />
            </button>
          </div>

          <div
            className="quick-actions-bar__results"
            ref={listRef}
            role="listbox"
            aria-label="Actions"
          >
            {filtered.length === 0 && (
              <div className="quick-actions-bar__empty">No actions found</div>
            )}
            {filtered.map((action, i) => (
              <button
                key={action.id}
                type="button"
                className={`quick-actions-bar__item${i === activeIndex ? ' quick-actions-bar__item--active' : ''}`}
                role="option"
                aria-selected={i === activeIndex}
                aria-label={`${action.label}${hiddenToolActionIds.has(action.id) ? ', hidden from current toolbar' : ''}`}
                onClick={() => execute(action)}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <span className="quick-actions-bar__item-label">
                  {action.label}
                  {hiddenToolActionIds.has(action.id) && (
                    <span className="quick-actions-bar__item-note">Hidden from toolbar</span>
                  )}
                </span>
                <span className="quick-actions-bar__item-category">{action.category}</span>
              </button>
            ))}
          </div>
        </div>
      </FocusTrap>
    </FloatingPortal>
  );
}
