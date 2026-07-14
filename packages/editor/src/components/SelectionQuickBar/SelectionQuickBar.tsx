/**
 * SelectionQuickBar — Canva-style selection-anchored action strip.
 *
 * Research basis: Canva contextual image bar; Figma floating chrome.
 * Positioned below the selection screen bbox inside the canvas layer.
 */
import { Icon, type IconName } from '@strata/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { QuickBarActionId, QuickBarProfile } from './resolveQuickBarProfile';
import './SelectionQuickBar.css';

export interface SelectionQuickBarProps {
  profile: QuickBarProfile;
  /** Canvas-local screen bounds of the selection (from worldToCanvas). */
  screenBounds: { x: number; y: number; w: number; h: number };
  onAction: (id: QuickBarActionId) => void;
  /** Action ids currently processing (buttons disabled). */
  pendingActionIds?: readonly QuickBarActionId[];
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

const PADDING = 8;
const BAR_HEIGHT_EST = 44;

export function SelectionQuickBar({
  profile,
  screenBounds,
  onAction,
  pendingActionIds = [],
}: SelectionQuickBarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const pending = useMemo(() => new Set(pendingActionIds), [pendingActionIds]);

  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [moreOpen]);

  const { left, top } = useMemo(() => {
    const preferredTop = screenBounds.y + screenBounds.h + PADDING;
    const centeredLeft = screenBounds.x + screenBounds.w / 2;
    return { left: centeredLeft, top: preferredTop };
  }, [screenBounds]);

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
      className="selection-quick-bar"
      role="toolbar"
      aria-label="Selection actions"
      style={{ left, top, height: BAR_HEIGHT_EST }}
      data-kind={profile.kind}
      data-testid="selection-quick-bar"
    >
      {profile.actions.map((a) => {
        const icon = ACTION_ICONS[a.id] ?? 'Circle';
        return (
          <button
            key={a.id}
            type="button"
            className="selection-quick-bar__btn"
            aria-label={a.label}
            disabled={pending.has(a.id)}
            onClick={() => handleAction(a.id)}
          >
            <Icon name={icon} label={undefined} size="0.95em" />
            <span className="selection-quick-bar__label">{a.label}</span>
          </button>
        );
      })}
      {hasMore && (
        <div className="selection-quick-bar__more" ref={moreRef}>
          <button
            type="button"
            className="selection-quick-bar__btn selection-quick-bar__btn--more"
            aria-label="More"
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            onClick={() => setMoreOpen((v) => !v)}
          >
            <Icon name="ChevronDown" label={undefined} size="0.95em" />
            <span className="selection-quick-bar__label">More</span>
          </button>
          {moreOpen && (
            <div className="selection-quick-bar__menu" role="menu" aria-label="More actions">
              {profile.moreActions!.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="menuitem"
                  className="selection-quick-bar__menuitem"
                  disabled={pending.has(a.id)}
                  onClick={() => handleAction(a.id)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
