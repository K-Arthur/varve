/**
 * MinimapPanel — interactive canvas minimap for document navigation.
 *
 * Architecture:
 * - Uses `buildMinimapScene` for canonical document-bounds computation.
 * - Uses `computeMinimapTransform` for world→minimap coordinate mapping.
 * - Uses `renderMinimapToCanvas` for Canvas2D rendering.
 * - Click/drag navigates the main canvas viewport.
 * - Selection state is synchronized from the editor context.
 * - Page-aware: shows the active page's content when pages exist.
 * - Outlier-culled: distant objects are marked, not stretched.
 * - Keyboard accessible: focus, Enter to fit, arrow keys to pan.
 */

import { Tooltip } from '@strata/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../context';
import {
  buildMinimapScene,
  computeMinimapSize,
  computeMinimapTransform,
  computeViewportMinimapRect,
  minimapToWorld,
} from './minimapLayout';
import type { MinimapColors } from './minimapRenderer';
import { renderMinimapToCanvas, resolveMinimapColors } from './minimapRenderer';
import './minimap.css';

/** Resolve CSS variable with fallback. */
function resolveCssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return val || fallback;
}

export function MinimapPanel() {
  const editor = useEditor();
  const { selectedNodes } = useEditor();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const lastPanRef = useRef<{ x: number; y: number } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);

  // Measure container width for responsive minimap sizing
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerWidth(w);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Selected node IDs as a stable Set
  const sel = selectedNodes();
  const selectedIds = useMemo(() => new Set(sel.map((n) => n.id)), [sel]);

  // Build the minimap scene (pure computation, memoized on document + selection)
  const scene = useMemo(
    () => buildMinimapScene(editor.state.document, selectedIds),
    [editor.state.document, selectedIds],
  );

  // Compute minimap canvas dimensions — use container width for responsive sizing
  const mmSize = useMemo(
    () => computeMinimapSize(scene.contentBounds, containerWidth || 160),
    [scene.contentBounds, containerWidth],
  );

  // Compute the world→minimap transform
  const tf = useMemo(
    () => computeMinimapTransform(scene.contentBounds, mmSize.width, mmSize.height),
    [scene.contentBounds, mmSize],
  );

  // Resolve theme colors — re-resolve when themeRevision bumps
  const colors: MinimapColors = useMemo(
    () => resolveMinimapColors(resolveCssVar),
    [editor.state.themeRevision],
  );

  // Get main canvas dimensions (avoid DOM queries during render)
  const getCanvasSize = useCallback(() => {
    const canvasEl = document.querySelector('.editor-canvas canvas') as HTMLCanvasElement | null;
    return {
      w: canvasEl?.clientWidth ?? 800,
      h: canvasEl?.clientHeight ?? 600,
    };
  }, []);

  // Compute viewport indicator in minimap coordinates
  const viewportRect = useMemo(() => {
    const vp = getCanvasSize();
    return computeViewportMinimapRect(editor.state.pan, editor.state.zoom, vp.w, vp.h, tf);
  }, [editor.state.pan, editor.state.zoom, tf, getCanvasSize]);

  // Draw the minimap
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderMinimapToCanvas(canvas, scene, tf, viewportRect, colors);
  }, [scene, tf, viewportRect, colors]);

  // Redraw whenever dependencies change
  useEffect(() => {
    draw();
  }, [draw]);

  // Also redraw on window resize (main canvas size changes)
  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draw]);

  // --- Navigation ---

  /** Center the main canvas on a world-space point. */
  const navigateToWorld = useCallback(
    (worldX: number, worldY: number) => {
      const vp = getCanvasSize();
      editor.setPan({
        x: vp.w / 2 - worldX * editor.state.zoom,
        y: vp.h / 2 - worldY * editor.state.zoom,
      });
    },
    [editor, getCanvasSize],
  );

  /** Convert a pointer event's client coords to minimap-local coords. */
  const pointerToMinimap = useCallback(
    (e: React.PointerEvent | PointerEvent): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    [],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      isDragging.current = true;
      const mm = pointerToMinimap(e);
      if (!mm) return;
      const world = minimapToWorld(mm.x, mm.y, tf);
      navigateToWorld(world.x, world.y);
      lastPanRef.current = { x: e.clientX, y: e.clientY };
      canvasRef.current?.setPointerCapture(e.pointerId);
    },
    [tf, navigateToWorld, pointerToMinimap],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDragging.current) return;
      const mm = pointerToMinimap(e);
      if (!mm) return;
      const world = minimapToWorld(mm.x, mm.y, tf);
      navigateToWorld(world.x, world.y);
    },
    [tf, navigateToWorld, pointerToMinimap],
  );

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
    lastPanRef.current = null;
  }, []);

  /** Double-click: fit all content in viewport. */
  const handleDoubleClick = useCallback(() => {
    if (scene.entries.length === 0) return;
    editor.revealSelection({ fit: true });
  }, [editor, scene.entries.length]);

  /** Keyboard navigation. */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      const panStep = 50; // world units per arrow key

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          editor.setPan({
            x: editor.state.pan.x + panStep * editor.state.zoom,
            y: editor.state.pan.y,
          });
          break;
        case 'ArrowRight':
          e.preventDefault();
          editor.setPan({
            x: editor.state.pan.x - panStep * editor.state.zoom,
            y: editor.state.pan.y,
          });
          break;
        case 'ArrowUp':
          e.preventDefault();
          editor.setPan({
            x: editor.state.pan.x,
            y: editor.state.pan.y + panStep * editor.state.zoom,
          });
          break;
        case 'ArrowDown':
          e.preventDefault();
          editor.setPan({
            x: editor.state.pan.x,
            y: editor.state.pan.y - panStep * editor.state.zoom,
          });
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          editor.revealSelection({ fit: true });
          break;
        case 'Home':
          e.preventDefault();
          editor.revealSelection({ fit: true });
          break;
        case 'Escape':
          e.preventDefault();
          setCollapsed(true);
          break;
      }
    },
    [editor, getCanvasSize],
  );

  // Don't render if collapsed
  if (collapsed) {
    return (
      <Tooltip label="Show minimap">
        <button
          type="button"
          className="minimap-panel minimap-panel--collapsed"
          onClick={() => setCollapsed(false)}
          aria-label="Show minimap"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect
              x="1"
              y="1"
              width="14"
              height="14"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <rect x="3" y="3" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.4" />
            <rect x="9" y="5" width="4" height="5" rx="0.5" fill="currentColor" opacity="0.4" />
            <rect x="4" y="9" width="6" height="4" rx="0.5" fill="currentColor" opacity="0.4" />
          </svg>
        </button>
      </Tooltip>
    );
  }

  const nodeCount = scene.entries.length;
  const outlierCount = scene.outliers.length;

  return (
    <section
      ref={containerRef}
      className="minimap-panel"
      aria-label={`Minimap: ${nodeCount} objects`}
    >
      <div className="minimap-panel__header">
        <Tooltip label="Hide minimap">
          <button
            type="button"
            className="minimap-panel__collapse-btn"
            onClick={() => setCollapsed(true)}
            aria-label="Hide minimap"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M3 4.5L6 7.5L9 4.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </Tooltip>
        <span className="minimap-panel__title">
          {nodeCount} object{nodeCount !== 1 ? 's' : ''}
          {outlierCount > 0 && (
            <Tooltip label={`${outlierCount} outlier(s) excluded from overview`}>
              <span className="minimap-panel__outlier-badge">
                {' '}
                {outlierCount} outlier{outlierCount !== 1 ? 's' : ''}
              </span>
            </Tooltip>
          )}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="minimap-panel__canvas"
        width={mmSize.width}
        height={mmSize.height}
        tabIndex={0}
        role="img"
        aria-label={`Document minimap showing ${nodeCount} objects. Use arrow keys to pan, Enter to fit all.`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
      />
    </section>
  );
}
