/**
 * MinimapPanel — interactive canvas minimap for document navigation.
 *
 * The minimap is a projection of the live editor surface. Its scene is
 * document-derived, its viewport footprint is camera-derived, and its
 * navigation uses the explicitly supplied canvas owner rather than a global
 * DOM selector. Artwork, selection, history, and dirty state are never
 * mutated by minimap interaction.
 */

import { Tooltip } from '@varve/ui';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useEditor } from '../../context';
import {
  buildMinimapScene,
  computeMinimapSize,
  computeMinimapTransform,
  computeViewportMinimapFootprint,
  computeViewportWorldCenter,
  type MinimapFootprint,
  type MinimapTransform,
  minimapToWorld,
  panForViewportCenter,
  pointInMinimapFootprint,
} from './minimapLayout';
import type { MinimapColors } from './minimapRenderer';
import { renderMinimapToCanvas, resolveMinimapColors } from './minimapRenderer';
import './minimap.css';

interface MinimapPanelProps {
  /** The actual `.editor-canvas` element that owns the viewport. */
  canvasOwnerRef?: RefObject<HTMLElement | null>;
}

interface PanelMeasurement {
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}

interface DragState {
  pointerId: number;
  transform: MinimapTransform;
  viewport: { width: number; height: number };
  offset: [number, number];
}

/** Resolve CSS variable with fallback. */
function resolveCssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return val || fallback;
}

function measuredSize(element: HTMLElement | null): { width: number; height: number } {
  if (!element) return { width: 0, height: 0 };
  const rect = element.getBoundingClientRect();
  return {
    width: element.clientWidth || rect.width || 0,
    height: element.clientHeight || rect.height || 0,
  };
}

function isUsableViewport(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
}

function pointerToMinimap(
  event: ReactPointerEvent<HTMLCanvasElement>,
  transform: MinimapTransform,
): { x: number; y: number } | null {
  const rect = event.currentTarget.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    x: ((event.clientX - rect.left) / rect.width) * transform.mmWidth,
    y: ((event.clientY - rect.top) / rect.height) * transform.mmHeight,
  };
}

function releasePointerCapture(canvas: HTMLCanvasElement | null, pointerId: number): void {
  if (!canvas?.releasePointerCapture) return;
  try {
    canvas.releasePointerCapture(pointerId);
  } catch {
    // The browser may already have released capture during cancellation.
  }
}

export function MinimapPanel({ canvasOwnerRef }: MinimapPanelProps) {
  const editor = useEditor();
  const minimapVisible = (editor.state as typeof editor.state & { minimapVisible?: boolean })
    .minimapVisible;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [measurement, setMeasurement] = useState<PanelMeasurement>({
    width: 0,
    height: 0,
    viewportWidth: 0,
    viewportHeight: 0,
  });

  const measure = useCallback(() => {
    const container = containerRef.current;
    const owner = canvasOwnerRef?.current;
    const panel = measuredSize(container);
    const available = measuredSize(container?.parentElement ?? container);
    const viewport = measuredSize(owner ?? null);
    setMeasurement((previous) => {
      const next = {
        width: panel.width,
        height: available.height,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
      };
      return previous.width === next.width &&
        previous.height === next.height &&
        previous.viewportWidth === next.viewportWidth &&
        previous.viewportHeight === next.viewportHeight
        ? previous
        : next;
    });
  }, [canvasOwnerRef]);

  // Observe both the minimap's layout slot and the real canvas owner. This
  // catches sidebars, timeline, display, and window changes even when the
  // window itself did not resize. Zero-size states are recorded as zero.
  useEffect(() => {
    measure();
    const observed = [
      containerRef.current,
      containerRef.current?.parentElement,
      canvasOwnerRef?.current,
    ].filter(
      (element, index, all): element is HTMLElement =>
        Boolean(element) && all.indexOf(element) === index,
    );
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            measure();
          });
    for (const element of observed) observer?.observe(element);

    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
  }, [canvasOwnerRef, collapsed, measure]);

  const selectedIds = useMemo(() => new Set(editor.state.selection), [editor.state.selection]);
  const designCanvasId =
    editor.state.workspaceMode === 'print'
      ? null
      : (editor.state.document.activeDesignCanvasId ?? null);
  const scene = useMemo(
    () =>
      buildMinimapScene(editor.state.document, selectedIds, {
        scope: 'canvas',
        designCanvasId,
      }),
    [editor.state.document, selectedIds, designCanvasId],
  );

  const maxWidth =
    measurement.width > 0 ? Math.max(40, Math.min(160, measurement.width - 16)) : 160;
  const maxHeight =
    measurement.height > 0 ? Math.max(30, Math.min(120, measurement.height * 0.3)) : 120;
  const mmSize = useMemo(
    () => computeMinimapSize(scene.contentBounds, maxWidth, maxHeight),
    [scene.contentBounds, maxHeight, maxWidth],
  );
  const transform = useMemo(
    () => computeMinimapTransform(scene.contentBounds, mmSize.width, mmSize.height),
    [scene.contentBounds, mmSize],
  );

  const colors: MinimapColors = useMemo(
    () => resolveMinimapColors(resolveCssVar),
    [editor.state.themeRevision],
  );
  const camera = useMemo(
    () => ({
      pan: editor.state.pan,
      zoom: editor.state.zoom,
      rotation: editor.state.cameraRotation ?? 0,
    }),
    [editor.state.cameraRotation, editor.state.pan, editor.state.zoom],
  );
  const viewport = useMemo(() => {
    if (!isUsableViewport(measurement.viewportWidth, measurement.viewportHeight)) return null;
    return { width: measurement.viewportWidth, height: measurement.viewportHeight };
  }, [measurement.viewportHeight, measurement.viewportWidth]);
  const viewportFootprint: MinimapFootprint | null = useMemo(
    () => (viewport ? computeViewportMinimapFootprint(camera, viewport, transform) : null),
    [camera, transform, viewport],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderMinimapToCanvas(canvas, scene, transform, viewportFootprint, colors);
  }, [colors, scene, transform, viewportFootprint]);

  useLayoutEffect(() => {
    if (minimapVisible !== false) draw();
  }, [draw, minimapVisible]);

  const navigateToWorld = useCallback(
    (world: [number, number], navigationViewport: { width: number; height: number }) => {
      if (!isUsableViewport(navigationViewport.width, navigationViewport.height)) return;
      const pan = panForViewportCenter(camera, navigationViewport, world);
      if (Number.isFinite(pan.x) && Number.isFinite(pan.y)) editor.setPan(pan);
    },
    [camera, editor],
  );

  const endDrag = useCallback((pointerId?: number) => {
    const drag = dragRef.current;
    if (!drag || (pointerId !== undefined && pointerId !== drag.pointerId)) return;
    releasePointerCapture(canvasRef.current, drag.pointerId);
    dragRef.current = null;
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (event.button !== 0 || !viewport) return;
      const mm = pointerToMinimap(event, transform);
      if (!mm) return;
      const world = minimapToWorld(mm.x, mm.y, transform);
      const center = computeViewportWorldCenter(camera, viewport);
      const inside = viewportFootprint
        ? pointInMinimapFootprint([mm.x, mm.y], viewportFootprint)
        : false;
      const offset: [number, number] = inside ? [world.x - center[0], world.y - center[1]] : [0, 0];
      dragRef.current = { pointerId: event.pointerId, transform, viewport, offset };
      event.preventDefault();
      event.stopPropagation();
      navigateToWorld([world.x - offset[0], world.y - offset[1]], viewport);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is unavailable in some test/browser embeddings;
        // the drag still works while the pointer remains over the canvas.
      }
    },
    [camera, navigateToWorld, transform, viewport, viewportFootprint],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const mm = pointerToMinimap(event, drag.transform);
      if (!mm) return;
      const world = minimapToWorld(mm.x, mm.y, drag.transform);
      event.preventDefault();
      event.stopPropagation();
      navigateToWorld([world.x - drag.offset[0], world.y - drag.offset[1]], drag.viewport);
    },
    [navigateToWorld],
  );

  useEffect(() => {
    const cancel = () => endDrag();
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') cancel();
    };
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      cancel();
    };
  }, [endDrag]);

  // A document/workspace switch must not leave a pointer session from the
  // previous surface applying camera writes to the new one.
  useEffect(() => {
    endDrag();
  }, [editor.state.activeId, editor.state.document.id, editor.state.workspaceMode, endDrag]);

  const panByScreen = useCallback(
    (dx: number, dy: number) => {
      if (typeof editor.panBy === 'function') {
        editor.panBy(dx, dy);
      } else {
        editor.setPan({ x: editor.state.pan.x + dx, y: editor.state.pan.y + dy });
      }
    },
    [editor],
  );

  const handleDoubleClick = useCallback(() => {
    if (scene.entries.length > 0 || scene.pages.length > 0) editor.fitAll();
  }, [editor, scene.entries.length, scene.pages.length]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          panByScreen(50, 0);
          break;
        case 'ArrowRight':
          event.preventDefault();
          panByScreen(-50, 0);
          break;
        case 'ArrowUp':
          event.preventDefault();
          panByScreen(0, 50);
          break;
        case 'ArrowDown':
          event.preventDefault();
          panByScreen(0, -50);
          break;
        case 'Enter':
        case ' ':
        case 'Home':
          event.preventDefault();
          editor.fitAll();
          break;
        case 'Escape':
          event.preventDefault();
          endDrag();
          setCollapsed(true);
          break;
      }
    },
    [editor, endDrag, panByScreen],
  );

  if (minimapVisible === false) return null;

  const nodeCount = scene.entries.length;
  const outlierCount = scene.outliers.length;
  const pageCount = scene.pages.length;

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

  return (
    <section
      ref={containerRef}
      className="minimap-panel"
      data-testid="minimap-panel"
      aria-label={`Minimap: ${nodeCount} objects${pageCount ? `, ${pageCount} pages` : ''}`}
    >
      <div className="minimap-panel__header">
        <span className="minimap-panel__title">
          {nodeCount} object{nodeCount !== 1 ? 's' : ''}
          {pageCount > 0 && ` · ${pageCount} page${pageCount !== 1 ? 's' : ''}`}
          {outlierCount > 0 && (
            <Tooltip
              label={`${outlierCount} exceptional object(s) remain included in the overview`}
            >
              <span className="minimap-panel__outlier-badge"> {outlierCount} flagged</span>
            </Tooltip>
          )}
        </span>
        <button
          type="button"
          className="minimap-panel__fit-btn"
          onClick={handleDoubleClick}
          aria-label="Fit whole document in canvas"
        >
          Fit
        </button>
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
      </div>
      <canvas
        ref={canvasRef}
        className="minimap-panel__canvas"
        width={mmSize.width}
        height={mmSize.height}
        tabIndex={0}
        role="img"
        aria-label={`Document minimap showing ${nodeCount} objects. Click or drag to navigate; double-click or press Enter to fit the whole document; arrow keys pan.`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => endDrag(event.pointerId)}
        onPointerCancel={(event) => endDrag(event.pointerId)}
        onLostPointerCapture={() => endDrag()}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
      />
    </section>
  );
}
