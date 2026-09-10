/**
 * WarpOverlay — direct-manipulation cage/mesh editing for the active warp
 * modifier (skew / perspective / envelope / mesh / bend).
 *
 * Architecture mirrors SelectionOverlay: the overlay owns handle
 * interactions (React pointer events + SVG), mutations go through
 * updateDoc inside a begin/commit transaction (one undo step per drag), and
 * Escape aborts the in-flight drag (abortTransaction).
 *
 * Handle sizing is screen-constant (never scales away with zoom). Snap
 * targets: the pixel grid (when snapping is enabled).
 *
 * Foldover policy: after each committed drag, analyzeFoldover is evaluated;
 * 'prevent' reverts the drag, 'warn' shows a text+icon warning (never
 * color-only), 'allow' accepts freely.
 */

import {
  analyzeFoldover,
  type BendModifier,
  type EnvelopeModifier,
  type MeshWarpModifier,
  type NormalizedPoint,
  type PerspectiveModifier,
  type SkewModifier,
  type WarpModifier,
} from '@varve/engine';
import type { Document } from '@varve/scene';
import {
  isContainer,
  nodeLocalBoundsSource,
  nodeWorldTransform,
  updateWarp,
  warpsOnNode,
} from '@varve/scene';
import type { Affine, Rect } from '@varve/shared';
import {
  applyAffine,
  computeFloatingOrigin,
  screenDeltaToWorld,
  worldToScreen as sharedWorldToScreen,
} from '@varve/shared';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { CANVAS_INTERACTIVE_OVERLAY_Z_INDEX } from '../canvas/overlayZIndex';
import { useEditor } from '../context';
import { LatestPointerQueue } from './latestPointerQueue';

const HANDLE_SIZE = 7;
type PointerSample = { clientX: number; clientY: number; pointerId: number };

function targetContainsSelection(doc: Document, targetId: string, selection: readonly string[]) {
  if (selection.includes(targetId)) return true;
  const visited = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);
    const node = doc.nodes[nodeId];
    if (!node || !isContainer(node)) return false;
    return node.children.some((childId) => selection.includes(childId) || visit(childId));
  };
  return visit(targetId);
}

type PointerCaptureTarget = {
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
};

/** Spoken corner names — "tl" does not read usefully in a screen reader. */
const CORNER_LABELS: Record<'tl' | 'tr' | 'br' | 'bl', string> = {
  tl: 'top left',
  tr: 'top right',
  br: 'bottom right',
  bl: 'bottom left',
};

/** Spoken envelope edge names. */
const EDGE_LABELS: Record<'top' | 'right' | 'bottom' | 'left', string> = {
  top: 'top',
  right: 'right',
  bottom: 'bottom',
  left: 'left',
};

type DragApply = (
  dxWorld: number,
  dyWorld: number,
  m: WarpModifier,
) => Record<string, unknown> | null;

/**
 * PerspectiveGrid — renders a grid of lines through the perspective corners
 * to visualize the projective distortion. Lines in source space are straight
 * and remain straight under projective mapping, so each grid line is a
 * single SVG <line> between bilinearly-interpolated endpoints.
 */
function PerspectiveGrid({
  corners,
  normToScreen,
  zoom,
}: {
  corners: PerspectiveModifier['corners'];
  normToScreen: (p: NormalizedPoint) => { x: number; y: number };
  zoom: number;
}) {
  const GRID_LINES = 5;
  const stroke = 'rgba(255,255,255,0.3)';
  const sw = 1 / Math.max(1, zoom * 0.5);

  const bilinear = (
    t: number,
    s: number,
    tl: NormalizedPoint,
    tr: NormalizedPoint,
    br: NormalizedPoint,
    bl: NormalizedPoint,
  ): NormalizedPoint => ({
    x: (1 - t) * (1 - s) * tl.x + t * (1 - s) * tr.x + t * s * br.x + (1 - t) * s * bl.x,
    y: (1 - t) * (1 - s) * tl.y + t * (1 - s) * tr.y + t * s * br.y + (1 - t) * s * bl.y,
  });

  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];

  for (let i = 1; i < GRID_LINES; i++) {
    const t = i / GRID_LINES;
    const s0 = bilinear(t, 0, corners.tl, corners.tr, corners.br, corners.bl);
    const s1 = bilinear(t, 1, corners.tl, corners.tr, corners.br, corners.bl);
    const p0 = normToScreen(s0);
    const p1 = normToScreen(s1);
    lines.push({ x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y });

    const t0 = bilinear(0, t, corners.tl, corners.tr, corners.br, corners.bl);
    const t1 = bilinear(1, t, corners.tl, corners.tr, corners.br, corners.bl);
    const q0 = normToScreen(t0);
    const q1 = normToScreen(t1);
    lines.push({ x1: q0.x, y1: q0.y, x2: q1.x, y2: q1.y });
  }

  return (
    <g className="warp-overlay__perspective-grid" aria-hidden>
      {lines.map((l) => (
        <line
          key={`${l.x1}-${l.y1}-${l.x2}-${l.y2}`}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
          stroke={stroke}
          strokeWidth={sw}
        />
      ))}
    </g>
  );
}

export function WarpOverlay({
  zoom,
  pan,
  cameraRotation,
}: {
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation: number;
}) {
  const {
    state,
    updateDoc,
    beginTransaction,
    commitTransaction,
    abortTransaction,
    announce,
    setWarpEdit,
  } = useEditor();
  const doc = state.document;
  const target = state.warpEdit;
  const [drag, setDrag] = useState<{
    key: string;
    startClient: { x: number; y: number };
    apply: DragApply;
    /**
     * The modifier as it was when the drag began. Pointer moves carry the
     * cumulative delta from `startClient`, so it must be applied to this
     * snapshot; applying it to the live (already-moved) modifier re-adds the
     * whole delta on every event and the handle accelerates away from the
     * cursor.
     */
    startModifier: WarpModifier;
    pointerId: number;
    captureTarget: PointerCaptureTarget;
  } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const [selectedPoints, setSelectedPoints] = useState<Set<number>>(new Set());
  const [foldover, setFoldover] = useState<{ foldover: boolean; severity: string } | null>(null);
  const pointerRafRef = useRef<number | null>(null);
  const pendingPointerRef = useRef<PointerSample | null>(null);
  const previewModifierRef = useRef<WarpModifier | null>(null);

  const node = target ? doc.nodes[target.nodeId] : undefined;
  const modifier =
    target && node ? (warpsOnNode(node).find((w) => w.id === target.modifierId) ?? null) : null;
  const selectionOwnsTarget = target
    ? targetContainsSelection(doc, target.nodeId, state.selection)
    : false;

  const sourceBounds: Rect | null = node ? nodeLocalBoundsSource(node, doc) : null;
  const worldMat: Affine | null = target ? nodeWorldTransform(doc, target.nodeId) : null;

  const applyHandleDelta = useCallback(
    (apply: DragApply, dxWorld: number, dyWorld: number, base: WarpModifier): boolean => {
      if (!target) return false;
      const patch = apply(dxWorld, dyWorld, base);
      if (!patch) return false;
      previewModifierRef.current = { ...base, ...patch } as WarpModifier;
      updateDoc((doc2) => updateWarp(doc2, target.nodeId, target.modifierId, patch as never));
      return true;
    },
    [target, updateDoc],
  );

  const flushLatestPointer = useCallback(() => {
    pointerRafRef.current = null;
    const sample = pendingPointerRef.current;
    pendingPointerRef.current = null;
    const d = dragRef.current;
    if (!sample || !d) return;
    const [dxWorld, dyWorld] = screenDeltaToWorld(
      { zoom, pan, rotation: cameraRotation },
      sample.clientX - d.startClient.x,
      sample.clientY - d.startClient.y,
    );
    applyHandleDelta(d.apply, dxWorld, dyWorld, d.startModifier);
  }, [applyHandleDelta, cameraRotation, pan, zoom]);

  const flushLatestPointerRef = useRef(flushLatestPointer);
  flushLatestPointerRef.current = flushLatestPointer;
  const pointerQueueRef = useRef<LatestPointerQueue<PointerSample> | null>(null);
  if (pointerQueueRef.current === null) {
    pointerQueueRef.current = new LatestPointerQueue(
      (callback) => {
        const frame = requestAnimationFrame(callback);
        pointerRafRef.current = frame;
        return frame;
      },
      (frame) => cancelAnimationFrame(frame),
      (sample) => {
        pendingPointerRef.current = sample;
        flushLatestPointerRef.current();
      },
    );
  }

  const scheduleLatestPointer = useCallback((e: React.PointerEvent) => {
    pointerQueueRef.current?.push({
      clientX: e.clientX,
      clientY: e.clientY,
      pointerId: e.pointerId,
    });
  }, []);

  useEffect(() => {
    setSelectedPoints(new Set());
    setFoldover(null);
    previewModifierRef.current = null;
  }, [target?.nodeId, target?.modifierId]);

  useEffect(() => {
    if (target && (!node || !modifier || !selectionOwnsTarget)) setWarpEdit(null);
  }, [modifier, node, selectionOwnsTarget, setWarpEdit, target]);

  // A tool switch unmounts the overlay before ToolManager's lifecycle effect
  // runs. Cancel the queued sample and close the transaction at the component
  // boundary as well, so a pointer capture or RAF cannot mutate the next tool.
  useEffect(() => {
    return () => {
      pointerQueueRef.current?.cancelPending();
      pointerRafRef.current = null;
      pendingPointerRef.current = null;
      previewModifierRef.current = null;
      const active = dragRef.current;
      if (active) {
        try {
          active.captureTarget.releasePointerCapture?.(active.pointerId);
        } catch {
          // The browser may already have released the pointer.
        }
        abortTransaction();
      }
    };
  }, [abortTransaction]);

  const worldDeltaToLocal = useCallback(
    (dx: number, dy: number): { x: number; y: number } => {
      if (!worldMat) return { x: 0, y: 0 };
      const a = worldMat[0];
      const b = worldMat[1];
      const c = worldMat[2];
      const d = worldMat[3];
      const det = a * d - b * c;
      if (Math.abs(det) < 1e-12) return { x: 0, y: 0 };
      return { x: (d * dx - c * dy) / det, y: (-b * dx + a * dy) / det };
    },
    [worldMat],
  );

  /**
   * Node-local DELTA → normalized-source delta.
   *
   * Deliberately does not subtract `sourceBounds.x/y`: this converts a
   * displacement, not a position. Subtracting the origin (as a point
   * conversion would) adds a constant `-sourceBounds.x / w` bias to every
   * drag for any node whose local bounds do not start at (0,0) — ellipses
   * (`cx - rx`), stars, polygons and most paths. A rect authored at the
   * origin has `sourceBounds.x === 0`, which hides the error.
   */
  const normDeltaFromLocal = useCallback(
    (lx: number, ly: number): NormalizedPoint => {
      if (!sourceBounds || sourceBounds.w === 0 || sourceBounds.h === 0) return { x: 0, y: 0 };
      return { x: lx / sourceBounds.w, y: ly / sourceBounds.h };
    },
    [sourceBounds],
  );

  const endDrag = useCallback(
    (ok: boolean) => {
      const active = dragRef.current;
      if (!active) return;
      if (ok) pointerQueueRef.current?.flushPending();
      else pointerQueueRef.current?.cancelPending();
      pointerRafRef.current = null;
      if (!ok) pendingPointerRef.current = null;
      setDrag(null);
      try {
        active.captureTarget.releasePointerCapture?.(active.pointerId);
      } catch {
        // Pointer capture may have been released by the browser already.
      }
      if (ok) {
        let shouldCommit = true;
        if (target && sourceBounds) {
          const nodeAtEnd = doc.nodes[target.nodeId];
          const finalModifier = previewModifierRef.current;
          const finalWarps = nodeAtEnd
            ? warpsOnNode(nodeAtEnd).map((warp) =>
                finalModifier && warp.id === target.modifierId ? finalModifier : warp,
              )
            : undefined;
          const analysis = analyzeFoldover(sourceBounds, finalWarps, {
            settings: (
              nodeAtEnd as { warpSettings?: import('@varve/engine').WarpSettings } | undefined
            )?.warpSettings,
          });
          setFoldover({ foldover: analysis.foldover, severity: analysis.severity });
          const policy =
            (nodeAtEnd as { warpSettings?: { foldoverPolicy?: string } } | undefined)?.warpSettings
              ?.foldoverPolicy ?? 'warn';
          shouldCommit = !(analysis.foldover && policy === 'prevent');
        }
        if (shouldCommit) commitTransaction();
        else abortTransaction();
        previewModifierRef.current = null;
      } else {
        abortTransaction();
        previewModifierRef.current = null;
      }
    },
    [commitTransaction, abortTransaction, target, sourceBounds, doc, flushLatestPointer],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dragRef.current) {
        e.preventDefault();
        endDrag(false);
      }
    };
    const cancelForContextLoss = () => {
      if (dragRef.current) endDrag(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', cancelForContextLoss);
    document.addEventListener('visibilitychange', cancelForContextLoss);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', cancelForContextLoss);
      document.removeEventListener('visibilitychange', cancelForContextLoss);
    };
  }, [endDrag]);

  if (!target || !selectionOwnsTarget || !node || !modifier || !sourceBounds || !worldMat)
    return null;

  const settings = (node as { warpSettings?: import('@varve/engine').WarpSettings }).warpSettings;
  const foldoverPolicy = settings?.foldoverPolicy ?? 'warn';
  const foldoverVisible = foldover?.foldover && foldoverPolicy !== 'prevent';

  const startHandleDrag = (e: React.PointerEvent, key: string, apply: DragApply) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    beginTransaction();
    const captureTarget = e.currentTarget as unknown as PointerCaptureTarget;
    try {
      captureTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // Some WebKitGTK versions reject capture on SVG nodes; the parent SVG
      // listener still handles the normal in-canvas path.
    }
    previewModifierRef.current = modifier;
    setDrag({
      key,
      pointerId: e.pointerId,
      captureTarget,
      startClient: { x: e.clientX, y: e.clientY },
      apply,
      startModifier: modifier,
    });
  };

  const handleDragMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    // Pointer devices can deliver more samples than the display can present.
    // Keep only the newest sample and evaluate it once per frame; stale samples
    // must never queue behind the pointer.
    scheduleLatestPointer(e);
  };

  /**
   * Keyboard equivalent of a drag: move the focused handle by whole world
   * pixels. Each keypress is its own undo step, matching how nudging works
   * elsewhere in the editor.
   */
  const nudgeHandle = (apply: DragApply, dxWorld: number, dyWorld: number) => {
    if (!modifier) return;
    beginTransaction();
    // Relative to the current value: each keypress is a discrete step.
    if (applyHandleDelta(apply, dxWorld, dyWorld, modifier)) commitTransaction();
    else abortTransaction();
  };

  /**
   * Arrow keys nudge (Shift = coarse, matching the editor-wide 1/10px step).
   * Returns true when the key was consumed so canvas-level shortcuts do not
   * also act on it.
   */
  const handleHandleKey = (e: React.KeyboardEvent, apply: DragApply, label: string): boolean => {
    const step = e.shiftKey ? 10 : 1;
    const delta = {
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
    }[e.key];
    if (!delta) return false;
    e.preventDefault();
    e.stopPropagation();
    nudgeHandle(apply, delta[0]!, delta[1]!);
    announce(`${label} moved ${step} pixel${step === 1 ? '' : 's'}`);
    return true;
  };

  const snapToPixelGrid = (p: NormalizedPoint): NormalizedPoint => {
    if (!state.snapEnabled || !sourceBounds || sourceBounds.w === 0 || sourceBounds.h === 0)
      return p;
    const step = state.snapGrid > 0 ? state.snapGrid : 1;
    return {
      x: Math.round((p.x * sourceBounds.w) / step) * (step / sourceBounds.w),
      y: Math.round((p.y * sourceBounds.h) / step) * (step / sourceBounds.h),
    };
  };

  const toScreen = (lx: number, ly: number): { x: number; y: number } => {
    const w = applyAffine(worldMat, [lx, ly]);
    return worldToScreen(w[0], w[1], zoom, pan, cameraRotation);
  };

  const normToScreen = (p: NormalizedPoint): { x: number; y: number } =>
    toScreen(sourceBounds.x + p.x * sourceBounds.w, sourceBounds.y + p.y * sourceBounds.h);

  const cagePoints = (m: WarpModifier): Array<[number, number]> => {
    const c = modifierCorners(m);
    return [c.tl, c.tr, c.br, c.bl].map((corner) => {
      const s = normToScreen(corner);
      return [s.x, s.y];
    });
  };

  const modifierCorners = (m: WarpModifier): PerspectiveModifier['corners'] => {
    switch (m.kind) {
      case 'perspective':
      case 'envelope':
        return m.corners;
      case 'skew':
        return skewCorners(m);
      default:
        return { tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 } };
    }
  };

  const skewCorners = (m: SkewModifier): PerspectiveModifier['corners'] => {
    const kx = Math.tan((m.skewX * Math.PI) / 180);
    const ky = Math.tan((m.skewY * Math.PI) / 180);
    const ox = m.origin.x;
    const oy = m.origin.y;
    const rx = sourceBounds.w === 0 ? 1 : sourceBounds.h / sourceBounds.w;
    const ry = sourceBounds.h === 0 ? 1 : sourceBounds.w / sourceBounds.h;
    const mkV = (x: number, y: number): NormalizedPoint => ({
      x: ox + (x - ox) + kx * (y - oy) * rx,
      y: oy + (y - oy) + ky * (x - ox) * ry,
    });
    return { tl: mkV(0, 0), tr: mkV(1, 0), br: mkV(1, 1), bl: mkV(0, 1) };
  };

  const cornerDrag =
    (corner: keyof PerspectiveModifier['corners']): DragApply =>
    (dxW, dyW, m) => {
      if (m.kind !== 'perspective' && m.kind !== 'envelope') return null;
      const local = worldDeltaToLocal(dxW, dyW);
      const delta = normDeltaFromLocal(local.x, local.y);
      const current = m.corners[corner];
      const snapped = snapToPixelGrid({ x: current.x + delta.x, y: current.y + delta.y });
      return { corners: { ...m.corners, [corner]: snapped } };
    };

  /**
   * A cage handle. Focusable and arrow-key operable so the whole warp can be
   * edited without a pointer (WCAG 2.2 AA), with position announced as
   * percentages of the source box — the same normalized space the Inspector
   * fields use.
   */
  const renderHandle = (
    key: string,
    point: NormalizedPoint,
    apply: DragApply,
    size = HANDLE_SIZE,
    label = `Warp handle ${key}`,
  ) => {
    const s = normToScreen(point);
    const position = `X ${Math.round(point.x * 100)} percent, Y ${Math.round(point.y * 100)} percent`;
    return (
      <g key={key} transform={`translate(${s.x} ${s.y})`}>
        {/* biome-ignore lint/a11y/useSemanticElements: SVG has no <button>; role+tabIndex is the standard way to make an SVG handle operable */}
        <rect
          x={-size - 3}
          y={-size - 3}
          width={(size + 3) * 2}
          height={(size + 3) * 2}
          fill="transparent"
          style={{ pointerEvents: 'all', cursor: 'move' }}
          onPointerDown={(e) => startHandleDrag(e, key, apply)}
          onKeyDown={(e) => handleHandleKey(e, apply, label)}
          onFocus={() => announce(`${label}. ${position}`)}
          tabIndex={0}
          role="button"
          aria-label={`${label}. ${position}`}
        />
        <rect
          className="warp-overlay__handle"
          x={-size / 2}
          y={-size / 2}
          width={size}
          height={size}
          fill="var(--color-interactive-default)"
          stroke="var(--color-surface-overlay)"
          strokeWidth={1}
          rx={1}
          style={{ pointerEvents: 'none' }}
        />
      </g>
    );
  };

  const cage = cagePoints(modifier);
  const polygon = cage.map(([x, y]) => `${x},${y}`).join(' ');

  return (
    // biome-ignore lint/a11y/useSemanticElements: SVG root cannot be a <fieldset>
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'visible',
        width: '100%',
        height: '100%',
        // SelectionOverlay is rendered later at the base interactive layer.
        // Keep the active warp cage above it so its handles stay visible and
        // receive pointer input instead of transform handles.
        zIndex: CANVAS_INTERACTIVE_OVERLAY_Z_INDEX + 1,
      }}
      onPointerMove={handleDragMove}
      onPointerUp={(e) => {
        if (dragRef.current?.pointerId === e.pointerId) endDrag(true);
      }}
      onPointerCancel={(e) => {
        if (dragRef.current?.pointerId === e.pointerId) endDrag(false);
      }}
      onLostPointerCapture={() => {
        if (dragRef.current) endDrag(false);
      }}
      // Not presentational: this subtree owns the focusable cage handles, so
      // it has to be a labelled group for assistive technology to describe
      // what the Tab stops inside it belong to.
      role="group"
      aria-label={`${modifier.kind} warp cage`}
    >
      <polygon
        className="warp-overlay__cage"
        points={polygon}
        fill="none"
        stroke="var(--color-interactive-default)"
        strokeWidth={1.5 / Math.max(1, zoom * 0.5)}
        strokeDasharray="6 4"
      />

      {modifier.kind === 'skew' && (
        <SkewHandles
          modifier={modifier}
          startHandleDrag={startHandleDrag}
          onHandleKey={handleHandleKey}
          announce={announce}
          toScreen={toScreen}
          cagePoints={cagePoints}
          polygonPoints={polygon}
          sourceBounds={sourceBounds}
          normDeltaFromLocal={normDeltaFromLocal}
          worldDeltaToLocal={worldDeltaToLocal}
        />
      )}

      {modifier.kind === 'perspective' && (
        <>
          <PerspectiveGrid corners={modifier.corners} normToScreen={normToScreen} zoom={zoom} />
          {(['tl', 'tr', 'br', 'bl'] as const).map((c) =>
            renderHandle(
              `corner-${c}`,
              modifier.corners[c],
              cornerDrag(c),
              HANDLE_SIZE,
              `Perspective ${CORNER_LABELS[c]} corner`,
            ),
          )}
        </>
      )}

      {modifier.kind === 'envelope' && (
        <EnvelopeHandles
          modifier={modifier as EnvelopeModifier}
          renderHandle={renderHandle}
          normToScreen={normToScreen}
          snapToPixelGrid={snapToPixelGrid}
          normDeltaFromLocal={normDeltaFromLocal}
          worldDeltaToLocal={worldDeltaToLocal}
        />
      )}

      {modifier.kind === 'mesh-warp' && (
        <MeshHandles
          modifier={modifier as MeshWarpModifier}
          selectedPoints={selectedPoints}
          setSelectedPoints={setSelectedPoints}
          startHandleDrag={startHandleDrag}
          onHandleKey={handleHandleKey}
          announce={announce}
          normToScreen={normToScreen}
          snapToPixelGrid={snapToPixelGrid}
          normDeltaFromLocal={normDeltaFromLocal}
          worldDeltaToLocal={worldDeltaToLocal}
          zoom={zoom}
        />
      )}

      {modifier.kind === 'bend' && (
        <BendHandles
          modifier={modifier as BendModifier}
          startHandleDrag={startHandleDrag}
          onHandleKey={handleHandleKey}
          announce={announce}
          sourceBounds={sourceBounds}
          worldMat={worldMat}
          zoom={zoom}
          pan={pan}
          cameraRotation={cameraRotation}
          normDeltaFromLocal={normDeltaFromLocal}
          worldDeltaToLocal={worldDeltaToLocal}
        />
      )}

      {foldoverVisible && (
        <g transform="translate(12 12)">
          <rect
            x={0}
            y={0}
            width={230}
            height={34}
            rx={6}
            fill="var(--color-surface-raised)"
            stroke="var(--color-feedback-warning)"
          />
          <text x={10} y={21} fontSize={12} fill="var(--color-feedback-warning)">
            {foldover!.severity === 'severe'
              ? 'Severe foldover — geometry overlaps'
              : 'Foldover — geometry overlaps'}
          </text>
        </g>
      )}
    </svg>
  );
}

function worldToScreen(
  wx: number,
  wy: number,
  zoom: number,
  pan: { x: number; y: number },
  rotation: number,
): { x: number; y: number } {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const origin = computeFloatingOrigin({ zoom, pan, rotation }, viewport);
  const [x, y] = sharedWorldToScreen({ zoom, pan, rotation }, wx, wy, viewport, origin);
  return { x, y };
}

function SkewHandles({
  modifier,
  startHandleDrag,
  onHandleKey,
  announce,
  toScreen,
  cagePoints,
  polygonPoints,
  sourceBounds,
  normDeltaFromLocal,
  worldDeltaToLocal,
}: {
  modifier: WarpModifier;
  startHandleDrag: (e: React.PointerEvent, key: string, apply: DragApply) => void;
  onHandleKey: (e: React.KeyboardEvent, apply: DragApply, label: string) => boolean;
  announce: (msg: string) => void;
  toScreen: (lx: number, ly: number) => { x: number; y: number };
  cagePoints: (m: WarpModifier) => Array<[number, number]>;
  polygonPoints: string;
  sourceBounds: Rect;
  normDeltaFromLocal: (x: number, y: number) => NormalizedPoint;
  worldDeltaToLocal: (dx: number, dy: number) => { x: number; y: number };
}) {
  const m = modifier as SkewModifier;
  const corners = cagePoints(modifier);
  const mids: Array<[number, number]> = [
    [(corners[0]![0] + corners[1]![0]) / 2, (corners[0]![1] + corners[1]![1]) / 2],
    [(corners[1]![0] + corners[2]![0]) / 2, (corners[1]![1] + corners[2]![1]) / 2],
    [(corners[2]![0] + corners[3]![0]) / 2, (corners[2]![1] + corners[3]![1]) / 2],
    [(corners[3]![0] + corners[0]![0]) / 2, (corners[3]![1] + corners[0]![1]) / 2],
  ];
  const pivot = toScreen(
    sourceBounds.x + m.origin.x * sourceBounds.w,
    sourceBounds.y + m.origin.y * sourceBounds.h,
  );
  const handle = (key: string, world: [number, number], axis: 'x' | 'y') => {
    const apply: DragApply = (dxW, dyW, mm) => {
      if (mm.kind !== 'skew') return null;
      const local = worldDeltaToLocal(dxW, dyW);
      const delta = normDeltaFromLocal(local.x, local.y);
      if (axis === 'x') {
        return { skewX: Math.max(-89.9, Math.min(89.9, mm.skewX + delta.x * 60)) };
      }
      return { skewY: Math.max(-89.9, Math.min(89.9, mm.skewY - delta.y * 60)) };
    };
    const label =
      axis === 'x'
        ? `Horizontal skew, ${Math.round(m.skewX)} degrees`
        : `Vertical skew, ${Math.round(m.skewY)} degrees`;
    return (
      <g key={key} transform={`translate(${world[0]} ${world[1]})`}>
        {/* biome-ignore lint/a11y/useSemanticElements: SVG has no <button>; role+tabIndex is the standard way to make an SVG handle operable */}
        <rect
          x={-10}
          y={-10}
          width={20}
          height={20}
          fill="transparent"
          style={{ pointerEvents: 'all', cursor: 'ns-resize' }}
          onPointerDown={(e) => startHandleDrag(e, key, apply)}
          onKeyDown={(e) => onHandleKey(e, apply, label)}
          onFocus={() => announce(label)}
          tabIndex={0}
          role="button"
          aria-label={label}
        />
        <rect
          x={-4}
          y={-4}
          width={8}
          height={8}
          fill="var(--color-interactive-default)"
          stroke="var(--color-surface-overlay)"
          rx={1}
          transform="rotate(45)"
        />
      </g>
    );
  };
  return (
    <>
      <polygon
        points={polygonPoints}
        fill="var(--color-interactive-default)"
        fillOpacity={0.08}
        stroke="none"
      />
      <circle
        cx={pivot.x}
        cy={pivot.y}
        r={3}
        fill="#fff"
        stroke="var(--color-interactive-default)"
      />
      {handle('skew-x', mids[0]!, 'x')}
      {handle('skew-x-bottom', mids[2]!, 'x')}
      {handle('skew-y', mids[1]!, 'y')}
      {handle('skew-y-left', mids[3]!, 'y')}
    </>
  );
}

function EnvelopeHandles({
  modifier,
  renderHandle,
  normToScreen,
  snapToPixelGrid,
  normDeltaFromLocal,
  worldDeltaToLocal,
}: {
  modifier: EnvelopeModifier;
  renderHandle: (
    key: string,
    point: NormalizedPoint,
    apply: DragApply,
    size?: number,
    label?: string,
  ) => React.ReactNode;
  normToScreen: (p: NormalizedPoint) => { x: number; y: number };
  snapToPixelGrid: (p: NormalizedPoint) => NormalizedPoint;
  normDeltaFromLocal: (x: number, y: number) => NormalizedPoint;
  worldDeltaToLocal: (dx: number, dy: number) => { x: number; y: number };
}) {
  const m = modifier;
  const edgeCurve = (edge: 'top' | 'right' | 'bottom' | 'left'): string => {
    const pts = edgePoints(edge);
    const out: string[] = [];
    for (let t = 0; t <= 20; t++) {
      const u = t / 20;
      const uu = (1 - u) ** 2;
      const tt = u * u;
      const bx =
        (1 - u) * uu * pts[0]!.x +
        3 * uu * u * pts[1]!.x +
        3 * (1 - u) * tt * pts[2]!.x +
        tt * u * pts[3]!.x;
      const by =
        (1 - u) * uu * pts[0]!.y +
        3 * uu * u * pts[1]!.y +
        3 * (1 - u) * tt * pts[2]!.y +
        tt * u * pts[3]!.y;
      const s = normToScreen({ x: bx, y: by });
      out.push(`${s.x},${s.y}`);
    }
    return out.join(' ');
  };
  /**
   * Control polygon of one envelope edge, in the SAME parameterization the
   * Coons evaluator uses (see envelopeMap): top and bottom both run left to
   * right, left and right both run top to bottom — each edge matches the
   * direction of the edge opposite it, not a CCW perimeter loop.
   *
   * Drawing bottom/left reversed made the rendered cage disagree with the
   * geometry it controls as soon as an edge's two controls differed, which
   * an identity (straight) envelope hides.
   */
  const edgePoints = (edge: 'top' | 'right' | 'bottom' | 'left'): NormalizedPoint[] => {
    const c = m.corners;
    const e = m.edges;
    switch (edge) {
      case 'top':
        return [c.tl, e.top[0], e.top[1], c.tr];
      case 'right':
        return [c.tr, e.right[0], e.right[1], c.br];
      case 'bottom':
        return [c.bl, e.bottom[0], e.bottom[1], c.br];
      case 'left':
        return [c.tl, e.left[0], e.left[1], c.bl];
    }
  };
  const edgeHandle = (edge: 'top' | 'right' | 'bottom' | 'left', i: 0 | 1) =>
    renderHandle(
      `edge-${edge}-${i}`,
      m.edges[edge][i]!,
      (dxW, dyW, mm) => {
        if (mm.kind !== 'envelope') return null;
        const local = worldDeltaToLocal(dxW, dyW);
        const delta = normDeltaFromLocal(local.x, local.y);
        const current = mm.edges[edge][i]!;
        const next = snapToPixelGrid({ x: current.x + delta.x, y: current.y + delta.y });
        const edges = { ...mm.edges };
        edges[edge] = i === 0 ? [next, mm.edges[edge][1]] : [mm.edges[edge][0], next];
        return { edges };
      },
      6,
      `Envelope ${EDGE_LABELS[edge]} edge control ${i + 1} of 2`,
    );
  const cornerHandle = (corner: 'tl' | 'tr' | 'br' | 'bl') =>
    renderHandle(
      `corner-${corner}`,
      m.corners[corner],
      (dxW, dyW, mm) => {
        if (mm.kind !== 'envelope') return null;
        const local = worldDeltaToLocal(dxW, dyW);
        const delta = normDeltaFromLocal(local.x, local.y);
        const current = mm.corners[corner];
        const snapped = snapToPixelGrid({ x: current.x + delta.x, y: current.y + delta.y });
        return { corners: { ...mm.corners, [corner]: snapped } };
      },
      HANDLE_SIZE,
      `Envelope ${CORNER_LABELS[corner]} corner`,
    );
  return (
    <>
      {(['top', 'right', 'bottom', 'left'] as const).map((edge) => (
        <polyline
          key={edge}
          points={edgeCurve(edge)}
          fill="none"
          stroke="var(--color-interactive-default)"
          strokeWidth={1.5}
          strokeDasharray="6 4"
        />
      ))}
      {(['top', 'right', 'bottom', 'left'] as const).map((edge) => (
        <Fragment key={edge}>
          {edgeHandle(edge, 0)}
          {edgeHandle(edge, 1)}
        </Fragment>
      ))}
      {cornerHandle('tl')}
      {cornerHandle('tr')}
      {cornerHandle('br')}
      {cornerHandle('bl')}
    </>
  );
}

function MeshHandles({
  modifier,
  selectedPoints,
  setSelectedPoints,
  startHandleDrag,
  onHandleKey,
  announce,
  normToScreen,
  snapToPixelGrid,
  normDeltaFromLocal,
  worldDeltaToLocal,
  zoom,
}: {
  modifier: MeshWarpModifier;
  selectedPoints: Set<number>;
  setSelectedPoints: (s: Set<number>) => void;
  startHandleDrag: (e: React.PointerEvent, key: string, apply: DragApply) => void;
  onHandleKey: (e: React.KeyboardEvent, apply: DragApply, label: string) => boolean;
  announce: (msg: string) => void;
  normToScreen: (p: NormalizedPoint) => { x: number; y: number };
  snapToPixelGrid: (p: NormalizedPoint) => NormalizedPoint;
  normDeltaFromLocal: (x: number, y: number) => NormalizedPoint;
  worldDeltaToLocal: (dx: number, dy: number) => { x: number; y: number };
  zoom: number;
}) {
  const m = modifier;
  const { rows, columns, points } = m;
  const v = (r: number, c: number) => r * (columns + 1) + c;
  const lines: Array<[number, number]> = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < columns; c++) lines.push([v(r, c), v(r, c + 1)]);
  }
  for (let c = 0; c <= columns; c++) {
    for (let r = 0; r < rows; r++) lines.push([v(r, c), v(r + 1, c)]);
  }
  const dragSelected =
    (index: number): DragApply =>
    (dxW, dyW, mm) => {
      if (mm.kind !== 'mesh-warp') return null;
      const local = worldDeltaToLocal(dxW, dyW);
      const delta = normDeltaFromLocal(local.x, local.y);
      const set = selectedPoints.size > 0 ? selectedPoints : new Set([index]);
      const next = [...mm.points];
      for (const i of set) {
        const p = mm.points[i];
        if (!p) continue;
        next[i] = snapToPixelGrid({
          x: Math.max(-2, Math.min(3, p.x + delta.x)),
          y: Math.max(-2, Math.min(3, p.y + delta.y)),
        });
      }
      return { points: next };
    };
  return (
    <>
      {lines.map(([a, b]) => {
        const pa = normToScreen(points[a]!);
        const pb = normToScreen(points[b]!);
        return (
          <line
            key={`${a}-${b}`}
            x1={pa.x}
            y1={pa.y}
            x2={pb.x}
            y2={pb.y}
            stroke="var(--color-interactive-default)"
            strokeOpacity={0.45}
            strokeWidth={1 / Math.max(1, zoom * 0.5)}
          />
        );
      })}
      {points.map((p, i) => {
        const s = normToScreen(p);
        const selected = selectedPoints.has(i);
        const row = Math.floor(i / (columns + 1)) + 1;
        const column = (i % (columns + 1)) + 1;
        // Grid position first, then coordinates — a mesh point is only
        // meaningful relative to its row and column.
        const label = `Mesh point, row ${row} of ${rows + 1}, column ${column} of ${columns + 1}`;
        const description = `${label}. X ${Math.round(p.x * 100)} percent, Y ${Math.round(p.y * 100)} percent.${selected ? ' Selected.' : ''}`;
        const toggleSelection = () => {
          const next = new Set(selectedPoints);
          if (next.has(i)) next.delete(i);
          else next.add(i);
          setSelectedPoints(next);
          announce(next.has(i) ? `${label}. Selected.` : `${label}. Deselected.`);
        };
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: mesh point index is the stable grid identity (row-major)
          <g key={`pt-${i}`} transform={`translate(${s.x} ${s.y})`}>
            {/* biome-ignore lint/a11y/useSemanticElements: SVG has no <button>; role+tabIndex is the standard way to make an SVG handle operable */}
            <rect
              x={-8}
              y={-8}
              width={16}
              height={16}
              fill="transparent"
              style={{ pointerEvents: 'all', cursor: 'move' }}
              onPointerDown={(e) => {
                if (e.shiftKey) {
                  e.stopPropagation();
                  toggleSelection();
                  return;
                }
                startHandleDrag(e, `mesh-${i}`, dragSelected(i));
              }}
              onKeyDown={(e) => {
                // Space/Enter is the keyboard equivalent of shift-clicking:
                // multi-select without needing a pointer.
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleSelection();
                  return;
                }
                onHandleKey(e, dragSelected(i), label);
              }}
              onFocus={() => announce(description)}
              tabIndex={0}
              role="button"
              aria-pressed={selected}
              aria-label={description}
            />
            <circle
              r={selected ? 4.5 : 3.2}
              fill={selected ? 'var(--color-surface-overlay)' : 'var(--color-interactive-default)'}
              stroke="var(--color-surface-overlay)"
              strokeWidth={selected ? 1 : 0.5}
              style={{ pointerEvents: 'none' }}
            />
          </g>
        );
      })}
    </>
  );
}

function BendHandles({
  modifier,
  startHandleDrag,
  onHandleKey,
  announce,
  sourceBounds,
  worldMat,
  zoom,
  pan,
  cameraRotation,
  normDeltaFromLocal,
  worldDeltaToLocal,
}: {
  modifier: BendModifier;
  startHandleDrag: (e: React.PointerEvent, key: string, apply: DragApply) => void;
  onHandleKey: (e: React.KeyboardEvent, apply: DragApply, label: string) => boolean;
  announce: (msg: string) => void;
  sourceBounds: Rect;
  worldMat: Affine;
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation: number;
  normDeltaFromLocal: (x: number, y: number) => NormalizedPoint;
  worldDeltaToLocal: (dx: number, dy: number) => { x: number; y: number };
}) {
  const m = modifier;
  const w = applyAffine(worldMat, [sourceBounds.x + 0.5 * sourceBounds.w, sourceBounds.y]);
  const s = worldToScreen(w[0], w[1], zoom, pan, cameraRotation);
  const bendApply: DragApply = (dxW, dyW, mm) => {
    if (mm.kind !== 'bend') return null;
    const local = worldDeltaToLocal(dxW, dyW);
    const delta = normDeltaFromLocal(local.x, local.y);
    const amount = mm.axis === 'horizontal' ? mm.amount - delta.y * 6 : mm.amount + delta.x * 6;
    return { amount: Math.max(-1, Math.min(1, amount)) };
  };
  const bendLabel = `${m.mode} bend strength, ${Math.round(m.amount * 100)} percent`;
  return (
    <>
      <line
        x1={s.x}
        y1={s.y}
        x2={s.x}
        y2={s.y - 30}
        stroke="var(--color-interactive-default)"
        strokeWidth={1}
        strokeDasharray="3 3"
        strokeOpacity={0.6}
      />
      <g transform={`translate(${s.x} ${s.y - 30})`}>
        {/* biome-ignore lint/a11y/useSemanticElements: SVG has no <button>; role+tabIndex is the standard way to make an SVG handle operable */}
        <rect
          x={-10}
          y={-10}
          width={20}
          height={20}
          fill="transparent"
          style={{ pointerEvents: 'all', cursor: 'ns-resize' }}
          onPointerDown={(e) => startHandleDrag(e, 'bend-strength', bendApply)}
          onKeyDown={(e) => onHandleKey(e, bendApply, bendLabel)}
          onFocus={() => announce(bendLabel)}
          tabIndex={0}
          role="button"
          aria-label={bendLabel}
        />
        <circle
          r={5}
          fill="var(--color-interactive-default)"
          stroke="var(--color-surface-overlay)"
          strokeWidth={1}
          style={{ pointerEvents: 'none' }}
        />
      </g>
      <text
        x={s.x + 8}
        y={s.y - 24}
        fontSize={11}
        fill="var(--color-text-primary-on-overlay)"
        style={{ pointerEvents: 'none' }}
      >
        {m.mode} {Math.round(m.amount * 100)}%
      </text>
    </>
  );
}
