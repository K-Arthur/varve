/**
 * QuickActionsBar — context-aware action search and launch.
 *
 * Renders as a floating bar near the cursor (or at a fixed position) that
 * surfaces recently used actions + a fuzzy-search filter. Modeled after
 * Figma's command palette and VS Code's quick open.
 *
 * Research basis: Figma ⌘/ palette, VS Code Ctrl+Shift+P, Penpot shortcuts.
 */
import { FocusTrap, Icon } from '@varve/ui';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getActionRegistry, type RegisteredAction } from '../../actions/ActionRegistry';
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
  position?: { x: number; y: number };
}

export function QuickActionsBar({ open, onClose, onExecute, position }: QuickActionsBarProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [recent, setRecent] = useState<string[]>(loadRecent);

  const registry = getActionRegistry();

  const allActions = useMemo(() => registry.getAll(), [registry]);

  const filtered = useMemo(() => {
    let actions = query ? registry.search(query) : allActions;

    if (!query) {
      const recentSet = new Set(recent);
      const recentActions = actions.filter((a) => recentSet.has(a.id));
      const otherActions = actions.filter((a) => !recentSet.has(a.id));
      actions = [...recentActions, ...otherActions];
    }

    return actions.slice(0, MAX_VISIBLE);
  }, [query, registry, allActions, recent]);

  // Save the launching element while the palette is open and hand focus back
  // when it closes. FocusTrap also restores, but only while focus is still
  // inside the trap at cleanup — an executed action can move focus first, so
  // the palette owns this explicitly rather than relying on that path.
  const launchElementRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body) launchElementRef.current = active;
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    const target = launchElementRef.current;
    launchElementRef.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }, [open]);

  const execute = useCallback(
    (action: RegisteredAction) => {
      const updated = [action.id, ...recent.filter((id) => id !== action.id)];
      setRecent(updated);
      saveRecent(updated);
      onExecute?.(action.id);
      action.handler(undefined);
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

  const barStyle: React.CSSProperties = position
    ? {
        position: 'fixed',
        left: Math.min(position.x, window.innerWidth - 320),
        top: Math.min(position.y, window.innerHeight - 400),
      }
    : {
        position: 'fixed',
        bottom: 'var(--space-8)',
        left: '50%',
        transform: 'translateX(-50%)',
      };

  return (
    // FocusTrap supplies what aria-modal only claims: Tab containment plus
    // restoration of focus to whatever launched the palette. Without it, Tab
    // walked into the editor behind a supposedly modal surface and closing
    // could drop focus to <body>.
    <FocusTrap active initialFocus=".quick-actions-bar__input" onClose={onClose}>
      <div
        className="quick-actions-bar"
        style={barStyle}
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
            placeholder="Search actions\u2026"
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
              onClick={() => execute(action)}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span className="quick-actions-bar__item-label">{action.label}</span>
              <span className="quick-actions-bar__item-category">{action.category}</span>
            </button>
          ))}
        </div>
      </div>
    </FocusTrap>
  );
}
