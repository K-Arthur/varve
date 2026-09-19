/**
 * SelectionQuickBar — selection-anchored action strip.
 *
 * Chrome matches FloatingToolbar (32px controls, raised surface, accent active).
 * Primary actions: horizontal icon+label. Secondary flips: icon-only + tooltip.
 *
 * Research basis: Strata FloatingToolbar; Canva contextual action bar.
 */
import { Icon, type IconName, Menu, type MenuEntry, Tooltip } from '@varve/ui';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { QuickBarAction, QuickBarActionId, QuickBarProfile } from './resolveQuickBarProfile';
import {
  clampQuickBarLeft,
  padReserveFromRects,
  QUICK_BAR_EDGE_MARGIN,
  type QuickBarPadReserve,
  resolveQuickBarTop,
} from './selectionQuickBarPosition';
import './SelectionQuickBar.css';

/** The floating tool palette; the bar must not place itself under it. */
const FLOATING_PALETTE_SELECTOR = '[data-testid="toolbar"].floating-toolbar';

export { FLOATING_PALETTE_SELECTOR };

export interface SelectionQuickBarProps {
  profile: QuickBarProfile;
  /** Canvas-local screen bounds of the selection (from worldToCanvas). */
  screenBounds: { x: number; y: number; w: number; h: number };
  /** Canvas's own rendered height (CSS px), for clamping the bar on-screen. */
  containerHeight: number;
  /** Canvas's own rendered width (CSS px), for clamping the bar on-screen. */
  containerWidth: number;
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

const PADDING = QUICK_BAR_EDGE_MARGIN;
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
  containerWidth,
  onAction,
  pendingActionIds = [],
  activeActionIds = [],
}: SelectionQuickBarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(ESTIMATED_BAR_HEIGHT);
  const [barWidth, setBarWidth] = useState(0);
  const [padReserve, setPadReserve] = useState<QuickBarPadReserve>({ top: 0, bottom: 0 });
  const pending = useMemo(() => new Set(pendingActionIds), [pendingActionIds]);
  const active = useMemo(() => new Set(activeActionIds), [activeActionIds]);
  const moreActions = profile.moreActions ?? [];

  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setBarHeight(rect.height || ESTIMATED_BAR_HEIGHT);
      setBarWidth(rect.width);
      // The palette is pinned to a canvas edge and holds a higher z-level, so
      // its band is space the bar cannot use. Measured, not hard-coded: the
      // palette height changes with touch targets, responsive overflow, and the
      // user's View > Toolbar at Top preference. It is a Shell-grid sibling of
      // `.editor-canvas` (not a descendant), so the lookup is document-scoped;
      // the band is derived from viewport rects, which is correct regardless of
      // where either element sits in the tree.
      const canvas = el.closest('.editor-canvas');
      const palette = document.querySelector(FLOATING_PALETTE_SELECTOR);
      setPadReserve(
        padReserveFromRects(
          canvas?.getBoundingClientRect() ?? null,
          palette?.getBoundingClientRect() ?? null,
        ),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    const palette = document.querySelector(FLOATING_PALETTE_SELECTOR);
    if (palette) observer.observe(palette);
    return () => observer.disconnect();
  }, []);

  const maxBarWidth = useMemo(() => {
    if (!Number.isFinite(containerWidth) || containerWidth <= 0) return undefined;
    return Math.max(0, containerWidth - 2 * PADDING);
  }, [containerWidth]);

  const { left, top } = useMemo(() => {
    const centeredLeft = screenBounds.x + screenBounds.w / 2;
    const placement = resolveQuickBarTop({
      selectionTop: screenBounds.y,
      selectionBottom: screenBounds.y + screenBounds.h,
      barHeight,
      containerHeight,
      reservedTop: padReserve.top,
      reservedBottom: padReserve.bottom,
      margin: PADDING,
    });
    // The canvas is the clipping box (`overflow: hidden`), so the bar must stay
    // inside it horizontally or its leading actions are unreachable.
    return {
      left: clampQuickBarLeft(centeredLeft, barWidth, containerWidth, PADDING),
      top: placement.top,
    };
  }, [screenBounds, containerHeight, containerWidth, barHeight, barWidth, padReserve]);

  const handleAction = useCallback(
    (id: QuickBarActionId) => {
      setMoreOpen(false);
      onAction(id);
    },
    [onAction],
  );

  const hasMore = (profile.moreActions?.length ?? 0) > 0;
  const moreMenuItems = useMemo<MenuEntry[]>(
    () =>
      moreActions.map((a) => ({
        id: a.id,
        label: a.label,
        onAction: () => handleAction(a.id),
        disabled: pending.has(a.id),
      })),
    [handleAction, moreActions, pending],
  );

  return (
    <div
      ref={barRef}
      className="selection-quick-bar"
      style={
        {
          left,
          top,
          '--selection-quick-bar-max-width':
            maxBarWidth === undefined ? undefined : `${maxBarWidth}px`,
        } as React.CSSProperties
      }
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
          const className = [classBase, isPending ? `${classBase}--pending` : '']
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
            <div className="selection-quick-bar__more">
              <button
                ref={moreTriggerRef}
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
              <Menu
                triggerRef={moreTriggerRef}
                open={moreOpen}
                onClose={() => setMoreOpen(false)}
                label="More actions"
                items={moreMenuItems}
                size="compact"
              />
            </div>
          </span>
        )}
      </div>
    </div>
  );
}
