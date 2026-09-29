/**
 * MinimapPanel — interactive canvas minimap for document navigation.
 *
 * The minimap is a projection of the live editor surface. Its scene is
 * document-derived, its viewport footprint is camera-derived, and its
 * navigation uses the explicitly supplied canvas owner rather than a global
 * DOM selector. Artwork, selection, history, and dirty state are never
 * mutated by minimap interaction.
 *
 * Design contract (2026-09-29)
 * ---------------------------
 * - **One control per job.** The overview does not own a "Fit" button: fitting
 *   is a canvas command with three better-known homes (the StatusBar Fit
 *   group, the View menu, and the documented double-click / Enter / Home
 *   gesture on the map itself). A fourth, smaller copy of the same command in
 *   a 12 px header was redundancy, not reachability.
 * - **The card must not claim space it does not use.** The canvas fills the
 *   card width and takes its height from the content aspect, so the panel's
 *   border matches what is painted inside it.
 * - **Honest states.** With no measured viewport there is nothing to navigate,
 *   so the map reports that instead of looking interactive and doing nothing;
 *   an empty surface says so instead of showing a blank tile.
 * - **Theme-correct pixels.** Colors are re-resolved whenever the resolved
 *   theme changes through any writer, not only when React changed it.
 */

import { getFontRegistry } from '@varve/engine';
import { resolveEditorSceneScope } from '@varve/scene';
import { Tooltip } from '@varve/ui';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useEditor } from '../../context';
import {
  buildMinimapScene,
  clipFootprintToStage,
  computeMinimapSize,
  computeMinimapTransform,
  computeViewportMinimapFootprint,
  computeViewportWorldCenter,
  expandFootprintForHitTest,
  type MinimapFootprint,
  type MinimapTransform,
  minimapToWorld,
  panForViewportCenter,
  pointInMinimapFootprint,
} from './minimapLayout';
import type { MinimapColors, MinimapViewfinderState } from './minimapRenderer';
import { renderMinimapToCanvas, resolveMinimapColors } from './minimapRenderer';
import './minimap.css';

interface MinimapPanelProps {
  /** The actual `.editor-canvas` element that owns the viewport. */
  canvasOwnerRef?: RefObject<HTMLElement | null>;
}

interface PanelMeasurement {
  /** Available width for the map stage, from the stage's own content box. */
  stageWidth: number;
  /** Vertical space the rail can spare for the map. */
  availableHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

interface DragState {
  pointerId: number;
  transform: MinimapTransform;
  viewport: { width: number; height: number };
  offset: [number, number];
}

/**
 * Stage width used before the first measurement lands. Only a fallback: once
 * measured, the map always fills its stage, because a fixed ceiling made a
 * wide sidebar host a wide well with a narrow map centred inside it.
 */
const FALLBACK_STAGE_WIDTH = 240;
/** Tallest map stage as a fraction of the space the rail can spare. */
const MAX_STAGE_HEIGHT_FRACTION = 0.24;
/** Hard ceiling for the map stage height, in CSS px. */
const MAX_STAGE_HEIGHT = 168;
/** Floor for the map stage height, in CSS px. */
const MIN_STAGE_HEIGHT_GUARD = 48;
/** Keyboard pan step, in screen (CSS) pixels — it models the user's hand. */
const KEYBOARD_PAN_STEP = 50;

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

/**
 * Nearest ancestor that actually has a layout box.
 *
 * The panel sits inside an `<ErrorBoundary>` wrapper that is
 * `display: contents` (see AGENTS.md — the wrapper exists so the panel can be
 * a grid/flex item without adding a box). That wrapper therefore reports a
 * zero size, which silently zeroed every available-height budget and left the
 * map sizing to its hard ceiling. Walk up to the first ancestor with a box.
 */
function nearestMeasuredAncestor(element: HTMLElement | null): HTMLElement | null {
  let node = element?.parentElement ?? null;
  while (node) {
    const size = measuredSize(node);
    if (size.width > 0 && size.height > 0) return node;
    node = node.parentElement;
  }
  return null;
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

/**
 * A revision counter for the *resolved* theme.
 *
 * `editor.state.themeRevision` only moves when React changed the theme. The
 * resolved palette can also change from outside React — the OS colour scheme
 * or contrast preference under a `system` preference, a storage event in
 * another window, or a direct `applyThemePreference` call. Watching the
 * `data-theme` attribute plus both media queries keeps the canvas pixels in
 * step with the CSS the rest of the panel is painted with; without it the map
 * kept light-theme tokens under a dark panel.
 */
function useResolvedThemeRevision(existingRevision: number): number {
  const [externalRevision, setExternalRevision] = useState(0);
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    const root = document.documentElement;
    let lastTheme = root.dataset.theme ?? '';
    const observer = new MutationObserver(() => {
      const next = root.dataset.theme ?? '';
      if (next === lastTheme) return;
      lastTheme = next;
      setExternalRevision((revision) => revision + 1);
    });
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });

    const mediaQueries =
      typeof window.matchMedia === 'function'
        ? [
            window.matchMedia('(prefers-color-scheme: dark)'),
            window.matchMedia('(prefers-contrast: more)'),
          ]
        : [];
    const onMediaChange = () => setExternalRevision((revision) => revision + 1);
    for (const query of mediaQueries) query.addEventListener('change', onMediaChange);

    return () => {
      observer.disconnect();
      for (const query of mediaQueries) query.removeEventListener('change', onMediaChange);
    };
  }, []);
  return existingRevision + externalRevision;
}

export function MinimapPanel({ canvasOwnerRef }: MinimapPanelProps) {
  const editor = useEditor();
  const minimapVisible = (editor.state as typeof editor.state & { minimapVisible?: boolean })
    .minimapVisible;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [measurement, setMeasurement] = useState<PanelMeasurement>({
    stageWidth: 0,
    availableHeight: 0,
    viewportWidth: 0,
    viewportHeight: 0,
  });

  const measure = useCallback(() => {
    const container = containerRef.current;
    const owner = canvasOwnerRef?.current;
    // The stage's content box is the real budget for the canvas: measuring the
    // panel instead meant guessing at padding and border, which left the map a
    // few pixels short of the stage it sits in.
    const stage = measuredSize(stageRef.current);
    const available = measuredSize(nearestMeasuredAncestor(container));
    const viewport = measuredSize(owner ?? null);
    setMeasurement((previous) => {
      const next = {
        stageWidth: stage.width,
        availableHeight: available.height,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
      };
      return previous.stageWidth === next.stageWidth &&
        previous.availableHeight === next.availableHeight &&
        previous.viewportWidth === next.viewportWidth &&
        previous.viewportHeight === next.viewportHeight
        ? previous
        : next;
    });
  }, [canvasOwnerRef]);

  // Observe the minimap's layout slot, its map stage, and the real canvas
  // owner. This catches sidebars, timeline, display, and window changes even
  // when the window itself did not resize. Zero-size states are recorded as
  // zero rather than replaced with a guess.
  useEffect(() => {
    measure();
    const observed = [
      containerRef.current,
      stageRef.current,
      nearestMeasuredAncestor(containerRef.current),
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

  // Measure before the browser paints, not after: the stage width decides the
  // canvas size, so measuring in an effect would leave the first painted frame
  // sized from a fallback.
  useLayoutEffect(() => {
    measure();
  }, [collapsed, measure]);

  // Collapsing unmounts the canvas without a pointerleave, which would leave
  // the outline in its strong state when the panel is reopened elsewhere.
  useEffect(() => {
    setHovering(false);
  }, [collapsed]);

  const selectedIds = useMemo(() => new Set(editor.state.selection), [editor.state.selection]);
  const geometryRevision = getFontRegistry().revision;
  // Deferred: the overview does not need every frame of a drag, and
  // rebuilding its scene walked the whole document per frame. React renders
  // it after the urgent frame and converges on the current document.
  const minimapDocument = useDeferredValue(editor.state.document);
  const sceneScope = useMemo(
    () =>
      resolveEditorSceneScope(minimapDocument, {
        workspaceMode: editor.state.workspaceMode,
        activePageId: minimapDocument.activePageId ?? null,
        activeDesignCanvasId: minimapDocument.activeDesignCanvasId ?? null,
        masterEditId: editor.state.masterEditId,
        isolatedNodeId: editor.state.isolatedNodeId,
      }),
    [
      minimapDocument,
      editor.state.isolatedNodeId,
      editor.state.masterEditId,
      editor.state.workspaceMode,
    ],
  );
  const scene = useMemo(
    () =>
      buildMinimapScene(minimapDocument, selectedIds, {
        scope: 'canvas',
        sceneScope,
        geometryRevision,
      }),
    [geometryRevision, minimapDocument, sceneScope, selectedIds],
  );

  // The map always fills its stage. A fixed width ceiling reintroduced the
  // original defect on wide rails: a wide well with a narrow map centred
  // inside it. Height stays bounded — that is what keeps the panel from
  // eating the Layers list — and the backplate a wide well adds around a
  // short document is the same tone as the canvas, so it reads as pasteboard
  // rather than as an unused region.
  const stageWidth = measurement.stageWidth > 0 ? measurement.stageWidth : FALLBACK_STAGE_WIDTH;
  const stageMaxHeight =
    measurement.availableHeight > 0
      ? Math.max(
          MIN_STAGE_HEIGHT_GUARD,
          Math.min(MAX_STAGE_HEIGHT, measurement.availableHeight * MAX_STAGE_HEIGHT_FRACTION),
        )
      : MAX_STAGE_HEIGHT;
  const mmSize = useMemo(
    () => computeMinimapSize(scene.contentBounds, stageWidth, stageMaxHeight),
    [scene.contentBounds, stageMaxHeight, stageWidth],
  );
  const transform = useMemo(
    () => computeMinimapTransform(scene.contentBounds, mmSize.width, mmSize.height),
    [scene.contentBounds, mmSize],
  );

  const themeRevision = useResolvedThemeRevision(editor.state.themeRevision);
  const colors: MinimapColors = useMemo(() => resolveMinimapColors(resolveCssVar), [themeRevision]);
  const labelFont = useMemo(() => resolveCssVar('--font-body', 'sans-serif'), [themeRevision]);
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
  // The polygon the pointer actually steers: the drawn minimum-size
  // rectangle plus a tolerance (so a small viewfinder is still easy to grab),
  // clipped to the stage so it matches what is painted rather than extending
  // into the off-stage region the chevron already points at.
  const interactionFootprint: MinimapFootprint | null = useMemo(() => {
    if (!viewportFootprint) return null;
    return clipFootprintToStage(
      expandFootprintForHitTest(viewportFootprint),
      mmSize.width,
      mmSize.height,
    );
  }, [mmSize.height, mmSize.width, viewportFootprint]);

  const viewfinderState: MinimapViewfinderState = dragging ? 'drag' : hovering ? 'hover' : 'idle';
  const navigable = viewport !== null;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderMinimapToCanvas(canvas, scene, transform, viewportFootprint, colors, {
      labelFont,
      viewfinder: viewfinderState,
    });
  }, [colors, labelFont, scene, transform, viewfinderState, viewportFootprint]);

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
    setDragging(false);
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (event.button !== 0 || !viewport) return;
      const mm = pointerToMinimap(event, transform);
      if (!mm) return;
      const world = minimapToWorld(mm.x, mm.y, transform);
      const center = computeViewportWorldCenter(camera, viewport);
      const inside = interactionFootprint
        ? pointInMinimapFootprint([mm.x, mm.y], interactionFootprint)
        : false;
      const offset: [number, number] = inside ? [world.x - center[0], world.y - center[1]] : [0, 0];
      dragRef.current = { pointerId: event.pointerId, transform, viewport, offset };
      event.preventDefault();
      event.stopPropagation();
      // A press proves the pointer is over the map: remember it so the
      // outline stays in its strong state through release.
      setHovering(true);
      setDragging(true);
      navigateToWorld([world.x - offset[0], world.y - offset[1]], viewport);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is unavailable in some test/browser embeddings;
        // the drag still works while the pointer remains over the canvas.
      }
    },
    [camera, interactionFootprint, navigateToWorld, transform, viewport],
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

  const fitAll = useCallback(() => {
    if (scene.entries.length > 0 || scene.pages.length > 0) editor.fitAll();
  }, [editor, scene.entries.length, scene.pages.length]);

  // Exceptional scale is not a diagnosis to read, it is a place to go: a
  // single stray object far from the artwork is what makes an overview
  // useless (the recurring Miro / QGIS / Illustrator "my map is a tiny
  // smudge" report). The badge therefore reveals the offending object
  // instead of only counting it.
  const revealFirstOutlier = useCallback(() => {
    const target = scene.outliers[0];
    if (!target) return;
    editor.revealSelection({ nodeId: target.nodeId ?? target.id, behavior: 'reveal' });
  }, [editor, scene.outliers]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          panByScreen(KEYBOARD_PAN_STEP, 0);
          break;
        case 'ArrowRight':
          event.preventDefault();
          panByScreen(-KEYBOARD_PAN_STEP, 0);
          break;
        case 'ArrowUp':
          event.preventDefault();
          panByScreen(0, KEYBOARD_PAN_STEP);
          break;
        case 'ArrowDown':
          event.preventDefault();
          panByScreen(0, -KEYBOARD_PAN_STEP);
          break;
        case 'Enter':
        case ' ':
        case 'Home':
          event.preventDefault();
          fitAll();
          break;
        case 'Escape':
          event.preventDefault();
          endDrag();
          setCollapsed(true);
          break;
      }
    },
    [endDrag, fitAll, panByScreen],
  );

  const toggleLeftPanel = editor.toggleLeftPanel;

  const collapseButton = toggleLeftPanel ? (
    <Tooltip label="Collapse Layers panel (Ctrl+B)">
      <button
        type="button"
        className="editor__collapse-btn"
        onClick={() => toggleLeftPanel()}
        aria-label="Collapse Layers panel (Ctrl+B)"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect
            x="2"
            y="2"
            width="12"
            height="12"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.25"
            fill="none"
          />
          <rect x="2" y="2" width="4" height="12" rx="1.5" fill="currentColor" fillOpacity="0.25" />
          <line x1="6" y1="2" x2="6" y2="14" stroke="currentColor" strokeWidth="1.25" />
          <path
            d="M11.5 6L9.5 8L11.5 10"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </Tooltip>
  ) : null;

  if (minimapVisible === false) {
    return (
      <div className="editor__panel-header editor__panel-header--left">
        <span className="editor__panel-title">Layers</span>
        {collapseButton}
      </div>
    );
  }

  const nodeCount = scene.entries.length;
  const pageCount = scene.pages.length;
  const outlierCount = scene.outliers.length;
  const surfaceEmpty = nodeCount === 0 && pageCount === 0;
  const objectLabel = `${nodeCount} object${nodeCount !== 1 ? 's' : ''}`;
  const pageLabel = pageCount > 0 ? `, ${pageCount} page${pageCount !== 1 ? 's' : ''}` : '';
  const mapDescription = !navigable
    ? `Document minimap of ${objectLabel}${pageLabel}. Navigation is unavailable until the canvas has a measurable size.`
    : `Document minimap of ${objectLabel}${pageLabel}. Click or drag to navigate; double-click or press Enter to fit the whole document; arrow keys pan.`;

  if (collapsed) {
    return (
      <div className="minimap-panel--collapsed-wrapper">
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
        {collapseButton}
      </div>
    );
  }

  return (
    <section
      ref={containerRef}
      id="minimap-panel"
      className="minimap-panel"
      data-testid="minimap-panel"
      data-surface-key={scene.surfaceKey}
      data-navigable={navigable || undefined}
      data-dragging={dragging || undefined}
      aria-label={`Minimap: ${objectLabel}${pageLabel}`}
    >
      <div className="minimap-panel__header">
        <span className="minimap-panel__title">
          {objectLabel}
          {pageLabel}
        </span>
        {outlierCount > 0 && (
          <Tooltip
            label={`Reveal the exceptional object making this overview small (${outlierCount} flagged)`}
          >
            <button
              type="button"
              className="minimap-panel__outlier-btn"
              onClick={revealFirstOutlier}
              aria-label={`Reveal the exceptional object making this overview small. ${outlierCount} flagged.`}
            >
              {outlierCount} flagged
            </button>
          </Tooltip>
        )}
        <Tooltip label="Hide minimap (Ctrl+Shift+M)">
          <button
            type="button"
            className="minimap-panel__collapse-btn"
            aria-expanded
            aria-controls="minimap-panel"
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
        {collapseButton}
      </div>
      <div className="minimap-panel__stage" ref={stageRef} data-empty={surfaceEmpty || undefined}>
        <canvas
          ref={canvasRef}
          className="minimap-panel__canvas"
          data-navigable={navigable || undefined}
          width={mmSize.width}
          height={mmSize.height}
          tabIndex={0}
          role="img"
          aria-label={mapDescription}
          onPointerEnter={() => setHovering(true)}
          onPointerLeave={() => setHovering(false)}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => endDrag(event.pointerId)}
          onPointerCancel={(event) => endDrag(event.pointerId)}
          onLostPointerCapture={() => endDrag()}
          onDoubleClick={fitAll}
          onKeyDown={handleKeyDown}
        />
        {surfaceEmpty && (
          <p className="minimap-panel__empty">
            Nothing on this surface yet. Draw or place objects to build an overview.
          </p>
        )}
      </div>
    </section>
  );
}
