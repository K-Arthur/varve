/**
 * SelectionQuickBar — selection-anchored action strip.
 *
 * Chrome matches FloatingToolbar (32px controls, raised surface, accent active).
 * Primary actions: horizontal icon+label. Secondary flips: icon-only + tooltip.
 *
 * Research basis: Strata FloatingToolbar; Canva contextual action bar.
 */
import { Icon, type IconName, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { QuickBarAction, QuickBarActionId, QuickBarProfile } from './resolveQuickBarProfile';
import './SelectionQuickBar.css';

export interface SelectionQuickBarProps {
  profile: QuickBarProfile;
  /** Canvas-local screen bounds of the selection (from worldToCanvas). */
  screenBounds: { x: number; y: number; w: number; h: number };
  /** Canvas's own rendered height (CSS px), for clamping the bar on-screen. */
  containerHeight: number;
  onAction: (id: QuickBarActionId) => void;
  /** Action ids currently processing (buttons disabled). */
  pendingActionIds?: readonly QuickBarActionId[];
  /** Action ids that should show the accent pressed state. */
  activeActionIds?: readonly QuickBarActionId[];
}

const ACTION_ICONS: Partial<Record<QuickBarActionId, IconName>> = {
  crop: 'Crop',
  removeBg: 'ImageMinus',
  upscale: 'Maximize2',
  vectorize: 'Spline',
  flipH: 'FlipHorizontal2',
  flipV: 'FlipVertical2',
  fitCycle: 'Expand',
  refineMask: 'Brush',
  showOriginal: 'Eye',
  cancelBg: 'X',
  editNodes: 'PenTool',
  simplify: 'Minimize2',
  closePath: 'Circle',
  openPath: 'CircleDashed',
  editText: 'Type',
  group: 'Group',
  booleanUnion: 'Combine',
  booleanSubtract: 'Diff',
  booleanIntersect: 'Radius',
  booleanExclude: 'Split',
};

/** Compact label for dense primary chips (full string stays on aria-label/tooltip). */
const SHORT_LABELS: Partial<Record<QuickBarActionId, string>> = {
  removeBg: 'Remove BG',
  flipH: 'Flip H',
  flipV: 'Flip V',
  editNodes: 'Edit nodes',
  closePath: 'Close',
  openPath: 'Open',
  editText: 'Edit',
  booleanUnion: 'Union',
  booleanSubtract: 'Subtract',
  booleanIntersect: 'Intersect',
  booleanExclude: 'Exclude',
};

const ICON_ONLY = new Set<QuickBarActionId>(['flipH', 'flipV']);

const PADDING = 8;
/** Conservative estimate used before the bar's real height is measured. */
const ESTIMATED_BAR_HEIGHT = 44;

function needsSeparatorBefore(actions: QuickBarAction[], index: number): boolean {
  if (index === 0) return false;
  const cur = actions[index]!.id;
  const prev = actions[index - 1]!.id;
  if (ICON_ONLY.has(cur) && !ICON_ONLY.has(prev)) return true;
  if (cur.startsWith('boolean') && prev === 'group') return true;
  if (
    (cur === 'flipH' || cur === 'flipV') &&
    (prev === 'simplify' ||
      prev === 'editText' ||
      prev === 'vectorize' ||
      prev === 'openPath' ||
      prev === 'closePath')
  ) {
    return true;
  }
  return false;
}

export function SelectionQuickBar({
  profile,
  screenBounds,
  containerHeight,
  onAction,
  pendingActionIds = [],
  activeActionIds = [],
}: SelectionQuickBarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuFocusIdx, setMenuFocusIdx] = useState(0);
  const moreRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const menuItemsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const [barHeight, setBarHeight] = useState(ESTIMATED_BAR_HEIGHT);
  const pending = useMemo(() => new Set(pendingActionIds), [pendingActionIds]);
  const active = useMemo(() => new Set(activeActionIds), [activeActionIds]);
  const moreActions = profile.moreActions ?? [];

  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const measure = () => setBarHeight(el.getBoundingClientRect().height || ESTIMATED_BAR_HEIGHT);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!moreOpen) return;
    setMenuFocusIdx(0);
    menuItemsRef.current[0]?.focus();
    const onDoc = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  const { left, top } = useMemo(() => {
    const belowTop = screenBounds.y + screenBounds.h + PADDING;
    const centeredLeft = screenBounds.x + screenBounds.w / 2;
    // The canvas paints an opaque page background across its full bounds and
    // whatever sits below it (page tabs, selection info, status bar) is a
    // separate sibling — rendering past the canvas's own bottom edge means
    // overlapping that chrome instead of being clipped by it. Flip above the
    // selection when there isn't room below.
    const fitsBelow = belowTop + barHeight <= containerHeight;
    const top = fitsBelow ? belowTop : Math.max(0, screenBounds.y - PADDING - barHeight);
    return { left: centeredLeft, top };
  }, [screenBounds, containerHeight, barHeight]);

  const handleAction = useCallback(
    (id: QuickBarActionId) => {
      setMoreOpen(false);
      onAction(id);
    },
    [onAction],
  );

  const hasMore = (profile.moreActions?.length ?? 0) > 0;

  return (
    <div
      ref={barRef}
      className="selection-quick-bar"
      style={{ left, top }}
      data-kind={profile.kind}
      data-testid="selection-quick-bar"
    >
      <div className="selection-quick-bar__inner" role="toolbar" aria-label="Selection actions">
        {profile.actions.map((a, index) => {
          const icon = ACTION_ICONS[a.id] ?? 'Circle';
          const isPending = pending.has(a.id);
          const isActive = active.has(a.id);
          const iconOnly = ICON_ONLY.has(a.id);
          const sep = needsSeparatorBefore(profile.actions, index);
          const short = SHORT_LABELS[a.id] ?? a.label;
          const classBase = iconOnly ? 'selection-quick-bar__btn' : 'selection-quick-bar__text-btn';
          const className = [
            classBase,
            isActive ? `${classBase}--active` : '',
            isPending ? `${classBase}--pending` : '',
          ]
            .filter(Boolean)
            .join(' ');

          const button = (
            <button
              type="button"
              className={className}
              aria-label={a.label}
              aria-pressed={isActive || undefined}
              disabled={isPending}
              onClick={() => handleAction(a.id)}
            >
              <Icon name={icon} size={16} />
              {!iconOnly && <span className="selection-quick-bar__label">{short}</span>}
            </button>
          );

          return (
            <span key={a.id} className="selection-quick-bar__item">
              {sep && <span className="selection-quick-bar__separator" aria-hidden />}
              {iconOnly ? <Tooltip label={a.label}>{button}</Tooltip> : button}
            </span>
          );
        })}
        {hasMore && (
          <span className="selection-quick-bar__item">
            <span className="selection-quick-bar__separator" aria-hidden />
            <div className="selection-quick-bar__more" ref={moreRef}>
              <button
                type="button"
                className={`selection-quick-bar__chevron${moreOpen ? ' selection-quick-bar__chevron--open' : ''}`}
                aria-label="More"
                aria-expanded={moreOpen}
                aria-haspopup="menu"
                onClick={() => setMoreOpen((v) => !v)}
              >
                More
                <Icon name="ChevronDown" size={14} />
              </button>
              {moreOpen && (
                <div
                  className="selection-quick-bar__menu"
                  role="menu"
                  aria-label="More actions"
                  onKeyDown={(e) => {
                    const count = moreActions.length;
                    if (count === 0) return;
                    let next = menuFocusIdx;
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      next = (menuFocusIdx + 1) % count;
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      next = (menuFocusIdx - 1 + count) % count;
                    } else if (e.key === 'Home') {
                      e.preventDefault();
                      next = 0;
                    } else if (e.key === 'End') {
                      e.preventDefault();
                      next = count - 1;
                    } else {
                      return;
                    }
                    setMenuFocusIdx(next);
                    menuItemsRef.current[next]?.focus();
                  }}
                >
                  {moreActions.map((a, i) => {
                    const isActive = active.has(a.id);
                    return (
                      <button
                        key={a.id}
                        ref={(el) => {
                          menuItemsRef.current[i] = el;
                        }}
                        type="button"
                        role="menuitem"
                        tabIndex={i === menuFocusIdx ? 0 : -1}
                        className={`selection-quick-bar__menuitem${isActive ? ' selection-quick-bar__menuitem--active' : ''}`}
                        disabled={pending.has(a.id)}
                        onClick={() => handleAction(a.id)}
                      >
                        <Icon name={ACTION_ICONS[a.id] ?? 'Circle'} size={16} />
                        <span>{a.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </span>
        )}
      </div>
    </div>
  );
}
