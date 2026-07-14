/**
 * SelectionQuickBar — selection-anchored action strip.
 *
 * Visual language matches FloatingToolbar: raised surface, 32px icon buttons,
 * Tooltip labels (no cramped multi-line captions).
 *
 * Research basis: Strata FloatingToolbar chrome; Canva contextual action bar.
 */
import { Icon, type IconName, Tooltip } from '@strata/ui';
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
      style={{ left, top }}
      data-kind={profile.kind}
      data-testid="selection-quick-bar"
    >
      <div className="selection-quick-bar__inner" role="toolbar" aria-label="Selection actions">
        {profile.actions.map((a, index) => {
          const icon = ACTION_ICONS[a.id] ?? 'Circle';
          const isPending = pending.has(a.id);
          const groupStart =
            index > 0 &&
            ((a.id === 'flipH' &&
              ['vectorize', 'simplify', 'editText'].includes(
                profile.actions[index - 1]?.id ?? '',
              )) ||
              (a.id.startsWith('boolean') && profile.actions[index - 1]?.id === 'group'));
          return (
            <Tooltip key={a.id} label={a.label}>
              <button
                type="button"
                className={`selection-quick-bar__btn${groupStart ? ' selection-quick-bar__btn--group-start' : ''}${isPending ? ' selection-quick-bar__btn--pending' : ''}`}
                aria-label={a.label}
                disabled={isPending}
                onClick={() => handleAction(a.id)}
              >
                <Icon name={icon} size={16} />
              </button>
            </Tooltip>
          );
        })}
        {hasMore && (
          <div className="selection-quick-bar__more" ref={moreRef}>
            <Tooltip label="More">
              <button
                type="button"
                className="selection-quick-bar__chevron"
                aria-label="More"
                aria-expanded={moreOpen}
                aria-haspopup="menu"
                onClick={() => setMoreOpen((v) => !v)}
              >
                <Icon name="ChevronDown" size={14} />
              </button>
            </Tooltip>
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
                    <Icon name={ACTION_ICONS[a.id] ?? 'Circle'} size={14} />
                    <span>{a.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
