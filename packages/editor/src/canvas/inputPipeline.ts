/**
 * Input pipeline — pointer, keyboard, wheel, and touch-pinch handling
 * extracted from CanvasArea.  Encapsulates auto-pan, snap session state,
 * and two-finger pinch zoom/pan so CanvasArea's event handlers delegate
 * here instead of managing ~200 lines of inline state-machine logic.
 */

import type { NodeId, SceneNode } from '@strata/scene';
import type { Camera } from '@strata/shared';
import {
  clampZoom,
  computeFloatingOrigin,
  fitBoundsCamera,
  screenToWorld,
  zoomAboutPoint,
} from '@strata/shared';
import { type MutableRefObject, useCallback, useEffect, useRef } from 'react';
import type { CanvasMode, EditorState } from '../context/types';
import type { ToolContext, ToolManager } from '../tools';
import { computeEdgeVelocity } from '../tools/autoPan';
import type { SnapGuide } from '../tools/snapping';
import { createSnapSession } from '../tools/snapping';
import { cancelCanvasFrame, createCanvasFrameKey, scheduleCanvasFrame } from './perfRuntime';

export interface UseCanvasInputsOptions {
  contentCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  editor: {
    setCursorPos: (pos: { x: number; y: number } | null) => void;
    setPan: (pan: { x: number; y: number }) => void;
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
  const pinchRef = useRef<{
    lastDist: number;
    lastCentroid: { x: number; y: number };
  } | null>(null);

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

  const stopAutoPan = useCallback(() => {
    const frameKey = autoPanFrameKey.current;
    if (frameKey) cancelCanvasFrame(frameKey);
    autoPanActive.current = false;
    autoPanVelocity.current = { x: 0, y: 0 };
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

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const ne = e.nativeEvent as PointerEvent;
      const tmInst = tmRef.current;
      if (!tmInst) return;
      const ctx = buildToolCtx(ne);

      e.currentTarget.focus({ preventScroll: true });

      if (e.pointerType === 'touch') {
        touchPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touchPointers.current.size === 2) {
          tmInst.handlePointerCancel(ne, ctx);
          const geo = pinchGeometry();
          if (geo) pinchRef.current = { lastDist: geo.dist, lastCentroid: geo.centroid };
          return;
        }
        if (touchPointers.current.size > 2) return;
      }

      if (e.button === 1) e.preventDefault();

      snapSessionForPointer.current = createSnapSession();
      snapIndexForPointer.current = null;
      tmInst.handlePointerDown(ne, ctx);
    },
    [tmRef, buildToolCtx, snapSessionForPointer, snapIndexForPointer],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const ne = e.nativeEvent as PointerEvent;
      const ctx = buildToolCtx(ne);

      if (e.pointerType === 'touch' && touchPointers.current.has(e.pointerId)) {
        touchPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
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

      const now = performance.now();
      if (now - lastCursorUpdate.current > 32) {
        lastCursorUpdate.current = now;
        const world = ctx.canvasToWorld(e.clientX, e.clientY);
        editor.setCursorPos(world);
      }

      const tmInst = tmRef.current;
      if (!tmInst) return;

      // Show hover preview for both select and inspect tools.
      // For other tools, keep the inspect-only behavior (or none at all).
      const isHoverableTool =
        stateRef.current.tool === 'select' || stateRef.current.tool === 'inspect';
      if (isHoverableTool) {
        const world = ctx.canvasToWorld(ne.clientX, ne.clientY);
        const hit = editor.hitTestNode(world);
        setHoveredNode(hit?.node ?? null);
      }

      tmInst.handlePointerMove(ne, ctx);

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
              const tick = () => {
                const v = autoPanVelocity.current;
                if (v.x === 0 && v.y === 0) {
                  stopAutoPan();
                  return;
                }
                const s = stateRef.current;
                editor.setPan({ x: s.pan.x + v.x, y: s.pan.y + v.y });
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
    ],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      stopAutoPan();
      setSnapGuides([]);
      if (e.pointerType === 'touch') {
        const wasPinching = pinchRef.current !== null;
        touchPointers.current.delete(e.pointerId);
        if (touchPointers.current.size < 2) pinchRef.current = null;
        if (wasPinching) return;
      }
      const ne = e.nativeEvent as PointerEvent;
      const tmInst = tmRef.current;
      if (!tmInst) return;
      tmInst.handlePointerUp(ne, buildToolCtx(ne));
    },
    [tmRef, stopAutoPan, setSnapGuides, buildToolCtx],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      stopAutoPan();
      if (e.pointerType === 'touch') {
        touchPointers.current.delete(e.pointerId);
        if (touchPointers.current.size < 2) pinchRef.current = null;
      }
      const ne = e.nativeEvent as PointerEvent;
      tmRef.current?.handlePointerCancel(ne, buildToolCtx(ne));
      setSnapGuides([]);
    },
    [tmRef, stopAutoPan, setSnapGuides, buildToolCtx],
  );

  useEffect(() => {
    const el = contentCanvasRef.current;
    if (!el) return;

    const deltaScale = (e: WheelEvent): number =>
      e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;

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
    const INERTIA_FRICTION = 0.9;
    const INERTIA_THRESHOLD = 0.5;

    function startInertia() {
      if (inertiaRef.current.active) return;
      inertiaRef.current.active = true;
      const tick = () => {
        const s = stateRef.current;
        const v = inertiaRef.current;
        if (Math.abs(v.vx) < INERTIA_THRESHOLD && Math.abs(v.vy) < INERTIA_THRESHOLD) {
          v.active = false;
          v.vx = 0;
          v.vy = 0;
          return;
        }
        editor.setPan({ x: s.pan.x + v.vx, y: s.pan.y + v.vy });
        v.vx *= INERTIA_FRICTION;
        v.vy *= INERTIA_FRICTION;
        scheduleCanvasFrame(inertiaFrameKey, 'input', tick);
      };
      scheduleCanvasFrame(inertiaFrameKey, 'input', tick);
    }

    function cancelInertia() {
      cancelCanvasFrame(inertiaFrameKey);
      inertiaRef.current.active = false;
      inertiaRef.current.vx = 0;
      inertiaRef.current.vy = 0;
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = stateRef.current;
      const k = deltaScale(e);
      if (e.ctrlKey || e.metaKey) {
        const d = Math.max(-24, Math.min(24, e.deltaY * k));
        zoomAboutClientPoint(e.clientX, e.clientY, s.zoom * Math.exp(-d * 0.01));
        cancelInertia();
      } else if (e.shiftKey && e.deltaX === 0) {
        editor.setPan({ x: s.pan.x - e.deltaY * k, y: s.pan.y });
        cancelInertia();
      } else {
        const dx = -e.deltaX * k;
        const dy = -e.deltaY * k;
        editor.setPan({ x: s.pan.x + dx, y: s.pan.y + dy });
        inertiaRef.current.vx = inertiaRef.current.vx * 0.4 + dx * 0.6;
        inertiaRef.current.vy = inertiaRef.current.vy * 0.4 + dy * 0.6;
        const maxV = 80;
        inertiaRef.current.vx = Math.max(-maxV, Math.min(maxV, inertiaRef.current.vx));
        inertiaRef.current.vy = Math.max(-maxV, Math.min(maxV, inertiaRef.current.vy));
        cancelInertia();
        startInertia();
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
    void import('@strata/platform')
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
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    el.addEventListener('gestureend', onGestureEnd);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointermove', trackPointer);
      el.removeEventListener('pointerleave', onPointerLeave);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
      pinchBridgeCancelled = true;
      disposePinchBridge?.();
    };
  }, [contentCanvasRef, stateRef, editor, commitCamera]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      const ne = e.nativeEvent as KeyboardEvent;
      const tmInst = tmRef.current;

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
        if (nodes.length === 0) return;
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
      const zoomLevel = ZOOM_PRESETS[e.key];
      if (zoomLevel !== undefined && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        zoomAboutCanvasCentre(zoomLevel);
        eRef.announceOperation('Zoom', `${Math.round(zoomLevel * 100)}%`);
        return;
      }

      if (e.key === '0' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        zoomAboutCanvasCentre(1);
        eRef.announceOperation('Zoom', '100%');
        return;
      }

      if ((e.key === '=' || e.key === '+') && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        zoomAboutCanvasCentre(clampZoom(stateRef.current.zoom * 1.25));
        eRef.announceOperation('Zoom', `${Math.round(stateRef.current.zoom * 100)}%`);
        return;
      }
      if (e.key === '-' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        zoomAboutCanvasCentre(clampZoom(stateRef.current.zoom * 0.8));
        eRef.announceOperation('Zoom', `${Math.round(stateRef.current.zoom * 100)}%`);
        return;
      }

      if (e.key === '1' && e.shiftKey) {
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
      if (e.key === '2' && e.shiftKey) {
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
  }, [editor, stopAutoPan]);

  const onBlur = useCallback(() => {
    stopAutoPan();
    editor.commitTransaction();
    tmRef.current?.activeTool.onPointerCancel?.(
      new PointerEvent('pointercancel'),
      buildToolCtx(new PointerEvent('pointercancel')),
    );
    if (tmRef.current?.springActive) {
      tmRef.current.releaseSpring(buildToolCtx(new PointerEvent('pointercancel')));
    }
  }, [tmRef, stopAutoPan, editor, buildToolCtx]);

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
