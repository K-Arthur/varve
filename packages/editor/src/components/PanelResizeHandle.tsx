/**
 * PanelResizeHandle — drag/keyboard-resizable side panels.
 *
 * APG "window splitter" pattern: role=separator, aria-orientation=vertical,
 * aria-valuenow reporting the controlled panel's width. Pointer drag resizes,
 * arrow keys nudge (Shift = coarse), Home/End jump to min/max, double-click
 * resets to the default (clamp-based) width.
 *
 * Widths persist per panel in localStorage and are applied by overriding the
 * shell grid's --sidebar-width / --inspector-width custom properties.
 */

import { Tooltip } from '@varve/ui';
import { useCallback, useState } from 'react';
import { loadSettings, updateSettings } from '../settings';

export const PANEL_LIMITS = {
  layers: { min: 180, max: 480 },
  inspector: { min: 240, max: 600 },
} as const;

export type PanelSide = keyof typeof PANEL_LIMITS;

export function clampPanelWidth(side: PanelSide, width: number): number {
  const { min, max } = PANEL_LIMITS[side];
  return Math.min(max, Math.max(min, Math.round(width)));
}

/** Hook owning both panel widths (persisted in editor settings);
 *  returns CSS-var style for the shell root. */
export function usePanelWidths(): {
  shellStyle: React.CSSProperties;
  widths: { layers: number | null; inspector: number | null };
  setWidth: (side: PanelSide, width: number | null) => void;
} {
  const [widths, setWidths] = useState<{ layers: number | null; inspector: number | null }>(() => {
    const { leftPanelWidth, rightPanelWidth } = loadSettings().panel;
    return {
      layers: leftPanelWidth != null ? clampPanelWidth('layers', leftPanelWidth) : null,
      inspector: rightPanelWidth != null ? clampPanelWidth('inspector', rightPanelWidth) : null,
    };
  });

  const setWidth = useCallback((side: PanelSide, width: number | null) => {
    const clamped = width === null ? null : clampPanelWidth(side, width);
    setWidths((prev) => ({ ...prev, [side]: clamped }));
    updateSettings({
      panel: side === 'layers' ? { leftPanelWidth: clamped } : { rightPanelWidth: clamped },
    });
  }, []);

  const shellStyle: React.CSSProperties = {};
  if (widths.layers !== null) {
    (shellStyle as Record<string, string>)['--sidebar-width'] = `${widths.layers}px`;
  }
  if (widths.inspector !== null) {
    (shellStyle as Record<string, string>)['--inspector-width'] = `${widths.inspector}px`;
  }

  return { shellStyle, widths, setWidth };
}

export function PanelResizeHandle({
  side,
  width,
  onResize,
}: {
  side: PanelSide;
  /** Current width in px, or null when the default clamp() width applies. */
  width: number | null;
  onResize: (width: number | null) => void;
}) {
  const [dragging, setDragging] = useState(false);

  // Panel edge the handle sits on: layers panel resizes from its right edge,
  // inspector from its left. Drag direction maps accordingly.
  const isLayers = side === 'layers';

  const measurePanel = useCallback((): number => {
    const el = document.querySelector<HTMLElement>(
      isLayers ? '.editor__layers-panel' : '.editor__inspector-panel',
    );
    return el?.getBoundingClientRect().width ?? PANEL_LIMITS[side].min;
  }, [isLayers, side]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startWidth = width ?? measurePanel();
      setDragging(true);

      const target = e.currentTarget;
      const onMove = (me: PointerEvent) => {
        const dx = me.clientX - startX;
        onResize(startWidth + (isLayers ? dx : -dx));
      };
      const onUp = () => {
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onUp);
        target.removeEventListener('pointercancel', onUp);
        setDragging(false);
      };
      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onUp);
      target.addEventListener('pointercancel', onUp);
    },
    [isLayers, measurePanel, onResize, width],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const current = width ?? measurePanel();
      const step = e.shiftKey ? 64 : 16;
      const grow = isLayers ? 'ArrowRight' : 'ArrowLeft';
      const shrink = isLayers ? 'ArrowLeft' : 'ArrowRight';
      if (e.key === grow) {
        e.preventDefault();
        onResize(current + step);
      } else if (e.key === shrink) {
        e.preventDefault();
        onResize(current - step);
      } else if (e.key === 'Home') {
        e.preventDefault();
        onResize(PANEL_LIMITS[side].min);
      } else if (e.key === 'End') {
        e.preventDefault();
        onResize(PANEL_LIMITS[side].max);
      }
    },
    [isLayers, measurePanel, onResize, side, width],
  );

  return (
    <Tooltip label="Drag to resize — double-click to reset">
      <hr
        aria-orientation="vertical"
        aria-label={isLayers ? 'Resize layers panel' : 'Resize inspector panel'}
        aria-valuenow={width ?? undefined}
        aria-valuemin={PANEL_LIMITS[side].min}
        aria-valuemax={PANEL_LIMITS[side].max}
        tabIndex={0}
        className={`panel-resize panel-resize--${isLayers ? 'right' : 'left'}${
          dragging ? ' panel-resize--active' : ''
        }`}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        onDoubleClick={() => onResize(null)}
      />
    </Tooltip>
  );
}
