/**
 * PanelWidthDragEdge — resize the Resources (library) panel.
 *
 * The panel is an overlay on the canvas area with a fixed 300px width in
 * Shell's CSS. This edge makes that width a live, persisted value without
 * touching Shell (a hub file over its import budget): it writes the width
 * through the `--library-panel-width` custom property on the panel container
 * itself, the same imperative-measure pattern PanelResizeHandle uses.
 *
 * APG "window splitter" pattern: role=separator, keyboard arrows (Shift =
 * coarse), Home/End to limits, double-click reset. Widths persist per
 * workspace mode via the canonical `panelWidths` preference and clear on
 * workspace reset.
 */
import { Tooltip } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { subscribeWorkspaceReset } from '../../workspace/workspaceResetEvents';
import {
  clearPanelWidths,
  getPanelWidths,
  getWorkspacePreferences,
  savePanelWidths,
  updateWorkspacePreferences,
} from '../../workspace/workspaceStore';

export const LIBRARY_PANEL_LIMITS = { min: 240, max: 600 } as const;

const DEFAULT_LIBRARY_WIDTH = 300;

/** The Shell-owned panel container; CSS custom properties inherit downward
 *  from it, so a width written here applies to every descendant. */
function libraryPanelContainer(): HTMLElement | null {
  return typeof document !== 'undefined'
    ? document.querySelector<HTMLElement>('[data-panel="library"]')
    : null;
}

function clampLibraryWidth(width: number): number {
  return Math.min(LIBRARY_PANEL_LIMITS.max, Math.max(LIBRARY_PANEL_LIMITS.min, Math.round(width)));
}

export function PanelWidthDragEdge() {
  const { state } = useEditor();
  const [width, setWidth] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  // Live width during a drag: pointer-move handlers close over the render-time
  // value, so the release handler must read the latest from this ref.
  const latestWidthRef = useRef<number | null>(null);

  const applyToContainer = useCallback((next: number | null) => {
    const container = libraryPanelContainer();
    if (!container) return;
    if (next === null) container.style.removeProperty('--library-panel-width');
    else container.style.setProperty('--library-panel-width', `${next}px`);
  }, []);

  // Restore the active mode's saved width on mount; clear on workspace reset.
  useEffect(() => {
    const saved = getPanelWidths(getWorkspacePreferences(), state.workspaceMode).library;
    if (saved !== undefined) {
      const clamped = clampLibraryWidth(saved);
      latestWidthRef.current = clamped;
      setWidth(clamped);
      applyToContainer(clamped);
    }
    return subscribeWorkspaceReset(() => {
      latestWidthRef.current = null;
      setWidth(null);
      applyToContainer(null);
    });
  }, [applyToContainer, state.workspaceMode]);

  const persist = useCallback(
    (next: number) => {
      updateWorkspacePreferences((prefs) =>
        savePanelWidths(prefs, state.workspaceMode, { library: next }),
      );
    },
    [state.workspaceMode],
  );

  const currentWidth = useCallback((): number => {
    // jsdom (and detached containers) report 0-width rects — fall back to
    // the CSS default rather than clamping to the minimum on the first key.
    const measured = libraryPanelContainer()?.getBoundingClientRect().width;
    return width ?? (measured && measured > 0 ? measured : DEFAULT_LIBRARY_WIDTH);
  }, [width]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startWidth = currentWidth();
      latestWidthRef.current = startWidth;
      setDragging(true);

      const target = e.currentTarget;
      const onMove = (me: PointerEvent) => {
        const next = clampLibraryWidth(startWidth + (me.clientX - startX));
        latestWidthRef.current = next;
        setWidth(next);
        applyToContainer(next);
      };
      const onUp = () => {
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onUp);
        target.removeEventListener('pointercancel', onUp);
        setDragging(false);
        const final = latestWidthRef.current ?? startWidth;
        persist(clampLibraryWidth(final));
      };
      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onUp);
      target.addEventListener('pointercancel', onUp);
    },
    [applyToContainer, persist, width],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const current = currentWidth();
      const step = e.shiftKey ? 64 : 16;
      const commit = (next: number) => {
        const clamped = clampLibraryWidth(next);
        latestWidthRef.current = clamped;
        setWidth(clamped);
        applyToContainer(clamped);
        persist(clamped);
      };
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        commit(current + step);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        commit(current - step);
      } else if (e.key === 'Home') {
        e.preventDefault();
        commit(LIBRARY_PANEL_LIMITS.min);
      } else if (e.key === 'End') {
        e.preventDefault();
        commit(LIBRARY_PANEL_LIMITS.max);
      }
    },
    [applyToContainer, persist, width],
  );

  return (
    <Tooltip label="Drag to resize — double-click to reset">
      <hr
        aria-orientation="vertical"
        aria-label="Resize resources panel"
        aria-valuenow={width ?? undefined}
        aria-valuemin={LIBRARY_PANEL_LIMITS.min}
        aria-valuemax={LIBRARY_PANEL_LIMITS.max}
        tabIndex={0}
        className={`panel-width-edge${dragging ? ' panel-width-edge--active' : ''}`}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        onDoubleClick={() => {
          latestWidthRef.current = null;
          setWidth(null);
          applyToContainer(null);
          updateWorkspacePreferences((prefs) =>
            clearPanelWidths(prefs, state.workspaceMode, ['library']),
          );
        }}
      />
    </Tooltip>
  );
}
