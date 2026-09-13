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

import { ResizableHandle, Tooltip } from '@varve/ui';
import { useCallback, useState } from 'react';
import { loadSettings, updateSettings } from '../settings';

export const PANEL_LIMITS = {
  layers: { min: 180, max: 480 },
  inspector: { min: 240, max: 600 },
} as const;

/** Minimum width the canvas column keeps; panels are clamped so the canvas
 *  never falls below this (WCAG 1.4.10 reflow / usability). */
export const CANVAS_MIN_WIDTH = 320;

export type PanelSide = keyof typeof PANEL_LIMITS;

export function clampPanelWidth(side: PanelSide, width: number): number {
  const { min, max } = PANEL_LIMITS[side];
  return Math.min(max, Math.max(min, Math.round(width)));
}

/** Default width the CSS clamp() custom property produces at a viewport. */
export function defaultPanelWidth(side: PanelSide, viewport: number): number {
  // Mirrors tokens.css: --sidebar-width: clamp(14rem, 12rem + 8vw, 18rem);
  // --inspector-width: clamp(15rem, 13rem + 8vw, 20rem);
  if (side === 'layers') return Math.min(288, Math.max(224, 192 + viewport * 0.08));
  return Math.min(320, Math.max(240, 208 + viewport * 0.08));
}

/** Clamp a panel width so the canvas column keeps CANVAS_MIN_WIDTH. */
export function clampPanelWidthToViewport(
  side: PanelSide,
  width: number,
  otherWidth: number,
  viewport: number,
): number {
  const min = PANEL_LIMITS[side].min;
  const available = Math.max(min, viewport - CANVAS_MIN_WIDTH - otherWidth);
  return Math.min(clampPanelWidth(side, width), available);
}

/**
 * Resolve the widths actually rendered at a viewport.
 *
 * Desired widths are the user's persisted intent (min/max clamped only); the
 * display value additionally yields to the canvas minimum. Keeping the two
 * apart is what stops a narrow window from permanently overwriting a desktop
 * arrangement.
 */
export function resolveDisplayWidths(
  desired: { layers: number | null; inspector: number | null },
  viewport: number,
): { layers: number | null; inspector: number | null } {
  const resolved = { ...desired };
  if (desired.layers !== null) {
    const other = desired.inspector ?? defaultPanelWidth('inspector', viewport);
    resolved.layers = clampPanelWidthToViewport('layers', desired.layers, other, viewport);
  }
  if (desired.inspector !== null) {
    const other = desired.layers ?? defaultPanelWidth('layers', viewport);
    resolved.inspector = clampPanelWidthToViewport('inspector', desired.inspector, other, viewport);
  }
  return resolved;
}

/** Hook owning both panel widths (persisted in editor settings);
 *  returns CSS-var style for the shell root.
 *
 *  `widths` are the widths actually used for layout (clamped so the canvas
 *  keeps CANVAS_MIN_WIDTH at the current viewport); `desiredWidths` are the
 *  user's chosen widths with only the per-panel min/max applied. Only the
 *  desired value is persisted, so opening a narrow window and switching
 *  modes cannot permanently shrink a desktop arrangement.
 */
export function usePanelWidths(): {
  shellStyle: React.CSSProperties;
  widths: { layers: number | null; inspector: number | null };
  desiredWidths: { layers: number | null; inspector: number | null };
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
    setWidths((prev) => {
      // Persist the user's intent (min/max clamp only), never the
      // viewport-clamped display value.
      const desired = width === null ? null : clampPanelWidth(side, width);
      updateSettings({
        panel: side === 'layers' ? { leftPanelWidth: desired } : { rightPanelWidth: desired },
      });
      return { ...prev, [side]: desired };
    });
  }, []);

  const viewport = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const effective = resolveDisplayWidths(widths, viewport);

  const shellStyle: React.CSSProperties = {};
  if (effective.layers !== null) {
    (shellStyle as Record<string, string>)['--sidebar-width'] = `${effective.layers}px`;
  }
  if (effective.inspector !== null) {
    (shellStyle as Record<string, string>)['--inspector-width'] = `${effective.inspector}px`;
  }

  return { shellStyle, widths: effective, desiredWidths: widths, setWidth };
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
  const viewport = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const currentWidth = width ?? defaultPanelWidth(side, viewport);

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
        window.removeEventListener('blur', onUp);
        setDragging(false);
      };
      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onUp);
      target.addEventListener('pointercancel', onUp);
      window.addEventListener('blur', onUp);
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
      <ResizableHandle
        role="separator"
        aria-orientation="vertical"
        aria-label={isLayers ? 'Resize layers panel' : 'Resize inspector panel'}
        aria-controls={isLayers ? 'editor-layers-panel' : 'editor-inspector-panel'}
        aria-valuenow={currentWidth}
        aria-valuemin={PANEL_LIMITS[side].min}
        aria-valuemax={PANEL_LIMITS[side].max}
        aria-valuetext={`${currentWidth} pixels`}
        tabIndex={0}
        className={`panel-resize panel-resize--${isLayers ? 'right' : 'left'}`}
        active={dragging}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        onDoubleClick={() => onResize(null)}
      />
    </Tooltip>
  );
}
