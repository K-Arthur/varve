/**
 * Input pipeline — pointer, keyboard, wheel, and touch-pinch handling
 * extracted from CanvasArea.  Encapsulates auto-pan, snap session state,
 * and two-finger pinch zoom/pan so CanvasArea's event handlers delegate
 * here instead of managing ~200 lines of inline state-machine logic.
 */

import type { NodeId, SceneNode } from '@varve/scene';
import type { Camera } from '@varve/shared';
import {
  clampZoom,
  computeFloatingOrigin,
  fitBoundsCamera,
  screenToWorld,
  zoomAboutPoint,
} from '@varve/shared';
import { type MutableRefObject, useCallback, useEffect, useRef } from 'react';
import type { CanvasMode, EditorState } from '../context/types';
import { physicalDigit } from '../input/physicalKey';
import { dispatchToTool, documentComplexityBucket } from '../performance/dispatchSpan';
import {
  beginInteraction,
  endInteraction,
  isInteractionTracingEnabled,
  recordInteractionSpan,
} from '../performance/interactionTrace';
import type { ToolContext, ToolManager } from '../tools';
import { computeEdgeVelocity } from '../tools/autoPan';
import { interactionSession } from '../tools/InteractionContext';
import {
  decayRateFromFrameRetention,
  frameDisplacementToVelocity,
  integrateVelocity,
  navigationFrameDeltaMs,
  prefersReducedNavigationMotion,
  stepDecayedMotion,
} from '../tools/navigationPhysics';
import type { SnapGuide } from '../tools/snapping';
import { createSnapSession } from '../tools/snapping';
import { recordInputDiagnostic } from './inputDiagnostics';
import {
  type NavigationGestureEvent,
  type NavigationGestureState,
  transitionNavigationState,
} from './navigationState';
import { cancelCanvasFrame, createCanvasFrameKey, scheduleCanvasFrame } from './perfRuntime';
import { resolveWheelAction } from './wheelClassifier';

export interface UseCanvasInputsOptions {
  contentCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  editor: {
    setCursorPos: (pos: { x: number; y: number } | null) => void;
    setPan: (pan: { x: number; y: number }) => void;
    /** Relative scroll; resolves against the newest pan, not a snapshot. */
    panBy: (dx: number, dy: number) => void;
    setSelection: (id: NodeId | null) => void;
    exitIsolation: () => void;
    announceOperation: (op: string, detail: string) => void;
    announceSelection: (nodes: SceneNode[]) => void;
    announce: (msg: string) => void;
    commitTransaction: () => void;
    hitTestNode: (world: { x: number; y: number }) => { node: SceneNode } | null;
    getWorldBounds: (id: NodeId) => { x: number; y: number; w: number; h: number } | null;
    revealSelection: (opts: { fit: boolean; viewport?: { width: number; height: number } }) => void;
    setCanvasMode?: (mode: CanvasMode) => void;
  };
  stateRef: MutableRefObject<EditorState>;
  tmRef: MutableRefObject<ToolManager | null>;
  buildToolCtx: (ev: PointerEvent) => ToolContext;
  commitCamera: (cam: Camera) => void;
  setSnapGuides: (guides: SnapGuide[]) => void;
  setHoveredNode: (node: SceneNode | null) => void;
  setRenameDialog: (v: { defaultValue: string } | null) => void;
  rootNodes: () => readonly SceneNode[];
  /** Shared snap session ref (from CanvasArea's buildToolCtx). If omitted, uses internal default. */
  snapSessionRef?: MutableRefObject<import('../tools/snapping').SnapSession>;
  snapIndexRef?: MutableRefObject<{
    index: unknown;
    parentIndex: Map<string, string>;
    documentId: string;
  } | null>;
}

export interface UseCanvasInputsResult {
  handlePointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  handlePointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  handlePointerUp: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  handlePointerCancel: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLCanvasElement>) => void;
  handleKeyUp: (e: React.KeyboardEvent<HTMLCanvasElement>) => void;
  handleDoubleClick: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onPointerLeave: () => void;
  onBlur: () => void;
  stopAutoPan: () => void;
}

export function useCanvasInputs({
  contentCanvasRef,
  editor,
  stateRef,
  tmRef,
  buildToolCtx,
  commitCamera,
  setSnapGuides,
  setHoveredNode,
  setRenameDialog,
  rootNodes,
  snapSessionRef: externalSnapSessionRef,
  snapIndexRef: externalSnapIndexRef,
}: UseCanvasInputsOptions): UseCanvasInputsResult {
  const touchPointers = useRef(new Map<number, { x: number; y: number }>());
  // Rate limiters for the expanded interaction traces (wheel / keyboard /
  // hover bursts) so instrumentation never alters behaviour.
  const lastWheelTraceAt = useRef(0);
  const lastKeyboardTraceAt = useRef(0);
  const lastHoverTraceAt = useRef(0);
  const pinchRef = useRef<{
    lastDist: number;
    lastCentroid: { x: number; y: number };
  } | null>(null);
  // Explicit navigation-gesture state machine (see navigationState.ts). Owns
  // the viewport-level pan/pinch transitions; tools own their own drag state.
  const navigationStateRef = useRef<NavigationGestureState>('idle');

  function advanceNavigation(event: NavigationGestureEvent): NavigationGestureState {
    const t = transitionNavigationState(navigationStateRef.current, event);
    navigationStateRef.current = t.next;
    return t.next;
  }

  function recordNavigationEvent(event: NavigationGestureEvent): void {
    recordInputDiagnostic({
      eventType: `nav:${event.type}`,
      source: 'unknown',
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      viewport: {
        zoom: stateRef.current.zoom,
        panX: stateRef.current.pan.x,
        panY: stateRef.current.pan.y,
        rotation: stateRef.current.cameraRotation,
      },
    });
  }

  function pinchGeometry() {
    const pts = [...touchPointers.current.values()];
    if (pts.length < 2) return null;
    const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
    return {
      dist: Math.hypot(b.x - a.x, b.y - a.y),
      centroid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }

  const autoPanFrameKey = useRef<string | null>(null);
  autoPanFrameKey.current ??= createCanvasFrameKey('auto-pan');
  const autoPanActive = useRef(false);
  const autoPanVelocity = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const autoPanFrameTime = useRef<number | null>(null);

  const stopAutoPan = useCallback(() => {
    const frameKey = autoPanFrameKey.current;
    if (frameKey) cancelCanvasFrame(frameKey);
    autoPanActive.current = false;
    autoPanVelocity.current = { x: 0, y: 0 };
    autoPanFrameTime.current = null;
  }, []);

  const internalSnapSessionRef = useRef(createSnapSession());
  const internalSnapIndexRef = useRef<{
    index: unknown;
    parentIndex: Map<string, string>;
    documentId: string;
  } | null>(null);
  const snapSessionForPointer = externalSnapSessionRef ?? internalSnapSessionRef;
  const snapIndexForPointer = externalSnapIndexRef ?? internalSnapIndexRef;
  const lastCursorUpdate = useRef(0);
  // Document size is O(n) to measure, so it is sampled once per gesture (only
  // while tracing) and reused for every event's dispatch attributes rather
  // than recomputed per pointermove.
  const gestureComplexity = useRef('unknown');

  const dispatchAttributes = useCallback(
    () => ({
      tool: stateRef.current.tool,
      docComplexity: gestureComplexity.current,
      selectionCount: stateRef.current.selection.length,
    }),
    [stateRef],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      beginInteraction('pointer-drag');
      gestureComplexity.current = isInteractionTracingEnabled()
        ? documentComplexityBucket(Object.keys(stateRef.current.document.nodes).length)
        : 'unknown';
      const ne = e.nativeEvent as PointerEvent;
      const tmInst = tmRef.current;
      if (!tmInst) return;
      const ctx = buildToolCtx(ne);

      e.currentTarget.focus({ preventScroll: true });

      if (e.pointerType === 'touch') {
        touchPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        advanceNavigation({
          type: 'pointer-down',
          pointerType: 'touch',
          pointerCount: touchPointers.current.size,
        });
        recordNavigationEvent({
          type: 'pointer-down',
          pointerType: 'touch',
          pointerCount: touchPointers.current.size,
        });
        if (touchPointers.current.size === 2) {
          tmInst.handlePointerCancel(ne, ctx);
          const geo = pinchGeometry();
          if (geo) pinchRef.current = { lastDist: geo.dist, lastCentroid: geo.centroid };
          if (isInteractionTracingEnabled()) beginInteraction('pinch');
          return;
        }
        if (touchPointers.current.size > 2) return;
      }

      if (e.button === 1) e.preventDefault();

      // B6: Intercept mouse side buttons (back=3, forward=4) to prevent
      // browser navigation while the canvas owns the interaction.
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        return;
      }

      snapSessionForPointer.current = createSnapSession();
      snapIndexForPointer.current = null;
      dispatchToTool('down', ne, dispatchAttributes(), () => {
        tmInst.handlePointerDown(ne, ctx);
      });
    },
    [tmRef, buildToolCtx, snapSessionForPointer, snapIndexForPointer, stateRef, dispatchAttributes],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const ne = e.nativeEvent as PointerEvent;
      const ctx = buildToolCtx(ne);

      if (e.pointerType === 'touch' && touchPointers.current.has(e.pointerId)) {
        touchPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        advanceNavigation({
          type: 'pointer-move',
          pointerType: 'touch',
          pointerCount: touchPointers.current.size,
        });
        const pinch = pinchRef.current;
        const geo = pinchGeometry();
        if (pinch && geo) {
          const s = stateRef.current;
          const rect = contentCanvasRef.current?.getBoundingClientRect();

          const panned = {
            x: s.pan.x + (geo.centroid.x - pinch.lastCentroid.x),
            y: s.pan.y + (geo.centroid.y - pinch.lastCentroid.y),
          };
          const cam = { pan: panned, zoom: s.zoom, rotation: s.cameraRotation };
          const viewport = {
            width: rect?.width ?? contentCanvasRef.current?.clientWidth ?? 1920,
            height: rect?.height ?? contentCanvasRef.current?.clientHeight ?? 1080,
          };
          const origin = computeFloatingOrigin(cam, viewport);
          const anchor = screenToWorld(
            cam,
            geo.centroid.x - (rect?.left ?? 0),
            geo.centroid.y - (rect?.top ?? 0),
            viewport,
            origin,
          );
          const factor = pinch.lastDist > 0 ? geo.dist / pinch.lastDist : 1;
          const newCam = zoomAboutPoint(cam, anchor, clampZoom(s.zoom * factor), viewport);
          commitCamera(newCam);
          pinchRef.current = { lastDist: geo.dist, lastCentroid: geo.centroid };
          return;
        }
      }

      const traceOn = isInteractionTracingEnabled();
      const traceStart = traceOn ? performance.now() : 0;
      // Hover-only movement is sampled at 800 ms so idle pointer motion does
      // not churn the trace ring while hover latency stays measurable.
      if (traceOn && e.buttons === 0 && traceStart - lastHoverTraceAt.current > 800) {
        lastHoverTraceAt.current = traceStart;
        beginInteraction('hover');
      }
      const traceFinish = () => {
        if (traceOn) {
          recordInteractionSpan('pointer.input', performance.now() - traceStart, {
            pointerType: e.pointerType,
            buttons: e.buttons,
          });
        }
      };

      const now = performance.now();
      if (now - lastCursorUpdate.current > 32) {
        lastCursorUpdate.current = now;
        const world = ctx.canvasToWorld(e.clientX, e.clientY);
        editor.setCursorPos(world);
      }

      const tmInst = tmRef.current;
      if (!tmInst) {
        traceFinish();
        return;
      }

      // Show hover preview for both select and inspect tools.
      // For other tools, keep the inspect-only behavior (or none at all).
      const isHoverableTool =
        stateRef.current.tool === 'select' || stateRef.current.tool === 'inspect';
      if (isHoverableTool) {
        const world = ctx.canvasToWorld(ne.clientX, ne.clientY);
        const hit = editor.hitTestNode(world);
        setHoveredNode(hit?.node ?? null);
      }

      dispatchToTool('move', ne, dispatchAttributes(), () => {
        tmInst.handlePointerMove(ne, ctx);
      });

      if (e.buttons !== 0) {
        const rect = contentCanvasRef.current?.getBoundingClientRect();
        if (rect) {
          const vx = computeEdgeVelocity(e.clientX, rect.left, rect.right);
          const vy = computeEdgeVelocity(e.clientY, rect.top, rect.bottom);
          autoPanVelocity.current = { x: vx, y: vy };
          if (vx !== 0 || vy !== 0) {
            if (!autoPanActive.current) {
              const frameKey = autoPanFrameKey.current;
              if (!frameKey) return;
              autoPanActive.current = true;
              const tick = (frameTimeMs: number) => {
                const v = autoPanVelocity.current;
                if (v.x === 0 && v.y === 0) {
                  stopAutoPan();
                  return;
                }
                const elapsedMs = navigationFrameDeltaMs(autoPanFrameTime.current, frameTimeMs);
                autoPanFrameTime.current = frameTimeMs;
                const delta = integrateVelocity(
                  {
                    x: frameDisplacementToVelocity(v.x),
                    y: frameDisplacementToVelocity(v.y),
                  },
                  elapsedMs,
                );
                editor.panBy(delta.x, delta.y);
                scheduleCanvasFrame(frameKey, 'input', tick);
              };
              scheduleCanvasFrame(frameKey, 'input', tick);
            }
          } else {
            stopAutoPan();
          }
        }
      } else {
        stopAutoPan();
      }
      traceFinish();
    },
    [
      tmRef,
      stateRef,
      contentCanvasRef,
      editor,
      commitCamera,
      buildToolCtx,
      setHoveredNode,
      stopAutoPan,
      dispatchAttributes,
    ],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      stopAutoPan();
      setSnapGuides([]);
      if (e.pointerType === 'touch') {
        const wasPinching = pinchRef.current !== null;
        touchPointers.current.delete(e.pointerId);
        advanceNavigation({
          type: 'pointer-up',
          pointerType: 'touch',
          pointerCount: touchPointers.current.size,
        });
        if (touchPointers.current.size < 2) pinchRef.current = null;
        if (wasPinching) return;
      }
      const ne = e.nativeEvent as PointerEvent;
      const tmInst = tmRef.current;
      if (!tmInst) {
        endInteraction();
        return;
      }
      const upCtx = buildToolCtx(ne);
      dispatchToTool('up', ne, dispatchAttributes(), () => {
        tmInst.handlePointerUp(ne, upCtx);
      });
      endInteraction();
    },
    [tmRef, stopAutoPan, setSnapGuides, buildToolCtx, dispatchAttributes],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      stopAutoPan();
      if (e.pointerType === 'touch') {
        touchPointers.current.delete(e.pointerId);
        if (touchPointers.current.size < 2) pinchRef.current = null;
      }
      advanceNavigation({ type: 'pointer-cancel' });
      const ne = e.nativeEvent as PointerEvent;
      tmRef.current?.handlePointerCancel(ne, buildToolCtx(ne));
      setSnapGuides([]);
      endInteraction();
    },
    [tmRef, stopAutoPan, setSnapGuides, buildToolCtx],
  );

  useEffect(() => {
    const el = contentCanvasRef.current;
    if (!el) return;

    const zoomAboutClientPoint = (clientX: number, clientY: number, newZoom: number): void => {
      const s = stateRef.current;
      const rect = el.getBoundingClientRect();
      const viewport = { width: rect.width, height: rect.height };
      const cam = { pan: s.pan, zoom: s.zoom, rotation: s.cameraRotation };
      const origin = computeFloatingOrigin(cam, viewport);
      const anchor = screenToWorld(cam, clientX - rect.left, clientY - rect.top, viewport, origin);
      const newCam = zoomAboutPoint(cam, anchor, clampZoom(newZoom), viewport);
      commitCamera(newCam);
    };

    const inertiaRef = { current: { vx: 0, vy: 0, active: false } };
    const inertiaFrameKey = createCanvasFrameKey('wheel-inertia');
    const inertiaDecayRate = decayRateFromFrameRetention(0.9);
    const inertiaStopSpeed = frameDisplacementToVelocity(0.5);
    let inertiaFrameTime: number | null = null;

    function startInertia() {
      if (inertiaRef.current.active) return;
      if (prefersReducedNavigationMotion()) {
        inertiaRef.current.vx = 0;
        inertiaRef.current.vy = 0;
        return;
      }
      inertiaRef.current.active = true;
      inertiaFrameTime = null;
      const tick = (frameTimeMs: number) => {
        const v = inertiaRef.current;
        const elapsedMs = navigationFrameDeltaMs(inertiaFrameTime, frameTimeMs);
        inertiaFrameTime = frameTimeMs;
        const step = stepDecayedMotion(
          { x: v.vx, y: v.vy },
          elapsedMs,
          inertiaDecayRate,
          inertiaStopSpeed,
        );
        if (step.stopped) {
          v.active = false;
          v.vx = 0;
          v.vy = 0;
          return;
        }
        // Relative, so a frame that runs before React commits the previous
        // step still advances the scroll instead of re-applying it.
        editor.panBy(step.delta.x, step.delta.y);
        v.vx = step.velocity.x;
        v.vy = step.velocity.y;
        scheduleCanvasFrame(inertiaFrameKey, 'input', tick);
      };
      scheduleCanvasFrame(inertiaFrameKey, 'input', tick);
    }

    function cancelInertia() {
      cancelCanvasFrame(inertiaFrameKey);
      inertiaRef.current.active = false;
      inertiaRef.current.vx = 0;
      inertiaRef.current.vy = 0;
      inertiaFrameTime = null;
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const started = performance.now();
      if (isInteractionTracingEnabled() && started - lastWheelTraceAt.current > 150) {
        beginInteraction('wheel');
      }
      lastWheelTraceAt.current = started;
      const s = stateRef.current;
      const action = resolveWheelAction({
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        clientHeight: el.clientHeight,
      });
      advanceNavigation({ type: 'wheel', zoom: action.kind === 'zoom' });
      recordInputDiagnostic({
        eventType: 'wheel',
        source: action.source === 'trackpad' ? 'trackpad' : 'wheel',
        modifiers: { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey },
        wheel: {
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaMode: e.deltaMode,
          source: action.source,
          kind: action.kind,
          scale: action.scale,
        },
        viewport: { zoom: s.zoom, panX: s.pan.x, panY: s.pan.y, rotation: s.cameraRotation },
        processingMs: performance.now() - started,
        preventedDefault: true,
      });
      if (action.kind === 'zoom') {
        zoomAboutClientPoint(e.clientX, e.clientY, s.zoom * action.scale);
        cancelInertia();
        return;
      }
      // Relative pan: several wheel events can be delivered in one task, all
      // before React commits. Resolving each against `s.pan` would make every
      // event in the burst compute the same destination, dropping all but the
      // last delta and making a fast scroll travel a fraction of its distance.
      if (action.shiftHeld) {
        editor.panBy(action.deltaX, 0);
        cancelInertia();
        return;
      }
      editor.panBy(action.deltaX, action.deltaY);
      if (action.applyInertia) {
        // Cancel the previously scheduled continuation before replacing its
        // velocity. `cancelInertia` also zeros the stored velocity, so doing
        // this after assignment would silently disable wheel inertia.
        const previousVx = inertiaRef.current.vx;
        const previousVy = inertiaRef.current.vy;
        cancelInertia();
        inertiaRef.current.vx = previousVx * 0.4 + frameDisplacementToVelocity(action.deltaX) * 0.6;
        inertiaRef.current.vy = previousVy * 0.4 + frameDisplacementToVelocity(action.deltaY) * 0.6;
        const maxV = frameDisplacementToVelocity(80);
        inertiaRef.current.vx = Math.max(-maxV, Math.min(maxV, inertiaRef.current.vx));
        inertiaRef.current.vy = Math.max(-maxV, Math.min(maxV, inertiaRef.current.vy));
        startInertia();
      } else {
        // Trackpad input already carries its own OS momentum; adding app-side
        // inertia would double it, so stop any app inertia instead.
        cancelInertia();
      }
    };

    interface WebKitGestureEvent extends Event {
      scale: number;
      clientX: number;
      clientY: number;
    }
    let gestureBaseZoom = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureBaseZoom = stateRef.current.zoom;
      if (isInteractionTracingEnabled()) beginInteraction('pinch');
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as WebKitGestureEvent;
      zoomAboutClientPoint(ge.clientX, ge.clientY, gestureBaseZoom * ge.scale);
    };
    const onGestureEnd = (e: Event) => e.preventDefault();

    // Anchor for gestures that carry no coordinates of their own.
    let lastPointer: { x: number; y: number } | null = null;
    // `null` until the pointer has been seen at all, so a pinch made before any
    // movement still zooms (about the canvas centre) rather than being dropped.
    let pointerInside: boolean | null = null;
    const trackPointer = (e: PointerEvent) => {
      lastPointer = { x: e.clientX, y: e.clientY };
      pointerInside = true;
    };
    const onPointerLeave = () => {
      pointerInside = false;
    };

    /**
     * WebKitGTK consumes the touchpad pinch itself and applies it as page zoom,
     * so no wheel or gesture event ever reaches this handler — the desktop shell
     * intercepts that zoom, restores the page, and re-emits the factor here so
     * the pinch lands on the artwork instead of scaling the whole UI.
     *
     * `gesturechange` covers the same gesture on macOS WebKit, and ctrl+wheel
     * covers Chromium, so this is the third arm of one behaviour rather than a
     * separate feature.
     */
    let disposePinchBridge: (() => void) | undefined;
    let pinchBridgeCancelled = false;
    void import('@varve/platform')
      .then(({ isTauriRuntime }) => {
        if (!isTauriRuntime() || pinchBridgeCancelled) return;
        return import('@tauri-apps/api/event').then(({ listen }) =>
          listen<{ factor?: number }>('canvas://pinch-zoom', (event) => {
            const factor = event.payload?.factor;
            if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0) return;
            // Pinching over a panel should not move the artwork. The page zoom
            // has already been reverted natively, so swallowing it is enough.
            if (pointerInside === false) return;
            const rect = el.getBoundingClientRect();
            const x = lastPointer?.x ?? rect.left + rect.width / 2;
            const y = lastPointer?.y ?? rect.top + rect.height / 2;
            zoomAboutClientPoint(x, y, stateRef.current.zoom * factor);
          }).then((unlisten) => {
            if (pinchBridgeCancelled) unlisten();
            else disposePinchBridge = unlisten;
          }),
        );
      })
      .catch(() => {
        // Non-desktop build, or the event API is unavailable — the wheel and
        // gesture paths above still cover their platforms.
      });

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointermove', trackPointer);
    el.addEventListener('pointerleave', onPointerLeave);
    el.addEventListener('gesturestart', onGestureStart, { passive: false });
    el.addEventListener('gesturechange', onGestureChange, { passive: false });
    el.addEventListener('gestureend', onGestureEnd, { passive: false });

    // G6: Monitor lostpointercapture to detect pointer capture leaks.
    // When the browser implicitly releases capture (e.g. the element is
    // removed from the DOM, or the pointer is lost), this event fires.
    // We forward it as a pointercancel to the active tool so it can clean
    // up drag state — otherwise the tool may remain in a "dragging" state
    // with no matching pointerup.
    const onLostPointerCapture = (e: PointerEvent) => {
      const tmInst = tmRef.current;
      if (!tmInst) return;
      tmInst.handlePointerCancel(e, buildToolCtx(e));
    };
    el.addEventListener('lostpointercapture', onLostPointerCapture);

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointermove', trackPointer);
      el.removeEventListener('pointerleave', onPointerLeave);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
      el.removeEventListener('lostpointercapture', onLostPointerCapture);
      pinchBridgeCancelled = true;
      disposePinchBridge?.();
    };
  }, [contentCanvasRef, stateRef, editor, commitCamera, tmRef, buildToolCtx]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      const ne = e.nativeEvent as KeyboardEvent;
      const tmInst = tmRef.current;
      const keyNow = performance.now();
      if (isInteractionTracingEnabled() && keyNow - lastKeyboardTraceAt.current > 150) {
        beginInteraction('keyboard');
      }
      lastKeyboardTraceAt.current = keyNow;

      if (e.key === ' ') {
        e.preventDefault();
        if (!e.repeat && tmInst) {
          tmInst.springLoadTool(
            'hand',
            ne,
            buildToolCtx({ pointerType: 'mouse', pressure: 0 } as PointerEvent),
          );
        }
        return;
      }

      if (tmInst) {
        const ctx = buildToolCtx({ pointerType: 'mouse', pressure: 0 } as PointerEvent);
        if (tmInst.handleKeyDown(ne, ctx)) {
          e.preventDefault();
          return;
        }
      }

      const s = stateRef.current;
      const eRef = editor;

      const nodes: SceneNode[] = [];
      const doc = s.document;
      function walkIds(ids: readonly string[]) {
        for (const id of ids) {
          const n = doc.nodes[id];
          if (!n) continue;
          nodes.push(n);
          if ('children' in n && n.children && n.children.length > 0) {
            walkIds(n.children);
          }
        }
      }
      walkIds(doc.rootChildren);

      const selArr = s.selection;
      const firstSel = selArr[0] ?? null;
      const idx = firstSel ? nodes.findIndex((n) => n.id === firstSel) : -1;

      if (e.key === 'Tab') {
        // Canvas Tab contract (docs/audits/focus-navigation-audit-2026-08-02.md):
        // with a selection, Tab/Shift+Tab cycle selection through the design
        // objects (industry-standard for design tools). With no selection,
        // Tab falls through to normal focus navigation so the canvas is
        // never a hard keyboard trap — Escape clears selection, then Tab
        // leaves the canvas for the next region.
        if (selArr.length === 0) return;
        e.preventDefault();
        if (e.shiftKey) {
          const prev = nodes[(idx <= 0 ? nodes.length : idx) - 1];
          if (prev) {
            eRef.setSelection(prev.id);
            eRef.announceSelection([prev]);
          }
        } else {
          const next = nodes[(idx + 1) % nodes.length];
          if (next) {
            eRef.setSelection(next.id);
            eRef.announceSelection([next]);
          }
        }
        return;
      }

      if (e.key === 'Escape') {
        // B5: Cancel any active tool drag before clearing selection.
        // Tools that handle Escape in their own onKeyDown return true,
        // which preventDefaults and returns above (tmInst.handleKeyDown).
        // If we reach here, the tool did not consume Escape — cancel the
        // drag explicitly so it cannot remain stuck.
        if (tmInst) {
          const cancelCtx = buildToolCtx({ pointerType: 'mouse', pressure: 0 } as PointerEvent);
          tmInst.handlePointerCancel(new PointerEvent('pointercancel'), cancelCtx);
        }
        stopAutoPan();
        setSnapGuides([]);
        if (s.isolatedNodeId) {
          eRef.exitIsolation();
          eRef.setSelection(s.isolatedNodeId);
          eRef.announceOperation('Exit isolation', 'Clipping group');
          return;
        }
        eRef.setSelection(null);
        eRef.announceSelection([]);
        if ((s as { canvasMode?: string }).canvasMode !== 'full') {
          (eRef as { setCanvasMode: (m: CanvasMode) => void }).setCanvasMode('full');
        }
        return;
      }

      if ((e.key === 'Enter' || e.key === 'F2') && firstSel) {
        setRenameDialog({ defaultValue: nodes[idx]?.name ?? '' });
      }

      function zoomAboutCanvasCentre(newZoom: number) {
        const s2 = stateRef.current;
        const parent = contentCanvasRef.current?.parentElement;
        const vpW = parent?.clientWidth ?? 800;
        const vpH = parent?.clientHeight ?? 600;
        const viewport = { width: vpW, height: vpH };
        const cam = { pan: s2.pan, zoom: s2.zoom, rotation: s2.cameraRotation };
        const origin = computeFloatingOrigin(cam, viewport);
        const centreWorld = screenToWorld(cam, vpW / 2, vpH / 2, viewport, origin);
        const newCam = zoomAboutPoint(cam, centreWorld, newZoom, viewport);
        commitCamera(newCam);
      }

      const ZOOM_PRESETS: Record<string, number> = {
        '1': 0.5,
        '2': 0.75,
        '3': 1,
        '4': 1.5,
        '5': 2,
        '6': 4,
      };
      // Digits resolved from the physical key (`Digit1`/`Numpad1`), so the
      // preset/fit shortcuts work on real layouts where `Shift+1` reports
      // `key='!'`, and on numpads regardless of NumLock.
      const digit = physicalDigit({ key: e.key, code: e.code });

      if (digit !== null && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const zoomLevel = ZOOM_PRESETS[digit];
        if (zoomLevel !== undefined) {
          e.preventDefault();
          zoomAboutCanvasCentre(zoomLevel);
          eRef.announceOperation('Zoom', `${Math.round(zoomLevel * 100)}%`);
          return;
        }
      }

      if (digit === '0' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        zoomAboutCanvasCentre(1);
        eRef.announceOperation('Zoom', '100%');
        return;
      }

      if ((e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') && !e.altKey) {
        e.preventDefault();
        zoomAboutCanvasCentre(clampZoom(stateRef.current.zoom * 1.25));
        eRef.announceOperation('Zoom', `${Math.round(stateRef.current.zoom * 100)}%`);
        return;
      }
      if ((e.key === '-' || e.code === 'NumpadSubtract') && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        zoomAboutCanvasCentre(clampZoom(stateRef.current.zoom * 0.8));
        eRef.announceOperation('Zoom', `${Math.round(stateRef.current.zoom * 100)}%`);
        return;
      }

      if (digit === '1' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        const parent = contentCanvasRef.current?.parentElement;
        const vpW = parent?.clientWidth ?? 800;
        const vpH = parent?.clientHeight ?? 600;
        const canvasViewport = { width: vpW, height: vpH };
        const allBounds = rootNodes().reduce<{
          x: number;
          y: number;
          w: number;
          h: number;
        } | null>((acc, n) => {
          const b = editor.getWorldBounds(n.id);
          if (!b) return acc;
          if (!acc) return b;
          return {
            x: Math.min(acc.x, b.x),
            y: Math.min(acc.y, b.y),
            w: Math.max(acc.x + acc.w, b.x + b.w) - Math.min(acc.x, b.x),
            h: Math.max(acc.y + acc.h, b.y + b.h) - Math.min(acc.y, b.y),
          };
        }, null);
        if (allBounds) {
          const cam = fitBoundsCamera(allBounds, canvasViewport, 40);
          commitCamera(cam);
          eRef.announceOperation('Zoom', 'fit all');
        }
      }
      if (digit === '2' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        if (selArr.length > 0) {
          const parent = contentCanvasRef.current?.parentElement;
          const viewport = parent
            ? { width: parent.clientWidth, height: parent.clientHeight }
            : undefined;
          eRef.revealSelection({ fit: true, viewport });
          eRef.announceOperation('Zoom', 'to selection');
        }
      }
    },
    [
      tmRef,
      buildToolCtx,
      stateRef,
      editor,
      commitCamera,
      contentCanvasRef,
      setRenameDialog,
      rootNodes,
      stopAutoPan,
      setSnapGuides,
    ],
  );

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      const ne = e.nativeEvent as KeyboardEvent;
      const tmInst = tmRef.current;
      if (!tmInst) return;
      const ctx = buildToolCtx({ pointerType: 'mouse', pressure: 0 } as PointerEvent);
      if (e.key === ' ' && tmInst.springKey === ' ') {
        e.preventDefault();
        tmInst.releaseSpring(ctx);
        return;
      }
      tmInst.handleKeyUp(ne, ctx);
    },
    [tmRef, buildToolCtx],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const tmInst = tmRef.current;
      if (!tmInst) return;
      const ne = e.nativeEvent as unknown as PointerEvent;
      tmInst.handleDoubleClick(ne, buildToolCtx(ne));
    },
    [tmRef, buildToolCtx],
  );

  const onPointerLeave = useCallback(() => {
    editor.setCursorPos(null);
    stopAutoPan();
    endInteraction();
  }, [editor, stopAutoPan]);

  const onBlur = useCallback(() => {
    stopAutoPan();
    endInteraction();
    editor.commitTransaction();
    tmRef.current?.activeTool.onPointerCancel?.(
      new PointerEvent('pointercancel'),
      buildToolCtx(new PointerEvent('pointercancel')),
    );
    if (tmRef.current?.springActive) {
      tmRef.current.releaseSpring(buildToolCtx(new PointerEvent('pointercancel')));
    }
  }, [tmRef, stopAutoPan, editor, buildToolCtx]);

  // B4 + G7: Reset modifier state and cancel active interactions when the
  // window loses focus or the page becomes hidden. Without this, a key
  // release that occurs outside the window (e.g. alt-tab while holding
  // Ctrl/Shift) leaves the modifier state stuck, and a drag started before
  // tab-switching can remain active indefinitely.
  useEffect(() => {
    function resetInputState() {
      tmRef.current?.resetModifiers();
      interactionSession.reset();
      stopAutoPan();
      advanceNavigation({ type: 'reset' });
    }
    function onWindowBlur() {
      resetInputState();
      tmRef.current?.activeTool.onPointerCancel?.(
        new PointerEvent('pointercancel'),
        buildToolCtx(new PointerEvent('pointercancel')),
      );
      if (tmRef.current?.springActive) {
        tmRef.current.releaseSpring(buildToolCtx(new PointerEvent('pointercancel')));
      }
    }
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        resetInputState();
        editor.commitTransaction();
      }
    }
    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [tmRef, editor, buildToolCtx, stopAutoPan]);

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleKeyDown,
    handleKeyUp,
    handleDoubleClick,
    onPointerLeave,
    onBlur,
    stopAutoPan,
  };
}
